import { JobRepository } from '../../recruitment/src/repository.js';
import { Annotation, StateGraph, START, END, interrupt } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { db, databaseUrl, portablePool } from '../../../apps/api/src/db.js';
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
  deduplicateResumeClaims,
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
} from '../../contracts/src/index.js';
import { generate, type Mode } from './provider.js';
import { compare } from '../../matching/domain.js';

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
    if (!p.sharing[permission])
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
    const result = await generate(
      role,
      {
        goal: c.m.goal,
        facts: c.facts,
        analysisFeedback: role === 'coach' ? c.d.analysisFeedback : undefined,
        job: c.d.selectedJob?.job,
        questions: c.d.questions,
        answers: c.d.answers,
        feedback: c.d.resumeFeedback,
        priorFeedback: c.d.priorFeedback,
      },
      schema,
      c.m.mode as Mode,
      {
        onCall: () => reserveCall(id, c.token),
        onTool: (name) => patchRun(id, c.token, {}, role, 'tool', name),
        onUsage: (a, b) => appendUsage(id, c.token, a, b),
      },
      c.signal,
    );
    return result;
  };

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
          limitations: fetched.limitations || [],
          fetchedAt: new Date().toISOString(),
        };
      }
      const corpus = jobs.map((j: any) => j.title + ' ' + j.description);
      const legacy = { ...c.p, approved: true };
      const matches = jobs
        .map((j: any) => compare(legacy, j, corpus))
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

    // Resume generation chooses approved evidence and binds the rendered draft to a content hash.
    .addNode('resume_tailoring', async (s) => {
      const c = await context(s.missionId, 'resume');
      if (c.d.resumeDraft) return {};
      const eligibleFacts = new Map(
        c.facts
          .filter(
            (fact) =>
              ['skill', 'education', 'experience'].includes(fact.kind) &&
              !/^none yet$/i.test(fact.text),
          )
          .map((fact) => [fact.id, fact]),
      );
      const eligibleFactIds = [...eligibleFacts.keys()];
      if (!eligibleFactIds.length)
        throw new AppError(
          422,
          'EVIDENCE_REQUIRED',
          'Approve at least one skill, education or experience fact before tailoring a resume.',
        );
      const groundedResumeSchema = z.object({
        claims: z
          .array(
            z.object({
              factId: z.enum(eligibleFactIds as [string, ...string[]]),
              reason: z.string().trim().min(1).max(1000),
            }),
          )
          .min(1)
          .max(20),
      });
      const plan = await model(s.missionId, 'resume', 'resume', groundedResumeSchema);
      const claims = validateResumeClaims(deduplicateResumeClaims(plan.claims), c.facts);
      const draft = {
        missionId: s.missionId,
        jobTitle: c.d.selectedJob.job.title,
        name: c.p.name,
        profileVersion: c.m.profile.version,
        claims,
        omittedFacts: c.facts.filter(
          (f) =>
            ['skill', 'education', 'experience'].includes(f.kind) &&
            !claims.some((claim) => claim.factId === f.id),
        ),
        revision: c.d.revisions || 0,
      };
      await patchRun(
        s.missionId,
        c.token,
        { resumeDraft: { ...draft, hash: digest(draft) } },
        'Resume Tailor',
        'completed',
        'Built an extractive draft. Every candidate claim is verbatim approved evidence; no unsupported candidate claims can be inserted.',
      );
      return {};
    })
    .addNode('approve_resume', async (s) => {
      const c = await context(s.missionId, 'resume');
      const decision = interrupt({
        kind: 'resume',
        draftHash: c.d.resumeDraft.hash,
        message:
          'Review the proposed resume and evidence. Approve, request emphasis changes, or cancel.',
      }) as { kind: string; decision: string; draftHash: string; feedback: string };
      if (decision.kind !== 'resume' || decision.draftHash !== c.d.resumeDraft.hash)
        throw new AppError(409, 'STALE_APPROVAL', 'Review the current resume draft.');
      if (decision.decision === 'revise') {
        if ((c.d.revisions || 0) >= 2) throw Error('Revision limit reached.');
        await patchRun(
          s.missionId,
          c.token,
          {
            resumeDraft: null,
            resumeFeedback: decision.feedback,
            revisions: (c.d.revisions || 0) + 1,
          },
          'Job Seeker',
          'revision_requested',
          'Draft not approved. Reorder or re-emphasise supported evidence only.',
        );
        return {};
      }
      if (decision.decision !== 'approve') throw Error('Invalid approval decision.');
      try {
        await mutateRun(s.missionId, c.token, async (tx, m) => {
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
      } catch (error) {
        if (error instanceof AppError) throw error;
        // Persist a small domain error in the checkpoint, not a driver error object.
        throw new AppError(
          503,
          'RESUME_SAVE_FAILED',
          'Your resume could not be saved. The approved draft and previous resumes are preserved. Retry saving or cancel.',
        );
      }
      return {};
    })

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

    // Empty rankings finish early; revision requests loop back before interview preparation.
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
    .addEdge('select_job', 'resume_tailoring')
    .addEdge('resume_tailoring', 'approve_resume')
    .addConditionalEdges(
      'approve_resume',
      async (s) => {
        const m = await freshMission(s.missionId);
        return (m.data as MissionData).resumeDraft ? 'interview_questions' : 'resume_tailoring';
      },
      ['interview_questions', 'resume_tailoring'],
    )
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
    close: () => (portablePool ? Promise.resolve() : saver.end()),
  };
}
