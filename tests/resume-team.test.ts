import { describe, expect, it } from 'vitest';
import { Annotation, Command, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import {
  buildResumeTeamGraph,
  MAX_CRITIC_ROUNDS,
  type ResumeTeamPorts,
} from '../packages/agents/src/resume-team/graph.js';
import { analyseGaps } from '../packages/agents/src/resume-team/gap-analysis.js';
import { lacksJobEvidence, reviewDraft } from '../packages/agents/src/resume-team/critic.js';
import { applyRewrites } from '../packages/agents/src/resume-team/rewrite.js';
import type { Critique, HumanOutcome } from '../packages/agents/src/resume-team/types.js';

const facts = [
  { id: 'skill-1', text: 'SQL' },
  { id: 'skill-2', text: 'Python' },
  { id: 'exp-1-c1', text: 'I built SQL reports for 3 teams' },
];

const critique = (pass: boolean, target: 'selector' | 'rewriter' = 'selector'): Critique => ({
  round: 0,
  pass,
  reviewer: 'rules',
  issues: pass ? [] : [{ target, code: 'MISSING_EVIDENCE', factId: 'skill-1', message: 'Add SQL' }],
  metrics: { requirementCoverage: 1, keywordCoverage: 1, rewrittenClaims: 0, blockedRewrites: 0 },
});

// Fake ports record the order specialists ran in; the real graph decides the order.
function harness(critiques: Critique[], decisions: HumanOutcome[]) {
  const calls: string[] = [];
  const notes: Record<string, string[]> = {};
  const ports: ResumeTeamPorts = {
    analyseGaps: async (_, f) => (calls.push('gap_analyzer'), (notes.gap = f.map((x) => x.message)), { summary: 'gaps' }),
    selectEvidence: async (_, f) => (calls.push('selector'), (notes.selector = f.map((x) => x.message)), { summary: 'selected' }),
    rewrite: async (_, f) => (calls.push('rewriter'), (notes.rewriter = f.map((x) => x.message)), { summary: 'reworded' }),
    critique: async (_, round) => (calls.push(`critic:${round}`), { ...(critiques.shift() || critique(true)), round }),
    reviewRequest: async () => ({ draftHash: 'h1', critique: null }),
    applyHumanDecision: async () => (calls.push('human'), decisions.shift()!),
    recordHandoff: async () => {},
  };
  // Mirror production: the team is a compiled subgraph node inside the mission graph.
  const Parent = Annotation.Root({ missionId: Annotation<string>() });
  const graph = new StateGraph(Parent)
    .addNode('resume_team', buildResumeTeamGraph(ports).compile())
    .addEdge(START, 'resume_team')
    .compile({ checkpointer: new MemorySaver() });
  return { graph, calls, notes };
}

const config = { configurable: { thread_id: 'm1' } };

describe('resume team graph', () => {
  it('loops critic back to the selector, then pauses for the human with a resume payload', async () => {
    const { graph, calls, notes } = harness([critique(false), critique(true)], [{ type: 'approved' }]);
    const paused: any = await graph.invoke({ missionId: 'm1' }, config);
    expect(calls).toEqual(['gap_analyzer', 'selector', 'rewriter', 'critic:0', 'selector', 'rewriter', 'critic:1']);
    expect(notes.selector).toEqual(['Add SQL']);
    expect(paused.__interrupt__[0].value).toMatchObject({ kind: 'resume', draftHash: 'h1' });
    const state = await graph.getState(config);
    expect(state.tasks.some((t) => t.interrupts?.length)).toBe(true);

    await graph.invoke(new Command({ resume: { kind: 'resume', decision: 'approve' } }), config);
    expect(calls.at(-1)).toBe('human');
    expect((await graph.getState(config)).next).toEqual([]);
  });

  it('routes rewriter-only issues to the rewriter and escalates after the round limit', async () => {
    const failing = Array.from({ length: MAX_CRITIC_ROUNDS + 1 }, () => critique(false, 'rewriter'));
    const { graph, calls } = harness(failing, [{ type: 'approved' }]);
    const paused: any = await graph.invoke({ missionId: 'm1' }, config);
    expect(calls.filter((c) => c === 'selector')).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('critic'))).toHaveLength(MAX_CRITIC_ROUNDS + 1);
    expect(paused.__interrupt__).toBeTruthy();
  });

  it('sends a human rejection to the named specialist only, with the note attached', async () => {
    const { graph, calls, notes } = harness(
      [],
      [{ type: 'returned', target: 'rewriter', message: 'Lead with the SQL result' }, { type: 'approved' }],
    );
    await graph.invoke({ missionId: 'm1' }, config);
    const before = calls.length;
    const again: any = await graph.invoke(new Command({ resume: { decision: 'reject' } }), config);
    expect(calls.slice(before)).toEqual(['human', 'rewriter', 'critic:0']);
    expect(notes.rewriter).toEqual(['Lead with the SQL result']);
    expect(again.__interrupt__).toBeTruthy();
  });

  it('forwards gap-analyzer focus notes to the selector', async () => {
    const { graph, calls, notes } = harness(
      [],
      [{ type: 'returned', target: 'gap_analyzer', message: 'Focus on Python' }, { type: 'approved' }],
    );
    await graph.invoke({ missionId: 'm1' }, config);
    const before = calls.length;
    await graph.invoke(new Command({ resume: {} }), config);
    expect(calls.slice(before, before + 3)).toEqual(['human', 'gap_analyzer', 'selector']);
    expect(notes.gap).toEqual(['Focus on Python']);
    expect(notes.selector).toEqual(['Focus on Python']);
  });
});

describe('resume team specialists', () => {
  it('links job requirements to approved facts and honours user focus', () => {
    const report = analyseGaps(
      { requirements: { required: ['sql', 'tableau'], preferred: ['python'] } },
      facts,
      'please focus on Python',
    );
    expect(report.source).toBe('lexical');
    expect(report.requirements[0].term).toBe('python');
    expect(report.gaps).toEqual(['tableau']);
    expect(report.priorityFactIds).toEqual(['skill-2', 'skill-1', 'exp-1-c1']);
  });

  it('prefers the source-quoted LLM mapping when the matcher produced one', () => {
    const report = analyseGaps(
      {
        mapping: {
          items: [
            { term: 'SQL', level: 'required', status: 'evidenced', evidence: [{ factId: 'exp-1-c1', quote: 'SQL' }] },
            { term: 'dbt', level: 'required', status: 'evidenced', evidence: [{ factId: 'unknown', quote: 'dbt' }] },
          ],
        },
      },
      facts,
    );
    expect(report.source).toBe('llm-mapping');
    expect(report.requirements.find((r) => r.term === 'dbt')?.status).toBe('not_evidenced');
  });

  it('critic flags omitted evidence for the selector and wording drift for the rewriter', () => {
    const gaps = analyseGaps({ requirements: { required: ['sql', 'python'] } }, facts);
    const c = reviewDraft({
      round: 0,
      claims: [{ factId: 'exp-1-c1', text: 'Built SQL reports for 30 teams', factText: facts[2].text, kind: 'experience' }],
      facts,
      gaps,
      eligibleFactIds: new Set(['skill-1', 'skill-2', 'exp-1-c1']),
    });
    expect(c.pass).toBe(false);
    expect(c.issues.map((i) => [i.target, i.code])).toEqual([
      ['rewriter', 'WORDING_DRIFT'],
      ['selector', 'MISSING_EVIDENCE'],
    ]);
    expect(c.metrics.requirementCoverage).toBe(0.5);
  });

  it('accepts conservative rewording and blocks rewording that changes facts', () => {
    const claims = [{ factId: 'exp-1-c1', text: facts[2].text, kind: 'experience' }];
    const ok = applyRewrites(claims, [{ factId: 'exp-1-c1', text: 'Built SQL reports for 3 teams', reason: 'filler' }], facts);
    expect(ok.accepted).toBe(1);
    expect(ok.claims[0]).toMatchObject({ text: 'Built SQL reports for 3 teams', factText: facts[2].text });
    const bad = applyRewrites(claims, [{ factId: 'exp-1-c1', text: 'Led SQL reporting for 3 teams', reason: 'impact' }], facts);
    expect(bad.accepted).toBe(0);
    expect(bad.blocked).toHaveLength(1);
    expect(bad.claims[0].text).toBe(facts[2].text);
  });
});

describe('resume team evidence reporting', () => {
  it('reads partial evidence from the stored job mapping shape', () => {
    const report = analyseGaps(
      {
        mapping: {
          items: [
            { term: 'Complex SQL querying', level: 'required', status: 'partial', evidence: [{ factId: 'exp-1-c1', quote: 'SQL' }] },
            { term: 'Discretion with sensitive data', level: 'required', status: 'not_evidenced', evidence: [] },
          ],
        },
      },
      facts,
    );
    expect(report.requirements.map((r) => [r.term, r.status])).toEqual([
      ['Complex SQL querying', 'partial'],
      ['Discretion with sensitive data', 'not_evidenced'],
    ]);
    expect(report.gaps).toEqual(['Discretion with sensitive data']);
  });

  it('measures keyword coverage by significant words and flags drafts with no job evidence', () => {
    const gaps = analyseGaps(
      { mapping: { items: [{ term: 'Writing and troubleshooting SQL queries', level: 'required', status: 'not_evidenced', evidence: [] }] } },
      facts,
    );
    const c = reviewDraft({
      round: 0,
      claims: [{ factId: 'exp-1-c1', text: facts[2].text, kind: 'experience' }],
      facts,
      gaps,
      eligibleFactIds: new Set(['exp-1-c1']),
    });
    expect(c.pass).toBe(true);
    expect(c.metrics).toMatchObject({ supportedRequirements: 0, totalRequirements: 1 });
    expect(lacksJobEvidence(c)).toBe(true);
  });
});
