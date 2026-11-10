import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { initScout, closeScout } from '../apps/api/src/scout.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';

let server: Server, base: string;
const users: string[] = [];

async function client() {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `qa-scout-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Scout QA',
    }),
  });
  const data = await r.json();
  users.push(data.user.id);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  for (let i = 0; i < 300; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error('Timed out');
}

beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  process.env.JOB_SOURCE = 'fixtures';
  delete process.env.OPENAI_NATIVE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await initQueue(true);
  await initScout(true);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await closeScout();
  await closeQueue();
  await new Promise<void>((r) => server.close(() => r()));
  for (const id of users) {
    const threads = [
      ...(await db.mission.findMany({ where: { userId: id }, select: { id: true } })).map(
        (m) => m.id,
      ),
      ...(await db.scoutSweep.findMany({ where: { userId: id }, select: { id: true } })).map(
        (s) => 'scout:' + s.id,
      ),
    ];
    for (const thread of threads) {
      await db.$executeRaw`DELETE FROM checkpoints WHERE thread_id = ${thread}`;
      await db.$executeRaw`DELETE FROM checkpoint_writes WHERE thread_id = ${thread}`;
      await db.$executeRaw`DELETE FROM checkpoint_blobs WHERE thread_id = ${thread}`;
    }
    await db.approvedResume.deleteMany({ where: { userId: id } });
    await db.mission.deleteMany({ where: { userId: id } });
    await db.profileDraft.deleteMany({ where: { userId: id } });
    await db.profile.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } });
  }
  await db.$disconnect();
});

it('a sweep records new roles, tailors the shortlist in parallel and never repeats a seen role', async () => {
  const c = await client(),
    stranger = await client();
  expect((await c('/scout/sweeps', 'POST', {})).status).toBe(409); // no approved profile yet
  const draft = await c('/profiles/drafts', 'POST', sampleProfile);
  await c(`/profiles/drafts/${draft.body.id}/approve`, 'POST', { reviewed: true });

  const initial = await c('/scout');
  expect(initial.body.setting).toMatchObject({ enabled: false, topK: 3 });
  expect(initial.body.setting.search.provider).toBe('fixtures');
  const saved = await c('/scout/settings', 'PUT', {
    ...initial.body.setting,
    enabled: true,
    topK: 2,
    minScore: 30,
  });
  expect(saved.body).toMatchObject({ enabled: true, topK: 2, minScore: 30 });
  expect(
    (await c('/scout/settings', 'PUT', { ...saved.body, topK: 9 })).status,
  ).toBeGreaterThanOrEqual(400);

  expect((await c('/scout/sweeps', 'POST', {})).status).toBe(202);
  const first = (
    await until(
      () => c('/scout'),
      (r) => r.body.sweeps[0]?.status === 'COMPLETE',
    )
  ).body;
  const sweep = first.sweeps[0];
  expect(sweep).toMatchObject({
    trigger: 'manual',
    mode: 'fixture',
    fetched: 8,
    fresh: 8,
    calls: 0,
    trace: { calls: 0, errors: 0 }, // fixture sweeps read no web pages and map no roles by model
  });
  expect(sweep.packages).toHaveLength(2);
  expect(sweep.packages[0].score).toBeGreaterThanOrEqual(sweep.packages[1].score);
  expect(sweep.handoffs.map((h: any) => `${h.from}>${h.to}`)).toEqual([
    'scout>job_matcher',
    'job_matcher>resume_team',
    'resume_team>human_review',
    'resume_team>human_review',
  ]);
  expect(first.trackedTotal).toBe(8);
  expect(first.tracked.every((t: any) => t.record.fictional && t.record.title)).toBe(true);

  // Each package is a quest that skips the job choice and stops at the draft review.
  for (const p of sweep.packages) {
    const m = (
      await until(
        () => c('/missions/' + p.missionId),
        (r) => r.body.status === 'AWAITING_APPROVAL',
      )
    ).body;
    expect(m.data.scout.sweepId).toBe(sweep.id);
    expect(m.data.selectedJob.job.id).toBe(p.jobId);
    expect(m.events[0]).toMatchObject({ agent: 'Scout', action: 'queued' });
    expect(m.events.some((e: any) => /job decision/.test(e.detail))).toBe(false);
    expect(m.data.resumeDraft.claims.length).toBeGreaterThan(0);
  }
  const ready = (await c('/scout')).body.sweeps[0].packages;
  expect(ready.map((p: any) => p.status)).toEqual(['AWAITING_APPROVAL', 'AWAITING_APPROVAL']);

  // Every specialist call leaves one span; fixture calls cost nothing and name no model.
  const trace = await c(`/missions/${ready[0].missionId}/trace`);
  expect(trace.status).toBe(200);
  expect(trace.body.totals.calls).toBeGreaterThan(0);
  expect(trace.body.totals).toMatchObject({ inputTokens: 0, outputTokens: 0, errors: 0 });
  expect(trace.body.byAgent.map((a: any) => a.agent)).toContain('Evidence Selector');
  expect(
    trace.body.spans.every((s: any) => s.model === 'fixture' && s.status === 'ok' && !s.attempts),
  ).toBe(true);
  expect((await stranger(`/missions/${ready[0].missionId}/trace`)).status).toBe(404);

  // Only the user approves; the approved package continues to interview preparation.
  const one = (await c('/missions/' + ready[0].missionId)).body;
  expect(
    (
      await c(`/missions/${one.id}/decisions`, 'POST', {
        kind: 'resume',
        decision: 'approve',
        draftHash: one.data.resumeDraft.hash,
      })
    ).status,
  ).toBe(202);
  await until(
    () => c('/missions/' + one.id),
    (r) => r.body.status === 'AWAITING_INTERVIEW',
  );
  expect((await c('/scout')).body.sweeps[0].packages[0].approved).toBe(true);

  // A second sweep finds the same eight roles and starts nothing.
  expect((await c('/scout/sweeps', 'POST', {})).status).toBe(202);
  const second = (
    await until(
      () => c('/scout'),
      (r) => r.body.sweeps.length === 2 && r.body.sweeps[0].status === 'COMPLETE',
    )
  ).body.sweeps[0];
  expect(second).toMatchObject({ fetched: 8, fresh: 0, alreadySeen: 8 });
  expect(second.packages).toEqual([]);
  expect(await db.mission.count({ where: { userId: users[0] } })).toBe(2);

  const other = (await stranger('/scout')).body;
  expect(other.sweeps).toEqual([]);
  expect(other.trackedTotal).toBe(0);
});
