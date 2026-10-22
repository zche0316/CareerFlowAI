import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
import { mutateRun, json } from '../apps/api/src/domain.js';

let server: Server, base: string;

type Client = {
  cookie: string;
  csrf: string;
  id: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<{ status: number; body: any }>;
};

const users: string[] = [];

async function client(): Promise<Client> {
  const email = `qa-${crypto.randomUUID()}@careerflow.test`;
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Disposable-QA-password', name: 'QA Candidate' }),
  });
  const data = await r.json();
  expect(r.status).toBe(201);
  users.push(data.user.id);
  const c = {
    cookie: r.headers.get('set-cookie')!.split(';')[0],
    csrf: data.csrf,
    id: data.user.id,
  } as Client;
  c.request = async (path, method = 'GET', body) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: { cookie: c.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': c.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json() };
  };
  return c;
}

async function profile(c: Client, input = sampleProfile) {
  const d = await c.request('/profiles/drafts', 'POST', input);
  expect(d.status).toBe(201);
  const r = await c.request(`/profiles/drafts/${d.body.id}/approve`, 'POST', { reviewed: true });
  expect(r.status).toBe(200);
  return r.body;
}

async function wait(c: Client, id: string, status: string) {
  for (let i = 0; i < 250; i++) {
    const r = await c.request('/missions/' + id);
    if (r.body.status === status) return r.body;
    if (r.body.status === 'FAILED') throw Error(r.body.error);
    await new Promise((r) => setTimeout(r, 70));
  }
  throw Error('Timed out waiting for ' + status);
}

async function prepareInterview(
  c: Client,
  goal = 'Prepare a factual interview for an analyst role.',
) {
  await profile(c);
  const made = await c.request('/missions', 'POST', { goal });
  expect(made.status).toBe(202);
  const id = made.body.id;
  const jobs = await wait(c, id, 'AWAITING_JOB');
  const job = jobs.data.matches[0];
  expect(job).toBeTruthy();
  expect(
    (
      await c.request(`/missions/${id}/decisions`, 'POST', {
        kind: 'job',
        jobId: job.job.id,
      })
    ).status,
  ).toBe(202);
  const draft = await wait(c, id, 'AWAITING_APPROVAL');
  expect(
    (
      await c.request(`/missions/${id}/decisions`, 'POST', {
        kind: 'resume',
        decision: 'approve',
        draftHash: draft.data.resumeDraft.hash,
      })
    ).status,
  ).toBe(202);
  const interview = await wait(c, id, 'AWAITING_INTERVIEW');
  return { id, job, interview };
}

beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  await initQueue(true);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await closeQueue();
  await new Promise<void>((r) => server.close(() => r()));
  for (const id of users) {
    const missions = await db.mission.findMany({ where: { userId: id }, select: { id: true } });
    for (const m of missions) {
      await db.$executeRaw`DELETE FROM checkpoints WHERE thread_id = ${m.id}`;
      await db.$executeRaw`DELETE FROM checkpoint_writes WHERE thread_id = ${m.id}`;
      await db.$executeRaw`DELETE FROM checkpoint_blobs WHERE thread_id = ${m.id}`;
    }
    await db.approvedResume.deleteMany({ where: { userId: id } });
    await db.mission.deleteMany({ where: { userId: id } });
    await db.profileDraft.deleteMany({ where: { userId: id } });
    await db.profile.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } });
  }
  await db.$disconnect();
});
describe('Owned, durable five-agent journey', () => {
  it('propagates request IDs and meets local load/save latency budgets', async () => {
    const c = await client();
    const health = await fetch(base + '/api/health', {
      headers: { 'X-Request-ID': 'qa-quality-request-01' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('x-request-id')).toBe('qa-quality-request-01');
    const generatedId = await fetch(base + '/api/health', {
      headers: { 'X-Request-ID': 'invalid request id' },
    });
    expect(generatedId.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,
    );
    const errorResponse = await fetch(base + '/api/not-a-real-route', {
      headers: { cookie: c.cookie, 'X-Request-ID': 'qa-quality-error-01' },
    });
    expect(errorResponse.status).toBe(404);
    expect(errorResponse.headers.get('x-request-id')).toBe('qa-quality-error-01');
    expect((await errorResponse.json()).requestId).toBe('qa-quality-error-01');

    await profile(c);
    const loadTimes: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      expect((await c.request('/workspace')).status).toBe(200);
      loadTimes.push(performance.now() - started);
    }
    expect(Math.max(...loadTimes)).toBeLessThan(2000);

    const draftStarted = performance.now();
    const draft = await c.request('/profiles/drafts', 'POST', {
      ...sampleProfile,
      goals: 'Measure a reviewed profile save under the local quality budget.',
    });
    expect(draft.status).toBe(201);
    const draftMs = performance.now() - draftStarted;
    expect(draftMs).toBeLessThan(2000);
    const approvalStarted = performance.now();
    expect(
      (
        await c.request(`/profiles/drafts/${draft.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    const approvalMs = performance.now() - approvalStarted;
    expect(approvalMs).toBeLessThan(2000);
    console.info(
      `[quality] workspace-load max=${Math.max(...loadTimes).toFixed(1)}ms draft-save=${draftMs.toFixed(1)}ms approval-save=${approvalMs.toFixed(1)}ms`,
    );
  });
  it('completes the profile → career → job → approved resume → interview journey', async () => {
    const c = await client();
    await profile(c);
    const made = await c.request('/missions', 'POST', {
      goal: 'Prepare a factual application for an entry-level analyst role.',
    });
    expect(made.status).toBe(202);
    const id = made.body.id;
    const jobs = await wait(c, id, 'AWAITING_JOB');
    expect(jobs.data.analysis.strengths.length).toBeGreaterThan(0);
    expect(jobs.data.matches.length).toBeGreaterThan(0);
    expect(jobs.data.apiCalls).toBe(0);
    expect(
      (await c.request(`/missions/${id}/decisions`, 'POST', { kind: 'job', jobId: 'forged' }))
        .status,
    ).toBe(422);
    expect(
      (
        await c.request(`/missions/${id}/decisions`, 'POST', {
          kind: 'job',
          jobId: jobs.data.matches[0].job.id,
        })
      ).status,
    ).toBe(202);
    let draft = await wait(c, id, 'AWAITING_APPROVAL');
    expect(await db.approvedResume.count({ where: { userId: c.id } })).toBe(0);
    expect(
      (
        await c.request(`/missions/${id}/decisions`, 'POST', {
          kind: 'resume',
          decision: 'approve',
          draftHash: 'stale',
        })
      ).status,
    ).toBe(409);
    const previous = draft.data.resumeDraft.hash;
    await c.request(`/missions/${id}/decisions`, 'POST', {
      kind: 'resume',
      decision: 'revise',
      draftHash: previous,
      feedback: 'Emphasise SQL evidence.',
    });
    for (let i = 0; i < 180; i++) {
      draft = await wait(c, id, 'AWAITING_APPROVAL');
      if (draft.data.resumeDraft.hash !== previous) break;
      await new Promise((r) => setTimeout(r, 70));
    }
    expect(draft.data.resumeDraft.hash).not.toBe(previous);
    expect(await db.approvedResume.count({ where: { userId: c.id } })).toBe(0);
    await closeQueue();
    await initQueue(true); // Persistent checkpoints must survive worker restart while awaiting approval.
    await c.request(`/missions/${id}/decisions`, 'POST', {
      kind: 'resume',
      decision: 'approve',
      draftHash: draft.data.resumeDraft.hash,
    });
    const interview = await wait(c, id, 'AWAITING_INTERVIEW');
    expect(await db.approvedResume.count({ where: { userId: c.id } })).toBe(1);
    const q = interview.data.questions[0];
    expect(
      (
        await c.request(`/missions/${id}/answers`, 'PUT', {
          questionId: 'forged-question',
          answer: 'This question is not part of the current interview.',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await c.request(`/missions/${id}/answers`, 'PUT', {
          questionId: q.id,
          answer:
            'In my student project I used SQL to inspect a sample dataset and produce a report.',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await c.request(`/missions/${id}/answers`, 'PUT', {
          questionId: q.id,
          answer:
            'In my student project I used SQL to inspect a sample dataset, reconcile missing values and produce a reviewed report.',
        })
      ).status,
    ).toBe(200);
    expect((await c.request(`/missions/${id}`)).body.data.answers).toHaveLength(1);
    await db.mission.update({ where: { id }, data: { mode: 'openai' } });
    // The server derives completion from persisted answers rather than trusting the client flag.
    await c.request(`/missions/${id}/decisions`, 'POST', {
      kind: 'interview',
      endedEarly: false,
    });
    let failed: any;
    for (let i = 0; i < 180; i++) {
      failed = (await c.request('/missions/' + id)).body;
      if (failed.status === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 70));
    }
    expect(failed.status).toBe('FAILED');
    expect(failed.data.answers).toHaveLength(1);
    expect(failed.data.approvedResumeId).toBeTruthy();
    await db.mission.update({ where: { id }, data: { mode: 'fixture' } });
    await c.request(`/missions/${id}/retry`, 'POST', {});
    const done = await wait(c, id, 'COMPLETE');
    expect(done.data.feedback.improvements.length).toBeGreaterThan(0);
    expect(done.data.answers).toHaveLength(1);
    expect(done.data.endedEarly).toBe(true);
    expect(done.data.resumeDraft.claims.every((x: any) => x.factId && x.source)).toBe(true);
  });
  it('handles no suitable jobs and a recoverable job-source failure', async () => {
    const c = await client();
    await profile(c);
    const empty = await c.request('/missions', 'POST', {
      goal: 'Find an exact-match senior role.',
      minScore: 100,
    });
    const noMatches = await wait(c, empty.body.id, 'NO_MATCHES');
    expect(noMatches.data.matches).toEqual([]);
    const made = await c.request('/missions', 'POST', {
      goal: 'Find an entry-level analyst role.',
      simulateSourceFailure: true,
    });
    let failed: any;
    for (let i = 0; i < 200; i++) {
      failed = (await c.request('/missions/' + made.body.id)).body;
      if (failed.status === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 70));
    }
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toContain('Job source unavailable');
    await c.request(`/missions/${made.body.id}/retry`, 'POST', {});
    expect((await wait(c, made.body.id, 'AWAITING_JOB')).data.matches.length).toBeGreaterThan(0);
    await c.request(`/missions/${made.body.id}/cancel`, 'POST', {});
  });
  it('requests profile correction and preserves approved data when Career Coach fails', async () => {
    const c = await client();
    const missing = await c.request('/missions', 'POST', {
      goal: 'Ask the Career Coach for a direction.',
    });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('PROFILE_REQUIRED');
    const approved = await profile(c);

    const saved = {
      mode: process.env.PROVIDER_MODE,
      key: process.env.OPENAI_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      model: process.env.OPENAI_MODEL,
      baseUrl: process.env.OPENAI_BASE_URL,
    };
    try {
      process.env.PROVIDER_MODE = 'openai';
      delete process.env.OPENAI_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      const made = await c.request('/missions', 'POST', {
        goal: 'Ask for evidence-based career guidance.',
      });
      expect(made.status).toBe(202);
    } finally {
      process.env.PROVIDER_MODE = saved.mode;
      if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved.key;
      if (saved.deepseek === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = saved.deepseek;
      if (saved.model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = saved.model;
      if (saved.baseUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = saved.baseUrl;
    }
    const mission = await db.mission.findFirstOrThrow({
      where: { userId: c.id, goal: 'Ask for evidence-based career guidance.' },
    });
    let failed: any;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      failed = (await c.request(`/missions/${mission.id}`)).body;
      if (failed.status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toContain('Live AI requires');
    const workspace = (await c.request('/workspace')).body;
    expect(workspace.profile.id).toBe(approved.id);
    expect(workspace.profile.data.goals).toBe(sampleProfile.goals);
  });
  it('grounds every recommendation and creates a new mission from analysis feedback', async () => {
    const c = await client();
    const other = await client();
    const approved = await profile(c);
    const knownFacts = new Set((approved.facts as any[]).map((fact) => fact.id));
    const source = await c.request('/missions', 'POST', {
      goal: 'Find an entry-level analyst role.',
    });
    const sourceMission = await wait(c, source.body.id, 'AWAITING_JOB');
    for (const group of ['strengths', 'gaps', 'directions', 'actions'] as const) {
      expect(sourceMission.data.analysis[group].length).toBeGreaterThan(0);
      for (const item of sourceMission.data.analysis[group]) {
        expect(item.reason.length).toBeGreaterThan(0);
        expect(item.evidenceIds.length).toBeGreaterThan(0);
        expect(item.evidenceIds.every((id: string) => knownFacts.has(id))).toBe(true);
      }
    }
    await profile(other);
    expect(
      (
        await other.request('/missions', 'POST', {
          goal: 'Try to refine another user’s analysis.',
          sourceMissionId: source.body.id,
          analysisFeedback: 'Focus on SQL evidence.',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await c.request('/missions', 'POST', {
          goal: source.body.goal,
          sourceMissionId: source.body.id,
          analysisFeedback: 'x',
        })
      ).status,
    ).toBe(422);

    const refined = await c.request('/missions', 'POST', {
      goal: source.body.goal,
      sourceMissionId: source.body.id,
      analysisFeedback: 'Focus on SQL evidence and explain the reporting direction.',
    });
    expect(refined.status).toBe(202);
    const refinedMission = await wait(c, refined.body.id, 'AWAITING_JOB');
    expect(refinedMission.data.refinedFromMissionId).toBe(source.body.id);
    expect(refinedMission.data.analysisFeedback).toContain('SQL evidence');
    expect(
      refinedMission.data.analysis.actions.some((action: any) =>
        action.reason.includes('SQL evidence'),
      ),
    ).toBe(true);
    expect(sourceMission.status).toBe('AWAITING_JOB');
  });
  it('completes every interview question and rejects forged or cross-user submissions', async () => {
    const c = await client();
    const other = await client();
    const { id, interview } = await prepareInterview(
      c,
      'Prepare for a complete entry-level analyst interview.',
    );
    const questions = interview.data.questions;
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(3);
    expect(new Set(questions.map((question: any) => question.id)).size).toBe(questions.length);
    expect(
      questions.some((question: any) =>
        question.question.includes(interview.data.selectedJob.job.title),
      ),
    ).toBe(true);

    expect(
      (
        await other.request(`/missions/${id}/answers`, 'PUT', {
          questionId: questions[0].id,
          answer: 'A different user must not be able to submit this answer.',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await c.request(`/missions/${id}/decisions`, 'POST', {
          kind: 'interview',
          endedEarly: false,
        })
      ).status,
    ).toBe(422);

    for (const [index, question] of questions.entries()) {
      const saved = await c.request(`/missions/${id}/answers`, 'PUT', {
        questionId: question.id,
        answer: `Role-specific answer ${index + 1} with a concrete action and result.`,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.answers.map((answer: any) => answer.questionId)).toEqual(
        questions.slice(0, index + 1).map((item: any) => item.id),
      );
    }

    // Spoofing the opposite client flag must not override persisted completion.
    expect(
      (
        await c.request(`/missions/${id}/decisions`, 'POST', {
          kind: 'interview',
          endedEarly: true,
        })
      ).status,
    ).toBe(202);
    const done = await wait(c, id, 'COMPLETE');
    expect(done.data.endedEarly).toBe(false);
    expect(done.data.answers).toHaveLength(questions.length);
    expect(done.data.answers.map((answer: any) => answer.questionId)).toEqual(
      questions.map((question: any) => question.id),
    );
    expect(done.data.feedback.strengths.length).toBeGreaterThan(0);
    expect(done.data.feedback.improvements.length).toBeGreaterThan(0);
    expect(done.data.feedback.nextSteps.length).toBeGreaterThan(0);
  });
  it('lets the owner practise negotiation and records only their final practice decision', async () => {
    const owner = await client();
    const other = await client();
    const { id, interview } = await prepareInterview(
      owner,
      'Prepare for an analyst interview and salary discussion.',
    );
    const [question] = interview.data.questions;
    await owner.request(`/missions/${id}/answers`, 'PUT', {
      questionId: question.id,
      answer: 'I used SQL to prepare a reviewed report for a student project.',
    });
    await owner.request(`/missions/${id}/decisions`, 'POST', {
      kind: 'interview',
      endedEarly: true,
    });
    await wait(owner, id, 'COMPLETE');

    const input = {
      offerSalary: 65_000,
      targetSalary: 72_000,
      currency: 'AUD',
      candidateMessage:
        'I am excited about the role and would like to discuss the salary range based on the scope and my confirmed evidence.',
    };
    expect((await other.request(`/missions/${id}/negotiation`, 'POST', input)).status).toBe(404);
    const practised = await owner.request(`/missions/${id}/negotiation`, 'POST', input);
    expect(practised.status).toBe(201);
    expect(practised.body.status).toBe('COMPLETE');
    expect(practised.body.data.negotiation).toMatchObject({
      offerSalary: 65_000,
      targetSalary: 72_000,
      currency: 'AUD',
      status: 'REVIEW',
    });
    expect(practised.body.data.negotiation.recruiterReply).toContain(
      interview.data.selectedJob.job.title,
    );
    expect(practised.body.data.negotiation.feedback.strengths.length).toBeGreaterThan(0);
    expect(practised.body.data.negotiation.feedback.improvements.length).toBeGreaterThan(0);
    expect(practised.body.data.negotiation.feedback.nextSteps.length).toBeGreaterThan(0);

    expect(
      (
        await other.request(`/missions/${id}/negotiation/decision`, 'PUT', {
          decision: 'accept',
        })
      ).status,
    ).toBe(404);
    const decided = await owner.request(`/missions/${id}/negotiation/decision`, 'PUT', {
      decision: 'accept',
    });
    expect(decided.status).toBe(200);
    expect(decided.body.data.negotiation).toMatchObject({
      status: 'DECIDED',
      userDecision: 'accept',
    });
    expect(
      (
        await owner.request(`/missions/${id}/negotiation/decision`, 'PUT', {
          decision: 'decline',
        })
      ).status,
    ).toBe(409);
    const persisted = (await owner.request(`/missions/${id}`)).body;
    expect(persisted.status).toBe('COMPLETE');
    expect(persisted.data.negotiation.userDecision).toBe('accept');
  });
  it('denies cross-user reads, decisions and approval of another user’s draft', async () => {
    const a = await client(),
      b = await client();
    const draft = await a.request('/profiles/drafts', 'POST', sampleProfile);
    expect(
      (await b.request(`/profiles/drafts/${draft.body.id}/approve`, 'POST', { reviewed: true }))
        .status,
    ).toBe(404);
    await profile(a);
    const m = await a.request('/missions', 'POST', {
      goal: 'Prepare an entry-level job application.',
    });
    expect((await b.request('/missions/' + m.body.id)).status).toBe(404);
    expect(
      (await b.request(`/missions/${m.body.id}/decisions`, 'POST', { kind: 'job', jobId: 'j1' }))
        .status,
    ).toBe(404);
    await a.request(`/missions/${m.body.id}/cancel`, 'POST', {});
  });
  it('requests an approved, shareable profile before an interview mission can begin', async () => {
    const c = await client();
    const missing = await c.request('/missions', 'POST', {
      goal: 'Prepare a role-specific interview.',
    });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('PROFILE_REQUIRED');

    await profile(c, {
      ...sampleProfile,
      sharing: { ...sampleProfile.sharing, interview: false },
    });
    const denied = await c.request('/missions', 'POST', {
      goal: 'Prepare a role-specific interview.',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('SHARING_REQUIRED');
  });
  it('requires server-side review, rejects stale profile drafts and invalid changes', async () => {
    const c = await client();
    const a = await c.request('/profiles/drafts', 'POST', sampleProfile),
      b = await c.request('/profiles/drafts', 'POST', {
        ...sampleProfile,
        goals: 'A different career direction',
      });
    expect(
      (await c.request(`/profiles/drafts/${a.body.id}/approve`, 'POST', { approved: true })).status,
    ).toBe(422);
    await c.request(`/profiles/drafts/${a.body.id}/approve`, 'POST', { reviewed: true });
    expect(
      (await c.request(`/profiles/drafts/${b.body.id}/approve`, 'POST', { reviewed: true })).status,
    ).toBe(409);
    expect(
      (await c.request('/profiles/drafts', 'POST', { ...sampleProfile, goals: '' })).status,
    ).toBe(422);
    expect((await c.request('/workspace')).body.profile.version).toBe(1);
  });
  it('preserves approved profile versions while isolating, discarding and filtering drafts', async () => {
    const owner = await client();
    const other = await client();
    const firstDraft = await owner.request('/profiles/drafts', 'POST', sampleProfile);
    expect(firstDraft.status).toBe(201);
    expect(
      (
        await owner.request(`/profiles/drafts/${firstDraft.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    expect((await owner.request('/workspace')).body.profile.version).toBe(1);

    const pending = await owner.request('/profiles/drafts', 'POST', {
      ...sampleProfile,
      goals: 'Move toward a reporting and analytics role.',
    });
    expect(pending.status).toBe(201);
    expect(pending.body.baseVersion).toBe(1);
    expect((await owner.request('/workspace')).body.profile.version).toBe(1);
    expect(
      (
        await other.request(`/profiles/drafts/${pending.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(404);
    expect((await other.request(`/profiles/drafts/${pending.body.id}`, 'DELETE')).status).toBe(404);
    expect((await owner.request(`/profiles/drafts/${pending.body.id}`, 'DELETE')).status).toBe(200);
    expect(
      (
        await owner.request(`/profiles/drafts/${pending.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(409);

    const secondDraft = await owner.request('/profiles/drafts', 'POST', {
      ...sampleProfile,
      goals: 'Move toward a reporting and analytics role.',
      sharing: { ...sampleProfile.sharing, interview: false },
    });
    expect(
      (
        await owner.request(`/profiles/drafts/${secondDraft.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    const workspace = (await owner.request('/workspace')).body;
    expect(workspace.profile.version).toBe(2);
    expect(workspace.profile.data.sharing.interview).toBe(false);

    const profiles = await db.profile.findMany({
      where: { userId: owner.id },
      orderBy: { version: 'asc' },
    });
    expect(profiles.map((profile) => profile.version)).toEqual([1, 2]);
    expect((profiles[0].data as any).goals).toBe(sampleProfile.goals);
    expect(
      (await owner.request('/missions', 'POST', { goal: 'Use the new profile.' })).status,
    ).toBe(403);
  });
  it('hands only the approved, permitted profile to downstream agents', async () => {
    const owner = await client();
    const approved = await profile(owner);
    const pending = await owner.request('/profiles/drafts', 'POST', {
      ...sampleProfile,
      goals: 'This unapproved goal must not reach a downstream agent.',
    });
    expect(pending.status).toBe(201);
    const mission = await owner.request('/missions', 'POST', {
      goal: 'Use the currently approved profile only.',
    });
    expect(mission.status).toBe(202);
    expect(mission.body.profileId).toBe(approved.id);
    const waiting = await wait(owner, mission.body.id, 'AWAITING_JOB');
    expect(waiting.profile.id).toBe(approved.id);
    expect(waiting.profile.version).toBe(1);
    expect(waiting.profile.data.goals).toBe(sampleProfile.goals);

    expect(
      (
        await owner.request(`/profiles/drafts/${pending.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    expect((await owner.request(`/missions/${mission.body.id}`)).body.status).toBe('STALE');
    expect(
      (
        await owner.request(`/missions/${mission.body.id}/decisions`, 'POST', {
          kind: 'job',
          jobId: waiting.data.matches[0].job.id,
        })
      ).status,
    ).toBe(409);

    const missing = await client();
    expect(
      (
        await missing.request('/profiles/drafts', 'POST', {
          ...sampleProfile,
          goals: '',
        })
      ).status,
    ).toBe(422);
    expect((await missing.request('/workspace')).body.profile).toBeNull();

    const cancelled = await client();
    const draft = await cancelled.request('/profiles/drafts', 'POST', sampleProfile);
    expect((await cancelled.request(`/profiles/drafts/${draft.body.id}`, 'DELETE')).status).toBe(
      200,
    );
    expect((await cancelled.request('/workspace')).body.profile).toBeNull();

    const partial = await client();
    await profile(partial, {
      ...sampleProfile,
      sharing: { ...sampleProfile.sharing, coach: false },
    });
    expect(
      (
        await partial.request('/missions', 'POST', {
          goal: 'Attempt a mission with missing sharing permission.',
        })
      ).status,
    ).toBe(403);
  });
  it('rolls back a failed profile approval and preserves the previous approved version', async () => {
    const owner = await client();
    const first = await owner.request('/profiles/drafts', 'POST', sampleProfile);
    expect(
      (
        await owner.request(`/profiles/drafts/${first.body.id}/approve`, 'POST', {
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    const draft = await owner.request('/profiles/drafts', 'POST', {
      ...sampleProfile,
      goals: 'Move into a reviewed reporting role.',
    });
    const conflict = await db.profile.create({
      data: {
        userId: owner.id,
        version: 2,
        data: json({ ...sampleProfile, goals: 'Rollback sentinel' }),
        facts: json([]),
      },
    });

    const failed = await owner.request(`/profiles/drafts/${draft.body.id}/approve`, 'POST', {
      reviewed: true,
    });
    expect(failed.status).toBe(409);
    expect(failed.body.code).toBe('CONFLICT');
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user.profileVersion).toBe(1);
    const previous = await db.profile.findFirstOrThrow({
      where: { userId: owner.id, version: 1 },
    });
    expect((previous.data as any).goals).toBe(sampleProfile.goals);
    expect((await db.profileDraft.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe(
      'DRAFT',
    );

    await db.profile.delete({ where: { id: conflict.id } });
    const approved = await owner.request(`/profiles/drafts/${draft.body.id}/approve`, 'POST', {
      reviewed: true,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.version).toBe(2);
    expect((await owner.request('/workspace')).body.profile.data.goals).toBe(
      'Move into a reviewed reporting role.',
    );
  });
  it('marks in-flight work stale on profile replacement and blocks further decisions', async () => {
    const c = await client();
    await profile(c);
    const made = await c.request('/missions', 'POST', { goal: 'Prepare an analyst application.' });
    await wait(c, made.body.id, 'AWAITING_JOB');
    await profile(c, { ...sampleProfile, location: 'Melbourne' });
    expect((await c.request('/missions/' + made.body.id)).body.status).toBe('STALE');
    expect(
      (await c.request(`/missions/${made.body.id}/decisions`, 'POST', { kind: 'job', jobId: 'j1' }))
        .status,
    ).toBe(409);
  });
  it('prevents a cancelled run from committing a late result', async () => {
    const c = await client();
    const p = await profile(c);
    const m = await db.mission.create({
      data: {
        userId: c.id,
        profileId: p.id,
        goal: 'QA cancellation race',
        mode: 'fixture',
        status: 'RUNNING',
        leaseToken: 'qa-lease',
        data: json({}),
        events: json([]),
      },
    });
    await c.request(`/missions/${m.id}/cancel`, 'POST', {});
    await expect(
      mutateRun(m.id, 'qa-lease', async (tx, current) => {
        await tx.mission.update({ where: { id: current.id }, data: { status: 'COMPLETE' } });
      }),
    ).rejects.toThrow(/cancelled/);
    expect((await c.request('/missions/' + m.id)).body.status).toBe('CANCELLED');
  });
  it('requires task sharing and protects cookie-authenticated writes from CSRF', async () => {
    const c = await client();
    await profile(c, { ...sampleProfile, sharing: { ...sampleProfile.sharing, resume: false } });
    expect((await c.request('/missions', 'POST', { goal: 'Prepare my application.' })).status).toBe(
      403,
    );
    const r = await fetch(base + '/api/profiles/drafts', {
      method: 'POST',
      headers: { cookie: c.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleProfile),
    });
    expect(r.status).toBe(403);

    const noInterview = await client();
    await profile(noInterview, {
      ...sampleProfile,
      sharing: { ...sampleProfile.sharing, interview: false },
    });
    expect(
      (
        await noInterview.request('/missions', 'POST', {
          goal: 'Prepare an interview without sharing permission.',
        })
      ).status,
    ).toBe(403);
  });
});
