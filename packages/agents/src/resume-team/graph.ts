import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { agentLabels, appendHandoffs, handoff, type Handoff } from '../orchestration/handoff.js';
import { lacksJobEvidence } from './critic.js';
import type { Critique, HumanOutcome, ResumeReturnTarget, TeamFeedback } from './types.js';

// Critic may return work this many times per human review cycle before escalating to the user.
export const MAX_CRITIC_ROUNDS = 2;

// Orchestration state only. Business data (drafts, gaps, critiques) stays in the mission row,
// matching the existing rule that checkpoints hold continuation state, not candidate evidence.
export const ResumeTeamState = Annotation.Root({
  missionId: Annotation<string>(),
  // Critic rounds in the current human cycle.
  round: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  // Notes addressed to the next specialist. Replaced on every handoff.
  feedback: Annotation<TeamFeedback[]>({ reducer: (_, next) => next, default: () => [] }),
  handoffs: Annotation<Handoff[]>({ reducer: appendHandoffs, default: () => [] }),
});
export type ResumeTeamStateType = typeof ResumeTeamState.State;

// Ports keep the graph free of database and provider code, so routing is unit-testable.
export interface ResumeTeamPorts {
  analyseGaps(missionId: string, feedback: TeamFeedback[]): Promise<{ summary: string }>;
  selectEvidence(missionId: string, feedback: TeamFeedback[]): Promise<{ summary: string }>;
  rewrite(missionId: string, feedback: TeamFeedback[]): Promise<{ summary: string }>;
  critique(missionId: string, round: number): Promise<Critique>;
  reviewRequest(missionId: string): Promise<{ draftHash: string; critique: Critique | null }>;
  // Called after interrupt() returns; validates and persists the human decision.
  applyHumanDecision(missionId: string, decision: unknown): Promise<HumanOutcome>;
  recordHandoff(missionId: string, handoff: Handoff): Promise<void>;
}

type Next = ResumeReturnTarget | 'critic' | 'human_review' | typeof END;

export function buildResumeTeamGraph(ports: ResumeTeamPorts) {
  const notesFor = (s: ResumeTeamStateType, agent: ResumeReturnTarget) =>
    s.feedback.filter((f) => f.to === agent);

  // Every transition is an explicit, recorded handoff carrying a reason.
  const route = async (
    s: ResumeTeamStateType,
    from: string,
    to: Next,
    reason: string,
    update: Partial<ResumeTeamStateType> = {},
  ) => {
    const h = handoff(from, to === END ? 'end' : to, reason);
    await ports.recordHandoff(s.missionId, h);
    return new Command({ goto: to, update: { feedback: [], ...update, handoffs: [h] } });
  };

  return (
    new StateGraph(ResumeTeamState)
      .addNode(
        'gap_analyzer',
        async (s: ResumeTeamStateType) => {
          const r = await ports.analyseGaps(s.missionId, notesFor(s, 'gap_analyzer'));
          // User focus notes continue to the selector so it can act on them.
          const forwarded = notesFor(s, 'gap_analyzer')
            .filter((f) => f.from === 'human')
            .map((f) => ({ ...f, to: 'selector' as const }));
          return route(s, 'gap_analyzer', 'selector', r.summary, { feedback: forwarded });
        },
        { ends: ['selector'] },
      )
      .addNode(
        'selector',
        async (s: ResumeTeamStateType) => {
          const r = await ports.selectEvidence(s.missionId, notesFor(s, 'selector'));
          return route(s, 'selector', 'rewriter', r.summary);
        },
        { ends: ['rewriter'] },
      )
      .addNode(
        'rewriter',
        async (s: ResumeTeamStateType) => {
          const r = await ports.rewrite(s.missionId, notesFor(s, 'rewriter'));
          return route(s, 'rewriter', 'critic', r.summary);
        },
        { ends: ['critic'] },
      )
      // The critic decides where work goes next: back to a specialist, or up to the human.
      .addNode(
        'critic',
        async (s: ResumeTeamStateType) => {
          const c = await ports.critique(s.missionId, s.round);
          if (c.pass)
            return route(s, 'critic', 'human_review', criticSummary(c, 'Passed'), { round: 0 });
          if (s.round >= MAX_CRITIC_ROUNDS)
            return route(
              s,
              'critic',
              'human_review',
              `Escalated after ${s.round + 1} rounds with ${c.issues.length} open issue(s).`,
              { round: 0 },
            );
          // Re-selection invalidates wording, so selector issues take priority.
          const target: ResumeReturnTarget = c.issues.some((i) => i.target === 'selector')
            ? 'selector'
            : 'rewriter';
          const feedback: TeamFeedback[] = c.issues
            .filter((i) => i.target === target)
            .map((i) => ({ from: 'critic', to: target, message: i.message, factId: i.factId, code: i.code }));
          return route(s, 'critic', target, `${feedback.length} issue(s): ${feedback[0].message}`, {
            round: s.round + 1,
            feedback,
          });
        },
        { ends: ['selector', 'rewriter', 'human_review'] },
      )
      // Human gate. Writes that depend on the decision happen after interrupt(), because
      // LangGraph replays this node from the top when the mission resumes.
      .addNode(
        'human_review',
        async (s: ResumeTeamStateType) => {
          const request = await ports.reviewRequest(s.missionId);
          const decision = interrupt({
            kind: 'resume',
            draftHash: request.draftHash,
            critique: request.critique
              ? { pass: request.critique.pass, openIssues: request.critique.issues.length }
              : null,
            message:
              'Review the team draft. Approve it, or send it back to a named specialist with a note.',
          });
          const outcome = await ports.applyHumanDecision(s.missionId, decision);
          if (outcome.type === 'approved')
            return route(s, 'human_review', END, 'You approved this exact draft.');
          return route(
            s,
            'human_review',
            outcome.target,
            `You returned the draft to ${agentLabels[outcome.target]}: ${outcome.message}`,
            {
              round: 0,
              feedback: [{ from: 'human', to: outcome.target, message: outcome.message }],
            },
          );
        },
        { ends: ['gap_analyzer', 'selector', 'rewriter', END] },
      )
      .addEdge(START, 'gap_analyzer')
  );
}

function criticSummary(c: Critique, verdict: string) {
  const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
  if (lacksJobEvidence(c))
    return `${verdict} with warning (${c.reviewer}): none of ${c.metrics.totalRequirements} job requirements has approved evidence, so the draft cannot target this job; keyword coverage ${pct(c.metrics.keywordCoverage)}, ${c.metrics.rewrittenClaims} reworded.`;
  const evidenced =
    c.metrics.totalRequirements !== undefined
      ? `${c.metrics.supportedRequirements} of ${c.metrics.totalRequirements} requirements evidenced, `
      : '';
  return `${verdict} (${c.reviewer}): ${evidenced}requirement coverage ${pct(c.metrics.requirementCoverage)}, keyword coverage ${pct(c.metrics.keywordCoverage)}, ${c.metrics.rewrittenClaims} reworded.`;
}
