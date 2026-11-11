import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { initScout, closeScout } from '../apps/api/src/scout.js';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import { migrateRoleLibrary } from '../apps/api/src/role-library.js';
import { jobFingerprint, placeKey } from '../packages/agents/src/scout/scout.js';
import { sampleProfile } from '../packages/contracts/src/index.js';

// CFS-103: one role library. Every search records what it showed, Scout skips roles already seen
// or on the board, and stored rows are merged when the fingerprint says they are the same role.

let server: Server, base: string;
const users: string[] = [];
type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: any }>;

async function client(withProfile = true): Promise<{ id: string; call: Call }> {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `qa-roles-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Roles QA',
    }),
  });
  const data = await r.json();
  users.push(data.user.id);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const call: Call = async (path, method = 'GET', body) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
  if (withProfile) {
    const draft = await call('/profiles/drafts', 'POST', sampleProfile);
    await call(`/profiles/drafts/${draft.body.id}/approve`, 'POST', { reviewed: true });
  }
  return { id: data.user.id, call };
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

it('treats spelling differences between boards as the same role', () => {
  const a = { company: 'Acme Pty Ltd', title: 'Sr. Data Analyst', location: 'Sydney NSW 2000' };
  const b = {
    company: 'ACME',
    title: 'Senior Data Analyst',
    location: 'Hybrid - Sydney, New South Wales',
  };
  expect(jobFingerprint(a)).toBe(jobFingerprint(b));
  expect(jobFingerprint(a)).not.toBe(jobFingerprint({ ...b, location: 'Melbourne VIC' }));
  expect(jobFingerprint({ ...a, company: 'SA Power Networks' })).not.toBe(
    jobFingerprint({ ...a, company: 'Power Networks' }),
  );
  expect(placeKey('North Sydney, NSW')).toBe('north sydney');
  expect(placeKey('Remote')).toBe('');
});

it('shares one library between Find roles, Scout and the board', async () => {
  const { call } = await client();
  // A Find roles run records every role it showed and tags its ranked roles.
  const search = (await call('/missions', 'POST', { goal: 'Find a graduate analyst role.' })).body;
  const shortlist = (
    await until(
      () => call(`/missions/${search.id}`),
      (r) => r.body.status === 'AWAITING_JOB',
    )
  ).body;
  expect(shortlist.data.matches.every((m: any) => /^[a-f0-9]{32}$/.test(m.fingerprint))).toBe(true);
  const first = shortlist.data.matches[0];
  await call(`/missions/${search.id}/saved-roles`, 'POST', { jobId: first.job.id });

  // Scout sees all eight demo roles as already seen: nothing new, no package runs.
  const setting = (await call('/scout')).body.setting;
  await call('/scout/settings', 'PUT', { ...setting, enabled: true, topK: 2, minScore: 0 });
  expect((await call('/scout/sweeps', 'POST', {})).status).toBe(202);
  const scout = (
    await until(
      () => call('/scout'),
      (r) => r.body.sweeps[0]?.status === 'COMPLETE',
    )
  ).body;
  expect(scout.sweeps[0]).toMatchObject({ fetched: 8, fresh: 0 });
  expect(scout.sweeps[0].packages).toHaveLength(0);
  expect(scout.trackedTotal).toBe(8);
  const onBoard = scout.tracked.find((t: any) => t.fingerprint === first.fingerprint);
  expect(onBoard.board).toMatchObject({ stage: 'saved' });

  // A role Scout recorded can be saved to the board from its table, once.
  const other = scout.tracked.find((t: any) => !t.board);
  expect((await call(`/scout/roles/${other.fingerprint}/save`, 'POST')).status).toBe(201);
  await call(`/scout/roles/${other.fingerprint}/save`, 'POST');
  const board = (await call('/applications')).body;
  expect(board).toHaveLength(2);
  expect(board.map((a: any) => a.fingerprint).sort()).toEqual(
    [first.fingerprint, other.fingerprint].sort(),
  );
  expect((await call('/scout/roles/' + 'f'.repeat(32) + '/save', 'POST')).status).toBe(404);

  // Statistics come from the board.
  await call(`/applications/${board[0].id}`, 'PATCH', { status: 'applied' });
  const dashboard = (await call('/tools/dashboard')).body;
  expect(dashboard.total).toBe(1);
  expect(dashboard.applications[0]).toMatchObject({
    applicationId: board[0].id,
    status: 'applied',
  });
});

it('merges stored duplicates under the new fingerprint and keeps demo and live boards apart', async () => {
  const { id, call } = await client();
  const profile = (await db.profile.findFirst({ where: { userId: id } }))!;
  const job = (company: string, title: string, location: string) => ({
    job: {
      id: crypto.randomUUID(),
      company,
      title,
      location,
      description: 'SQL',
      source: { liveVacancy: true },
    },
    score: 60,
  });
  const older = await db.application.create({
    data: {
      userId: id,
      fingerprint: 'legacy-a',
      job: json(job('Acme Pty Ltd', 'Sr Data Analyst', 'Sydney NSW')),
      source: 'search',
      status: 'saved',
      history: json([{ status: 'saved', at: '2026-11-01T00:00:00.000Z' }]),
    },
  });
  const newer = await db.application.create({
    data: {
      userId: id,
      fingerprint: 'legacy-b',
      job: json(job('ACME', 'Senior Data Analyst', 'Sydney, New South Wales')),
      source: 'scout',
      status: 'applied',
      notes: 'Emailed the recruiter.',
      history: json([
        { status: 'saved', at: '2026-11-02T00:00:00.000Z' },
        { status: 'applied', at: '2026-11-03T00:00:00.000Z' },
      ]),
    },
  });
  const run = await db.mission.create({
    data: {
      userId: id,
      profileId: profile.id,
      applicationId: newer.id,
      goal: 'run',
      status: 'COMPLETE',
      mode: 'openai',
      data: json({}),
      events: json([]),
    },
  });
  await db.trackedJob.createMany({
    data: [
      {
        userId: id,
        fingerprint: 'legacy-t1',
        record: json({ title: 'Sr Data Analyst', company: 'Acme Pty Ltd', location: 'Sydney NSW' }),
        firstSeenAt: new Date('2026-11-01'),
      },
      {
        userId: id,
        fingerprint: 'legacy-t2',
        record: json({ title: 'Senior Data Analyst', company: 'ACME', location: 'Sydney' }),
        firstSeenAt: new Date('2026-11-05'),
      },
    ],
  });

  await migrateRoleLibrary();
  await migrateRoleLibrary(); // idempotent
  const merged = await db.application.findMany({ where: { userId: id } });
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    id: older.id,
    status: 'applied',
    notes: 'Emailed the recruiter.',
    mode: 'openai',
  });
  expect((merged[0].history as any[]).map((h) => h.status)).toEqual(['saved', 'saved', 'applied']);
  expect((await db.mission.findUnique({ where: { id: run.id } }))!.applicationId).toBe(older.id);
  const tracked = await db.trackedJob.findMany({ where: { userId: id } });
  expect(tracked).toHaveLength(1);
  expect(tracked[0].firstSeenAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');

  // This server runs in fixture mode, so the live role is not on its board.
  expect((await call('/applications')).body).toEqual([]);
});
