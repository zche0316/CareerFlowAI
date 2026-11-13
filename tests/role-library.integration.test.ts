import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { initScout, closeScout } from '../apps/api/src/scout.js';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import {
  canonicalUrl,
  migrateRoleLibrary,
  postingKey,
  resolveRole,
  similarity,
  textSignature,
} from '../apps/api/src/role-library.js';
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

const words = (seed: string, n = 80) =>
  Array.from({ length: n }, (_, i) => `${seed}${i % 37} task${(i * 7) % 23}`).join(' ');
const listing = (over: any = {}) => ({
  id: crypto.randomUUID(),
  company: 'Acme Pty Ltd',
  title: 'Graduate Data Analyst',
  location: 'Sydney NSW',
  description: words('report'),
  ...over,
});

it('recognises the same posting by its source id or cleaned link', () => {
  expect(canonicalUrl('https://www.SEEK.com.au/job/123/?utm_source=x&ref=y#apply')).toBe(
    'seek.com.au/job/123',
  );
  expect(canonicalUrl('https://au.indeed.com/viewjob?jk=abc&from=serp')).toBe(
    'au.indeed.com/viewjob?jk=abc',
  );
  expect(postingKey({ source: { provider: 'greenhouse', board: 'Acme', listingId: '42' } })).toBe(
    'greenhouse:acme:42',
  );
  expect(postingKey({ applicationUrl: 'https://acme.com/careers/7?utm_medium=email' })).toBe(
    'url:acme.com/careers/7',
  );
  // Same link, different spelling of the names: the link decides.
  const known = [{ fingerprint: 'role-1', postingKey: 'url:acme.com/careers/7', textSig: null }];
  expect(
    resolveRole(
      listing({ title: 'Data Analyst (Grad)', applicationUrl: 'https://acme.com/careers/7/' }),
      known,
    ).fingerprint,
  ).toBe('role-1');
});

it('keeps two openings with the same title apart when their descriptions differ', () => {
  const first = listing({ applicationUrl: 'https://seek.com.au/job/1' });
  const sameAdElsewhere = listing({
    applicationUrl: 'https://linkedin.com/jobs/view/9',
    description: first.description,
  });
  const otherTeam = listing({
    applicationUrl: 'https://seek.com.au/job/2',
    description: words('pipeline'),
  });
  expect(
    similarity(textSignature(first.description), textSignature(sameAdElsewhere.description)),
  ).toBe(1);
  expect(
    similarity(textSignature(first.description), textSignature(otherTeam.description))!,
  ).toBeLessThan(0.6);
  expect(textSignature('too short to compare')).toBeNull();

  const a = resolveRole(first, []);
  const known = [{ fingerprint: a.fingerprint, postingKey: a.key, textSig: a.sig }];
  expect(resolveRole(sameAdElsewhere, known).fingerprint).toBe(a.fingerprint);
  const b = resolveRole(otherTeam, known);
  expect(b.match).toBeNull();
  expect(b.fingerprint).toMatch(new RegExp(`^${a.fingerprint}:[a-f0-9]{8}$`));
  // A listing with no description to compare (a lead) joins the existing role.
  expect(resolveRole(listing({ description: '' }), known).fingerprint).toBe(a.fingerprint);
});

it('treats a role unseen for sixty days as re-advertised', () => {
  const a = resolveRole(listing(), []);
  const now = new Date('2026-12-31T00:00:00.000Z');
  const known = (days: number) => [
    {
      fingerprint: a.fingerprint,
      postingKey: a.key,
      textSig: a.sig,
      lastSeenAt: new Date(now.getTime() - days * 86400000),
    },
  ];
  expect(resolveRole(listing(), known(30), now).reposted).toBe(false);
  expect(resolveRole(listing(), known(61), now).reposted).toBe(true);
});

it('shares one library between Find roles, Scout and the board', async () => {
  const { id, call } = await client();
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

  // A role Scout recorded can be saved to the board from its table, once. Only roles whose full
  // listing is kept (ranked by a search or seen in a sweep) offer Save (CFS-128).
  const unranked = scout.tracked.find((t: any) => !t.board && !t.saveable);
  if (unranked)
    expect((await call(`/scout/roles/${unranked.fingerprint}/save`, 'POST')).body.code).toBe(
      'LISTING_NOT_STORED',
    );
  const other = scout.tracked.find((t: any) => !t.board && t.saveable);
  expect((await call(`/scout/roles/${other.fingerprint}/save`, 'POST')).status).toBe(201);
  await call(`/scout/roles/${other.fingerprint}/save`, 'POST');
  const board = (await call('/applications')).body;
  expect(board).toHaveLength(2);
  expect(board.map((a: any) => a.fingerprint).sort()).toEqual(
    [first.fingerprint, other.fingerprint].sort(),
  );
  expect((await call('/scout/roles/' + 'f'.repeat(32) + '/save', 'POST')).status).toBe(404);

  await call(`/applications/${board[0].id}`, 'PATCH', { status: 'applied' });

  // Two months later the same roles are advertised again. Roles not on the board come back as
  // new; board roles are not packaged again but their history notes the re-advertisement.
  await db.trackedJob.updateMany({
    where: { userId: id },
    data: { lastSeenAt: new Date(Date.now() - 61 * 86400000) },
  });
  expect((await call('/scout/sweeps', 'POST', {})).status).toBe(202);
  const again = (
    await until(
      () => call('/scout'),
      (r) => r.body.sweeps.length === 2 && r.body.sweeps[0]?.status === 'COMPLETE',
    )
  ).body.sweeps[0];
  expect(again).toMatchObject({ fetched: 8, fresh: 6, reposted: 6 });
  const noted = (await call('/applications')).body.find((a: any) => a.id === board[0].id);
  expect(noted.history.at(-1)).toMatchObject({ status: 'applied', note: 'Re-advertised' });
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

  // Same names, different descriptions: two openings that the migration keeps apart.
  for (const seed of ['dashboards', 'pipelines'])
    await db.application.create({
      data: {
        userId: id,
        fingerprint: 'legacy-' + seed,
        job: json({
          job: {
            id: seed,
            company: 'Beta',
            title: 'Analyst',
            location: 'Perth',
            description: words(seed),
          },
          score: 50,
        }),
        source: 'search',
        status: 'saved',
        history: json([{ status: 'saved', at: '2026-11-04T00:00:00.000Z' }]),
      },
    });
  await migrateRoleLibrary();
  const beta = (await db.application.findMany({ where: { userId: id } })).filter(
    (a) => (a.job as any).job.company === 'Beta',
  );
  expect(beta).toHaveLength(2);
  expect(new Set(beta.map((a) => a.fingerprint)).size).toBe(2);

  // This server runs in fixture mode, so the live role is not on its board.
  expect((await call('/applications')).body).toEqual([]);
});

it('Scout discovers roles onto the board by default and new searches reuse saved advice', async () => {
  const { call } = await client();
  const setting = (await call('/scout')).body.setting;
  expect(setting.autoPackage).toBe(false);
  await call('/scout/settings', 'PUT', { ...setting, topK: 2, minScore: 0 });
  await call('/scout/sweeps', 'POST', {});
  const sweep = (
    await until(
      () => call('/scout'),
      (r) => r.body.sweeps[0]?.status === 'COMPLETE',
    )
  ).body.sweeps[0];
  expect(sweep).toMatchObject({ fresh: 8, discovered: 2, packages: [] });
  expect(sweep.calls).toBe(0);
  const board = (await call('/applications')).body;
  expect(board).toHaveLength(2);
  expect(
    board.every(
      (a: any) => a.stage === 'discovered' && a.source === 'scout' && a.runs.length === 0,
    ),
  ).toBe(true);

  // Advice saved by the Coach is reused: the search run starts with it and makes no Coach call.
  await call('/coach/refresh', 'POST');
  const run = (await call('/missions', 'POST', { goal: 'Find a graduate analyst role.' })).body;
  const shortlist = (
    await until(
      () => call(`/missions/${run.id}`),
      (r) => r.body.status === 'AWAITING_JOB',
    )
  ).body;
  expect(shortlist.data.analysisReused).toBe(true);
  expect(
    shortlist.events.some((e: any) => e.agent === 'Career Coach' && e.action === 'completed'),
  ).toBe(false);
});

it('counts regional market insight from the roles the searches found', async () => {
  const { call } = await client();
  expect((await call('/insights?country=au')).body.overall.roles).toBe(0);
  const run = (await call('/missions', 'POST', { goal: 'Find a graduate analyst role.' })).body;
  const done = (
    await until(
      () => call(`/missions/${run.id}`),
      (r) => r.body.status === 'AWAITING_JOB',
    )
  ).body;
  const insight = (await call('/insights?country=au')).body;
  expect(insight).toMatchObject({ country: 'au', family: 'all' });
  expect(insight.overall.roles).toBe(done.data.matches.length);
  expect(insight.overall.topSkills.length).toBeGreaterThan(0);
  expect(insight.overall.topSkills[0].examples[0].title).toBeTruthy();
  expect(insight.cities.reduce((n: number, c: any) => n + c.roles, 0)).toBe(insight.overall.roles);
  const data = (await call('/insights?country=au&family=data')).body;
  expect(data.overall.roles).toBeLessThanOrEqual(insight.overall.roles);
  expect((await call('/insights?country=zz')).status).toBe(422);
});
