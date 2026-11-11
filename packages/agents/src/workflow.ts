import { mapJobRequirements, scoreJobMapping } from './job-mapping.js';
import { JobRepository } from '../../recruitment/src/repository.js';
import { Annotation, StateGraph, START, END, interrupt } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { databaseUrl, portablePool } from '../../../apps/api/src/db.js';
import { AppError } from '../../../apps/api/src/errors.js';
import {
  getInterviewCompletion,
  type InterviewAnswer,
  type InterviewQuestion,
} from '../../../apps/api/src/interview.js';
import {
  freshMission,
  patchRun,
  reserveCall,
  appendUsage,
  validateResumeClaims,
  mutateRun,
  digest,
  json,
  type MissionData,
} from '../../../apps/api/src/domain.js';
import {
  coachSchema,
  questionsSchema,
  feedbackSchema,
  type Fact,
  type CareerProfile,
  type ResumeReturnTarget,
  resumeReturnTargets,
} from '../../contracts/src/index.js';
import { composeSelection } from '../../../apps/api/src/resume-composition.js';
import {
  resumeRecordIndex,
  resumeObjective,
  isResumeContribution,
} from '../../contracts/src/resume-layout.js';
import { missionContext } from './mission-context.js';
import { generate, type Mode } from './provider.js';
import { matchingProfileView } from '../../contracts/src/career-evidence.js';
import { compare, vectorSimilarity } from '../../matching/domain.js';
import { filterResumeEvidence } from './resume-evidence.js';
import { buildResumeTeamGraph, type ResumeTeamPorts } from './resume-team/graph.js';
import { analyseGaps } from './resume-team/gap-analysis.js';
import { reviewDraft } from './resume-team/critic.js';
import { applyRewrites, isRewritable, type DraftClaim } from './resume-team/rewrite.js';
import { critiqueSchema, rewriteSchema } from './resume-team/schemas.js';
import type { Critique, TeamFeedback } from './resume-team/types.js';
import { agentLabels, appendHandoffs } from './orchestration/handoff.js';
import { spanHook } from '../../../apps/api/src/trace.js';

// Checkpoints store a mission reference; approved evidence and results remain in domain tables.
const State = Annotation.Root({ missionId: Annotation<string>() });

const jobFile = new URL('../../matching/jobs.json', import.meta.url);

export const readJobs = async () => JSON.parse(await readFile(jobFile, 'utf8'));

export async function createWorkflow() {
  const saver = portablePool
    ? new PostgresSaver(portablePool)
    : PostgresSaver.fromConnString(databaseUrl);
  await saver.setup();

  // Each invocation owns a short-lived DB lease. The lease is not stored in checkpoint data.
  const leases = new Map<string, { token: string; signal: AbortSignal }>();

  // Recheck profile freshness and per-specialist consent before each workflow step.
  const context = async (id: string, permission: keyof CareerProfile['sharing']) => {
    const m = await freshMission(id);
    const p = m.profile.data as unknown as CareerProfile;
    if ((m.data as MissionData).agentAccess !== 'all-approved-profile' && !p.sharing[permission])
      throw new AppError(
        403,
        'SHARING_DENIED',
        `Enable ${permission} sharing in a newly reviewed profile to use this workflow.`,
      );
    const current = leases.get(id);
    if (!current) throw Error('Worker lease unavailable.');
    return {
      m,
      p,
      facts: m.profile.facts as unknown as Fact[],
      d: m.data as MissionData,
      ...current,
    };
  };

  // Centralise provider context, usage accounting and cancellation for every generative specialist.
  const model = async <T>(
    id: string,
    permission: keyof CareerProfile['sharing'],
    role: Parameters<typeof generate>[0],
    schema: Parameters<typeof generate<T>>[2],
  ) => {
    const c = await context(id, permission);
    // Send one approved fact representation only. Source history and memory retrieval
    // remain server-side and are not extra candidate context for this mission.
    await patchRun(
      id,
      c.token,
      {
        evidenceRetrieval: {
          strategy: 'approved-profile-only-v1',
          query: c.m.goal,
          searched: c.facts.length,
          hits: c.facts.map(({ id, text }) => ({ id, text })),
          insufficientRecall: c.facts.length === 0,
          forRole: role,
        },
      },
      role,
      'context',
      'Prepared approved profile facts only; source quotations and conversation history stay local.',
    );
    const result = await generate(
      role,
      missionContext(role, {
        goal: c.m.goal,
        facts:
          role === 'rewrite' || role === 'critic'
            ? c.facts.filter((f) =>
                (c.d.resumeDraft?.claims || []).some(
                  (claim: DraftClaim) =>
                    claim.factId === f.id && (role === 'critic' || isRewritable(claim)),
                ),
              )
            : role === 'questions' && c.d.resumeDraft?.claims?.length
              ? c.facts.filter((f) =>
                  c.d.resumeDraft.claims.some((claim: any) => claim.factId === f.id),
                )
              : role === 'resume'
                ? c.facts.filter(
                    (f) => !f.recordId || f.kind !== 'experience' || isResumeContribution(f),
                  )
                : c.facts,
        profileBase: role === 'resume' ? { records: resumeRecordIndex(c.p) } : undefined,
        analysisFeedback: role === 'coach' ? c.d.analysisFeedback : undefined,
        job: c.d.selectedJob?.job,
        questions: c.d.questions,
        answers: c.d.answers,
        feedback: role === 'rewrite' ? c.d.resumeTeam?.rewriterNotes : c.d.resumeFeedback,
        draftClaims:
          role === 'critic'
            ? (c.d.resumeDraft?.claims || []).map((claim: DraftClaim) => ({
                factId: claim.factId,
                text: claim.text,
              }))
            : undefined,
        priorFeedback: c.d.priorFeedback,
      }),
      schema,
      c.m.mode as Mode,
      {
        onCall: () => reserveCall(id, c.token),
        onTool: (name) => patchRun(id, c.token, {}, role, 'tool', name),
        onUsage: (a, b) => appendUsage(id, c.token, a, b),
        onSpan: spanHook({ userId: c.m.userId, missionId: id }),
      },
      c.signal,
    );
    return result;
  };

  // ---- Resume team ports: database and provider work behind the subgraph's routing ----
  const eligibleResumeFacts = (facts: Fact[]) =>
    facts.filter(
      (fact) =>
        ['skill', 'education', 'experience'].includes(fact.kind) &&
        (!fact.recordId || fact.kind !== 'experience' || isResumeContribution(fact)) &&
        !/^none yet$/i.test(fact.text),
    );
  const notesText = (feedback: TeamFeedback[]) =>
    feedback.map((f) => `${f.from === 'human' ? 'User' : 'Critic'}: ${f.message}`).join('\n');

  // Team progress is mirrored into mission data so the review screen and Activity log show it.
  const patchTeam = (
    id: string,
    lease: string,
    update: (team: Record<string, any>) => Record<string, any>,
    agent: string,
    action: string,
    detail: string,
    extra: MissionData = {},
  ) =>
    mutateRun(id, lease, async (tx, m) => {
      const data = m.data as MissionData;
      await tx.mission.update({
        where: { id },
        data: {
          data: json({ ...data, ...extra, resumeTeam: update(data.resumeTeam || {}) }),
          events: json([
            ...(m.events as any[]),
            { at: new Date().toISOString(), agent, action, detail },
          ]),
        },
      });
    });

  const resumePorts: ResumeTeamPorts = {
    async analyseGaps(id, feedback) {
      const c = await context(id, 'resume');
      const gaps = analyseGaps(
        c.d.selectedJob,
        c.facts,
        feedback
          .filter((f) => f.from === 'human')
          .map((f) => f.message)
          .join(' '),
      );
      const supported = gaps.requirements.length - gaps.gaps.length;
      const summary =
        `${supported} of ${gaps.requirements.length} job requirements have approved evidence; ` +
        `${gaps.gaps.length} stay as gaps` +
        (gaps.userFocus.length ? `; your focus: ${gaps.userFocus.join(', ')}.` : '.');
      await patchTeam(id, c.token, (t) => ({ ...t, gaps }), 'Gap Analyzer', 'completed', summary);
      return { summary };
    },

    // Evidence Selector: the original Resume Tailor selection, now steered by team notes.
    async selectEvidence(id, feedback) {
      const c = await context(id, 'resume');
      const eligible = new Set(eligibleResumeFacts(c.facts).map((f) => f.id));
      if (!eligible.size)
        throw new AppError(
          422,
          'EVIDENCE_REQUIRED',
          'Approve at least one skill, education or experience fact before tailoring a resume.',
        );
      const notes = notesText(feedback);
      if (notes || c.d.resumeFeedback)
        await patchRun(
          id,
          c.token,
          { resumeFeedback: notes },
          'Evidence Selector',
          'context',
          notes
            ? `Received ${feedback.length} note(s) for re-selection.`
            : 'Cleared notes from the previous review cycle.',
        );
      const groundedResumeSchema = z.object({
        claims: z
          .array(
            z.object({
              factId: z.string().min(1).max(100),
              reason: z.string().trim().min(1).max(1000),
            }),
          )
          .min(1)
          .max(20),
      });
      const plan = await model(id, 'resume', 'resume', groundedResumeSchema);
      const selection = filterResumeEvidence(plan.claims, eligible);
      // Critic and user-focus requests are applied deterministically, not left to the model.
      const gaps = c.d.resumeTeam?.gaps;
      // Facts the Critic or the user asked for stay requested in later rounds, so a round whose
      // notes carry no fact ID cannot silently drop them again.
      const pinned: string[] = c.d.resumeTeam?.pinnedFactIds || [];
      const asked = feedback.flatMap((f) => (f.factId ? [f.factId] : []));
      const nextPinned = [...new Set([...pinned, ...asked])].filter((factId) =>
        eligible.has(factId),
      );
      // A Critic return refines the current draft: lines already in it stay unless the user asks
      // otherwise, so a fresh model pick cannot drop evidence the Critic has already accepted.
      const kept =
        feedback.length && feedback.every((f) => f.from === 'critic')
          ? (c.d.resumeDraft?.claims || []).map((claim: DraftClaim) => claim.factId)
          : [];
      const requested = [
        ...asked,
        ...pinned,
        ...kept,
        ...(gaps?.requirements || [])
          .filter((r: any) => gaps?.userFocus?.includes(r.term))
          .flatMap((r: any) => r.factIds as string[]),
      ].filter(
        (factId, index, all) =>
          eligible.has(factId) &&
          all.indexOf(factId) === index &&
          !selection.accepted.some((a) => a.factId === factId),
      );
      const accepted = [
        ...selection.accepted,
        ...requested.map((factId) => ({
          factId,
          reason: 'Requested by the Critic or your note to cover a job requirement.',
        })),
      ];
      if (!accepted.length)
        throw new AppError(
          422,
          'EVIDENCE_REQUIRED',
          'No eligible approved facts were selected. Retry the step or review your profile.',
        );
      const claims = validateResumeClaims(
        composeSelection(accepted, c.facts, c.d.selectedJob.job.description),
        c.facts,
      );
      const draft = {
        missionId: id,
        jobTitle: c.d.selectedJob.job.title,
        name: c.p.name,
        ...(c.p.contact ? { contact: c.p.contact } : {}),
        profileVersion: c.m.profile.version,
        records: resumeRecordIndex(c.p),
        summary: resumeObjective(c.d.selectedJob.job.title, claims),
        claims,
        ...(selection.rejectedCount ? { excludedSuggestions: selection.rejectedCount } : {}),
        omittedFacts: c.facts.filter(
          (f) =>
            ['skill', 'education', 'experience'].includes(f.kind) &&
            !claims.some((claim) => claim.factId === f.id),
        ),
        revision: c.d.revisions || 0,
      };
      const summary =
        `Selected ${claims.length} approved claims` +
        (requested.length ? `, including ${requested.length} kept or requested by the team.` : '.');
      await patchTeam(
        id,
        c.token,
        (t) => ({ ...t, pinnedFactIds: nextPinned }),
        'Evidence Selector',
        'completed',
        summary,
        { resumeDraft: { ...draft, hash: digest(draft) } },
      );
      return { summary };
    },

    // Rewriter: job-targeted wording, accepted only when the evidence wording guard passes.
    async rewrite(id, feedback) {
      const c = await context(id, 'resume');
      const draft = c.d.resumeDraft;
      if (!draft)
        throw new AppError(409, 'DRAFT_REQUIRED', 'No resume draft is available to reword.');
      if (!draft.claims.some((claim: DraftClaim) => isRewritable(claim))) {
        const summary = 'No personal contribution statements to reword; claims stay verbatim.';
        await patchTeam(
          id,
          c.token,
          (t) => ({ ...t, rewrites: { accepted: 0, blocked: [] } }),
          'Rewriter',
          'skipped',
          summary,
        );
        return { summary };
      }
      const notes = notesText(feedback);
      if (notes || c.d.resumeTeam?.rewriterNotes)
        await patchTeam(
          id,
          c.token,
          (t) => ({ ...t, rewriterNotes: notes }),
          'Rewriter',
          'context',
          notes ? `Received ${feedback.length} note(s).` : 'Cleared notes from the previous cycle.',
        );
      const result = await model(id, 'resume', 'rewrite', rewriteSchema);
      const { claims, accepted, blocked } = applyRewrites(draft.claims, result.rewrites, c.facts);
      const { hash: _, ...rest } = draft;
      const next = { ...rest, claims };
      const summary =
        `Reworded ${accepted} claim(s)` +
        (blocked.length
          ? `; kept ${blocked.length} verbatim because the wording changed facts.`
          : '.');
      await patchTeam(
        id,
        c.token,
        (t) => ({ ...t, rewrites: { accepted, blocked } }),
        'Rewriter',
        'completed',
        summary,
        { resumeDraft: { ...next, hash: digest(next) } },
      );
      return { summary };
    },

    // Critic: rule checks first; one bounded model review per human cycle once rules pass.
    async critique(id, round) {
      const c = await context(id, 'resume');
      const draft = c.d.resumeDraft;
      const team = c.d.resumeTeam || {};
      const eligible = new Set(eligibleResumeFacts(c.facts).map((f) => f.id));
      let critique: Critique = reviewDraft({
        round,
        claims: draft.claims,
        facts: c.facts,
        gaps: team.gaps ?? null,
        eligibleFactIds: eligible,
        rewrites: team.rewrites,
      });
      const cycle = c.d.revisions || 0;
      const modelReview = critique.pass && team.modelReviewedCycle !== cycle;
      if (modelReview) {
        const review = await model(id, 'resume', 'critic', critiqueSchema);
        const inDraft = new Set(draft.claims.map((claim: DraftClaim) => claim.factId));
        const issues = review.issues
          .filter(
            (i) =>
              i.factId === null ||
              (i.target === 'rewriter' ? inDraft.has(i.factId) : eligible.has(i.factId)),
          )
          .slice(0, 3)
          .map((i) => ({ ...i, code: 'REVIEWER_NOTE' as const }));
        critique = { ...critique, pass: issues.length === 0, issues, reviewer: 'rules+model' };
      }
      await patchTeam(
        id,
        c.token,
        (t) => ({
          ...t,
          critiques: [...(t.critiques || []), critique].slice(-12),
          ...(modelReview ? { modelReviewedCycle: cycle } : {}),
        }),
        'Critic',
        critique.pass ? 'passed' : 'returned',
        critique.pass
          ? `Round ${round + 1} passed (${critique.reviewer}).`
          : `Round ${round + 1}: ${critique.issues.length} issue(s) — ${critique.issues[0].message}`,
      );
      return critique;
    },

    async reviewRequest(id) {
      const c = await context(id, 'resume');
      return {
        draftHash: c.d.resumeDraft.hash,
        critique: c.d.resumeTeam?.critiques?.at(-1) ?? null,
      };
    },

    // Runs after interrupt(): approval persists the exact draft; a return names a specialist.
    async applyHumanDecision(id, raw) {
      const c = await context(id, 'resume');
      const decision = raw as {
        kind: string;
        decision: string;
        draftHash: string;
        feedback?: string;
        target?: ResumeReturnTarget;
      };
      if (decision.kind !== 'resume' || decision.draftHash !== c.d.resumeDraft.hash)
        throw new AppError(409, 'STALE_APPROVAL', 'Review the current resume draft.');
      if (decision.decision === 'revise' || decision.decision === 'reject') {
        if ((c.d.revisions || 0) >= 2) throw Error('Revision limit reached.');
        const target = decision.decision === 'revise' ? 'selector' : decision.target;
        if (!target || !resumeReturnTargets.includes(target))
          throw new AppError(
            422,
            'RETURN_TARGET_REQUIRED',
            'Choose which specialist should revise the draft.',
          );
        const message = decision.feedback?.trim() || 'Re-emphasise supported evidence only.';
        await patchTeam(
          id,
          c.token,
          (t) => ({ ...t, humanReturns: (t.humanReturns || 0) + 1 }),
          'Job Seeker',
          'returned',
          `Returned the draft to ${agentLabels[target]}: ${message.slice(0, 200)}`,
          { revisions: (c.d.revisions || 0) + 1 },
        );
        return { type: 'returned', target, message };
      }
      if (decision.decision !== 'approve') throw Error('Invalid approval decision.');
      await mutateRun(id, c.token, async (tx, m) => {
        // A checkpoint replay must not create another approved copy of the same draft.
        const saved = await tx.approvedResume.upsert({
          where: { draftHash: c.d.resumeDraft.hash },
          create: {
            userId: m.userId,
            missionId: m.id,
            draftHash: c.d.resumeDraft.hash,
            content: json(c.d.resumeDraft),
          },
          update: {},
        });
        await tx.mission.update({
          where: { id: m.id },
          data: {
            data: json({ ...(m.data as MissionData), approvedResumeId: saved.id }),
            events: json([
              ...(m.events as any[]),
              {
                at: new Date().toISOString(),
                agent: 'Job Seeker',
                action: 'approved',
                detail: 'Explicitly approved and persisted this exact resume version.',
              },
            ]),
          },
        });
      });
      return { type: 'approved' };
    },

    async recordHandoff(id, h) {
      const current = leases.get(id);
      if (!current) throw Error('Worker lease unavailable.');
      await patchTeam(
        id,
        current.token,
        (t) => ({ ...t, handoffs: appendHandoffs(t.handoffs || [], h) }),
        'Orchestrator',
        'handoff',
        `${agentLabels[h.from] || h.from} → ${agentLabels[h.to] || h.to}: ${h.reason}`,
      );
    },
  };
  const resumeTeam = buildResumeTeamGraph(resumePorts).compile();

  // Profile approval happens before mission creation. This graph coordinates the downstream roles.
  const graph = new StateGraph(State)
    .addNode('career_coach', async (s) => {
      const c = await context(s.missionId, 'coach');
      if (c.d.analysis) return {};
      const known = new Set(c.facts.map((f) => f.id));
      const groundedCoachSchema = coachSchema.superRefine((analysis, context) => {
        for (const [section, items] of Object.entries(analysis)) {
          items.forEach((item, index) => {
            if (item.evidenceIds.some((id) => !known.has(id)))
              context.addIssue({
                code: 'custom',
                path: [section, index, 'evidenceIds'],
                message: 'Every evidence ID must come from the supplied approved facts.',
              });
          });
        }
      });
      const analysis = await model(s.missionId, 'coach', 'coach', groundedCoachSchema);
      if (
        [analysis.strengths, analysis.gaps, analysis.directions, analysis.actions].some((items) =>
          items.some(
            (item) => !item.evidenceIds.length || item.evidenceIds.some((id) => !known.has(id)),
          ),
        )
      )
        throw new AppError(422, 'INVALID_EVIDENCE', 'Career advice referenced unknown evidence.');
      await patchRun(
        s.missionId,
        c.token,
        { analysis },
        'Career Coach',
        'completed',
        'Strengths, gaps, directions and actions prepared with traceable evidence and reasons.',
      );
      return {};
    })
    .addNode('job_matching', async (s) => {
      const c = await context(s.missionId, 'matching');
      if (c.d.matches) return {};
      if (c.d.simulateSourceFailure)
        throw new AppError(
          503,
          'JOB_SOURCE_UNAVAILABLE',
          'Job source unavailable. Retry the selected source; demo jobs are never substituted.',
        );
      const query = c.d.jobSearch || { provider: 'fixtures' };
      let jobs: any[], jobRetrieval: any;
      if (query.provider === 'fixtures') {
        jobs = await readJobs();
        jobRetrieval = { source: 'fixtures', count: jobs.length };
      } else {
        const fetched = await new JobRepository().search(query, { signal: c.signal });
        jobs = fetched.jobs;
        jobRetrieval = {
          source: query.provider,
          board: query.board,
          count: jobs.length,
          sourceTotal: fetched.sourceTotal ?? null,
          duplicateCount: fetched.duplicateCount ?? 0,
          geography: fetched.geography,
          sources: fetched.sources || [],
          discovery: fetched.discovery || null,
          limitations: fetched.limitations || [],
          fetchedAt: new Date().toISOString(),
        };
      }
      const corpus = jobs.map((j: any) => j.title + ' ' + j.description);
      const legacy = matchingProfileView(c.p);
      const preliminary = jobs
        .map((job: any) =>
          c.m.mode === 'fixture'
            ? compare(legacy, job, corpus)
            : {
                job,
                components: {
                  semantic: vectorSimilarity(
                    legacy.skills.join(' ') + ' ' + legacy.goals,
                    job.title + ' ' + job.description,
                    corpus,
                  ),
                },
              },
        )
        .sort(
          (a: any, b: any) =>
            b.components.semantic - a.components.semantic || a.job.id.localeCompare(b.job.id),
        );
      let matches: any[];
      if (c.m.mode === 'fixture') {
        matches = preliminary;
      } else {
        // Bound live costs while screening by generic lexical overlap, not a skill whitelist.
        const shortlist = preliminary.slice(0, 12);
        jobRetrieval.llmReviewed = shortlist.length;
        jobRetrieval.notLlmReviewed = Math.max(0, jobs.length - shortlist.length);
        const saved = c.d.requirementMappings || {};
        matches = [];
        for (let offset = 0; offset < shortlist.length; offset += 2) {
          const batch = await Promise.allSettled(
            shortlist.slice(offset, offset + 2).map(async (item: any) => {
              const job = item.job;
              const mappingKey = digest({
                jobId: job.id,
                description: job.description,
                profileId: c.m.profileId,
              });
              const mapping =
                saved[mappingKey] ||
                (await mapJobRequirements(
                  job,
                  c.facts,
                  c.m.mode as Mode,
                  {
                    onCall: () => reserveCall(s.missionId, c.token),
                    onTool: (name) =>
                      patchRun(s.missionId, c.token, {}, 'Job Matcher', 'tool', name),
                    onUsage: (a, b) => appendUsage(s.missionId, c.token, a, b),
                    onSpan: spanHook({
                      userId: c.m.userId,
                      missionId: s.missionId,
                      agent: 'Job Matcher',
                    }),
                  },
                  c.signal,
                ));
              saved[mappingKey] = mapping;
              await patchRun(
                s.missionId,
                c.token,
                { requirementMappings: saved },
                'Job Matcher',
                'mapped',
                `Mapped requirements for ${job.title} against approved facts.`,
              );
              return scoreJobMapping(job, mapping, c.facts, c.p);
            }),
          );
          const failed = batch.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
          matches.push(
            ...batch.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
          );
        }
      }
      matches = matches
        .filter((r: any) => r.score >= (c.d.minScore ?? 40))
        .sort((a: any, b: any) => b.score - a.score || a.job.id.localeCompare(b.job.id));
      await patchRun(
        s.missionId,
        c.token,
        { matches, jobRetrieval },
        'Job Matcher',
        'completed',
        query.provider === 'fixtures'
          ? 'Read eight disclosed fixture advertisements; scores are not hiring probabilities.'
          : query.provider === 'manual'
            ? 'Ranked a user-pasted external listing; vacancy and content are unverified.'
            : 'Retrieved ' +
              jobs.length +
              ' source jobs, filtered by country/region and ranked without fixture substitution.',
      );
      return {};
    })

    // Interrupt nodes replay on resume: keep decision-dependent writes after interrupt().
    .addNode('select_job', async (s) => {
      const c = await context(s.missionId, 'matching');
      // A Scout package arrives with its job already shortlisted; the human gate is the draft review.
      if (c.d.scout && c.d.selectedJob) return {};
      const choice = interrupt({
        kind: 'job',
        message: 'Choose a target job from this mission’s ranked results.',
      }) as { kind: string; jobId: string };
      const selectedJob = c.d.matches.find((r: any) => r.job.id === choice.jobId);
      if (choice.kind !== 'job' || !selectedJob)
        throw new AppError(422, 'INVALID_JOB', 'Choose a job from the current ranked results.');
      await patchRun(
        s.missionId,
        c.token,
        { selectedJob },
        'Job Seeker',
        'selected',
        'Selected ' + selectedJob.job.title + ' for resume and interview preparation.',
      );
      return {};
    })

    // Resume team subgraph: Gap Analyzer -> Evidence Selector -> Rewriter -> Critic -> human.
    // Routing between specialists is decided inside the subgraph with Command handoffs.
    .addNode('resume_team', resumeTeam)

    // Questions and saved answers survive retries independently of provider execution.
    .addNode('interview_questions', async (s) => {
      const c = await context(s.missionId, 'interview');
      if (c.d.questions) return {};
      const result = await model(s.missionId, 'interview', 'questions', questionsSchema);
      if (new Set(result.questions.map((q) => q.id)).size !== result.questions.length)
        throw Error('Interview question IDs must be unique.');
      await patchRun(
        s.missionId,
        c.token,
        { questions: result.questions },
        'Interview Coach',
        'prepared',
        'Prepared role-specific questions from the selected job and approved profile.',
      );
      return {};
    })
    .addNode('conduct_interview', async (s) => {
      const c = await context(s.missionId, 'interview');
      const decision = interrupt({
        kind: 'interview',
        message:
          'Save your responses, then request feedback. You can finish early after one response.',
      }) as { kind: string; endedEarly: boolean };
      const now = await freshMission(s.missionId);
      const data = now.data as MissionData;
      const completion = getInterviewCompletion(
        (data.questions || []) as InterviewQuestion[],
        (data.answers || []) as InterviewAnswer[],
      );
      if (decision.kind !== 'interview' || !completion.answeredCount)
        throw Error('At least one saved response is required.');
      await patchRun(
        s.missionId,
        c.token,
        { endedEarly: completion.endedEarly },
        'Job Seeker',
        'interview_submitted',
        `${completion.answeredCount} of ${completion.questionCount} interview responses submitted for feedback.`,
      );
      return {};
    })
    .addNode('interview_feedback', async (s) => {
      const c = await context(s.missionId, 'interview');
      if (c.d.feedback) return {};
      const feedback = await model(s.missionId, 'interview', 'feedback', feedbackSchema);
      await patchRun(
        s.missionId,
        c.token,
        { feedback },
        'Interview Coach',
        'completed',
        'Feedback saved as practice observations; approved candidate facts remain unchanged.',
      );
      return {};
    })

    // Empty rankings finish early; resume revision loops are owned by the resume team.
    .addEdge(START, 'career_coach')
    .addEdge('career_coach', 'job_matching')
    .addConditionalEdges(
      'job_matching',
      async (s) => {
        const m = await freshMission(s.missionId);
        return (m.data as MissionData).matches?.length ? 'select_job' : END;
      },
      ['select_job', END],
    )
    // The resume team ends only after explicit approval of an exact draft.
    .addEdge('select_job', 'resume_team')
    .addEdge('resume_team', 'interview_questions')
    .addEdge('interview_questions', 'conduct_interview')
    .addEdge('conduct_interview', 'interview_feedback')
    .addEdge('interview_feedback', END)
    .compile({ checkpointer: saver });
  return {
    async run(id: string, lease: string, decision: unknown, signal: AbortSignal) {
      leases.set(id, { token: lease, signal });
      try {
        const config = { configurable: { thread_id: id }, recursionLimit: 40, signal };
        const state = await graph.getState(config);
        const saved = Boolean(state.values?.missionId);
        const paused = state.tasks?.some((t) => t.interrupts?.length);

        // Resume only a paused decision. Failed saved steps continue with null, avoiding decision replay.
        const input = saved
          ? paused && decision
            ? new Command<unknown, { missionId?: string }, never>({ resume: decision })
            : null
          : { missionId: id };
        return await graph.invoke(input, config);
      } finally {
        leases.delete(id);
      }
    },
    // Checkpoint history of the top-level mission graph, oldest first, with LangGraph's own next nodes.
    async history(id: string) {
      const out: {
        checkpointId: string;
        step: number;
        at: string | null;
        source: string | null;
        next: string[];
      }[] = [];
      for await (const snapshot of graph.getStateHistory({ configurable: { thread_id: id } }))
        out.push({
          checkpointId: String(snapshot.config.configurable?.checkpoint_id ?? ''),
          step: Number(snapshot.metadata?.step ?? -1),
          at: snapshot.createdAt ?? null,
          source: (snapshot.metadata?.source as string | undefined) ?? null,
          next: [...snapshot.next],
        });
      return out.reverse();
    },
    close: () => (portablePool ? Promise.resolve() : saver.end()),
  };
}
