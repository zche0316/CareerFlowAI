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
    const extra = interview.data.questions[1];
    expect(
      (
        await c.request(`/missions/${id}/answers`, 'PUT', {
          questionId: q.id,
          answer:
            'In my student project I used SQL to inspect a sample dataset and produce a report.',
        })
      ).status,
    ).toBe(200);
    await db.mission.update({ where: { id }, data: { mode: 'openai' } });
    await c.request(`/missions/${id}/decisions`, 'POST', { kind: 'interview', endedEarly: true });
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
  });
});
