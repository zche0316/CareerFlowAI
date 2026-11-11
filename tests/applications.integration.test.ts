import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import { applicationStage } from '../apps/api/src/applications.js';
import { sampleProfile } from '../packages/contracts/src/index.js';

// Applications are long-lived roles: runs (Mission rows) attach to them, the same role found
// twice stays one application, and older missions are backfilled without being changed.

let server: Server, base: string;
const users: string[] = [];
type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: any }>;

async function client(): Promise<{ id: string; call: Call }> {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `qa-apps-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Applications QA',
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
  const draft = await call('/profiles/drafts', 'POST', sampleProfile);
  expect(
    (await call(`/profiles/drafts/${draft.body.id}/approve`, 'POST', { reviewed: true })).status,
  ).toBe(200);
  return { id: data.user.id, call };
}

async function wait(call: Call, id: string, status: string) {
  for (let i = 0; i < 300; i++) {
    const m = (await call(`/missions/${id}`)).body;
    if (m.status === status) return m;
    if (m.status === 'FAILED') throw Error(m.error);
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error(`Timed out waiting for ${status}`);
}

const approve = async (call: Call, id: string) => {
  const draft = await wait(call, id, 'AWAITING_APPROVAL');
  expect(
    (
      await call(`/missions/${id}/decisions`, 'POST', {
        kind: 'resume',
        decision: 'approve',
        draftHash: draft.data.resumeDraft.hash,
      })
    ).status,
  ).toBe(202);
  return wait(call, id, 'AWAITING_INTERVIEW');
};

beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  process.env.JOB_SOURCE = 'fixtures';
  delete process.env.OPENAI_NATIVE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await initQueue(true);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await closeQueue();
  await new Promise<void>((r) => server.close(() => r()));
  for (const id of users) {
    for (const m of await db.mission.findMany({ where: { userId: id }, select: { id: true } })) {
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

it('derives the stage from the user status first, then from the runs', () => {
  expect(applicationStage('saved', [])).toBe('saved');
  expect(applicationStage('saved', [{ status: 'RUNNING', approvedResumeId: null }])).toBe(
    'tailoring',
  );
  expect(
    applicationStage('saved', [{ status: 'AWAITING_INTERVIEW', approvedResumeId: 'r1' }]),
  ).toBe('ready');
  expect(applicationStage('applied', [{ status: 'RUNNING', approvedResumeId: null }])).toBe(
    'applied',
  );
});

it('keeps one application per role across saves, choices and repeated runs', async () => {
  const { call } = await client();
  const search = (
    await call('/missions', 'POST', { goal: 'Find a graduate analyst role in Sydney.' })
  ).body;
  const shortlist = await wait(call, search.id, 'AWAITING_JOB');
  const [first, second] = shortlist.data.matches;
  expect((await call('/applications')).body).toEqual([]);

  // Save the second role to the board without choosing it; the run still waits for a choice.
  expect(
    (await call(`/missions/${search.id}/saved-roles`, 'POST', { jobId: second.job.id })).status,
  ).toBe(201);
  expect(
    (await call(`/missions/${search.id}/saved-roles`, 'POST', { jobId: 'missing' })).status,
  ).toBe(404);
  expect((await call(`/missions/${search.id}`)).body.status).toBe('AWAITING_JOB');

  // Choosing the first role links this run to a new application.
  expect(
    (await call(`/missions/${search.id}/decisions`, 'POST', { kind: 'job', jobId: first.job.id }))
      .status,
  ).toBe(202);
  await approve(call, search.id);
  let apps = (await call('/applications')).body;
  expect(apps).toHaveLength(2);
  const chosen = apps.find((a: any) => a.title === first.job.title);
  const saved = apps.find((a: any) => a.title === second.job.title);
  expect(chosen).toMatchObject({
    source: 'search',
    status: 'saved',
    stage: 'ready',
    activeRunId: search.id,
  });
  expect(chosen.latestResumeId).toBeTruthy();
  expect(saved).toMatchObject({ stage: 'saved', runs: [] });

  // Saving the chosen role again does not duplicate it.
  await call(`/missions/${search.id}/saved-roles`, 'POST', { jobId: first.job.id });
  expect((await call('/applications')).body).toHaveLength(2);

  // A run on the saved role starts at the resume team with the role already chosen.
  const started = await call(`/applications/${saved.id}/runs`, 'POST');
  expect(started.status).toBe(202);
  const run = await wait(call, started.body.id, 'AWAITING_APPROVAL');
  expect(run.data).toMatchObject({ preselected: true, jobRetrieval: { source: 'application' } });
  expect(run.data.selectedJob.job.title).toBe(second.job.title);
  expect((await call(`/applications/${saved.id}/runs`, 'POST')).body.code).toBe('RUN_ACTIVE');

  // Tailor the chosen role again: the first run is still in its interview, so finish it first.
  expect((await call(`/applications/${chosen.id}/runs`, 'POST')).status).toBe(409);
  await call(`/missions/${search.id}/cancel`, 'POST', {});
  const again = await call(`/applications/${chosen.id}/runs`, 'POST');
  expect(again.status).toBe(202);
  await approve(call, again.body.id);
  apps = (await call('/applications')).body;
  const both = apps.find((a: any) => a.id === chosen.id);
  expect(both.runs.map((r: any) => r.id).sort()).toEqual([search.id, again.body.id].sort());
  const resumes = both.runs.map((r: any) => r.approvedResumeId);
  expect(new Set(resumes).size).toBe(2);

  // Status is the user's record, with history; a mission status update writes through.
  const patched = await call(`/applications/${chosen.id}`, 'PATCH', {
    status: 'applied',
    note: 'Sent on the careers site.',
  });
  expect(patched.body.history.map((h: any) => h.status)).toEqual(['saved', 'applied']);
  await call(`/missions/${again.body.id}/tools`, 'POST', { kind: 'status', status: 'interview' });
  expect((await call('/applications')).body.find((a: any) => a.id === chosen.id).stage).toBe(
    'interview',
  );
  expect((await call(`/applications/${chosen.id}`, 'PATCH', { status: 'hired' })).status).toBe(422);
});

it('backfills older missions that chose a role, keeping their recorded status', async () => {
  const { id, call } = await client();
  const profile = (await db.profile.findFirst({ where: { userId: id } }))!;
  const job = {
    id: 'legacy-1',
    title: 'Legacy Analyst',
    company: 'Old Co',
    location: 'Sydney',
    description: 'SQL',
  };
  await db.mission.create({
    data: {
      userId: id,
      profileId: profile.id,
      goal: 'Group build mission',
      status: 'COMPLETE',
      mode: 'fixture',
      data: json({
        selectedJob: { job, score: 70 },
        approvedResumeId: 'resume-legacy',
        optionalTools: { status: { value: 'rejected', at: '2026-10-01T00:00:00.000Z' } },
      }),
      events: json([]),
    },
  });
  const [legacy] = (await call('/applications')).body;
  expect(legacy).toMatchObject({
    title: 'Legacy Analyst',
    status: 'rejected',
    stage: 'rejected',
    score: 70,
  });
  expect(legacy.history.map((h: any) => h.status)).toEqual(['saved', 'rejected']);
  // Running the backfill again changes nothing.
  expect((await call('/applications')).body).toHaveLength(1);
  const stranger = await client();
  expect(
    (await stranger.call(`/applications/${legacy.id}`, 'PATCH', { status: 'offer' })).status,
  ).toBe(404);
  expect((await stranger.call(`/applications/${legacy.id}/runs`, 'POST')).status).toBe(404);
});
