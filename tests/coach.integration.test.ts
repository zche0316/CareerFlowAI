import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { initQueue, closeQueue } from '../apps/api/src/queue.js';
import { db } from '../apps/api/src/db.js';
import { coachActions } from '../apps/api/src/coach.js';
import { sampleProfile } from '../packages/contracts/src/index.js';

let server: Server, base: string;
const users: string[] = [];

const app = (over: Partial<Parameters<typeof coachActions>[0]['applications'][0]>) => ({
  id: 'a',
  title: 'Analyst',
  company: 'Co',
  stage: 'saved',
  score: 50,
  updatedAt: '2026-11-01T00:00:00.000Z',
  history: [],
  gaps: [],
  ...over,
});

it('turns the board into next actions without a model call', () => {
  expect(
    coachActions({ applications: [], analysis: 'none', lastFeedback: null }).map((a) => a.id),
  ).toEqual(['refresh', 'find']);
  const actions = coachActions({
    analysis: 'current',
    now: new Date('2026-11-20T00:00:00.000Z'),
    lastFeedback: { jobTitle: 'Analyst', improvements: ['Give one measurable result per answer.'] },
    applications: [
      app({ id: 'low', stage: 'saved', score: 40, gaps: ['dbt'] }),
      app({ id: 'high', stage: 'saved', score: 80, gaps: ['dbt', 'Airflow'] }),
      app({ id: 'mid', stage: 'saved', score: 60 }),
      app({ id: 'ready', stage: 'ready' }),
      app({
        id: 'old',
        stage: 'applied',
        history: [{ status: 'applied', at: '2026-11-01T00:00:00.000Z' }],
      }),
      app({
        id: 'new',
        stage: 'applied',
        history: [{ status: 'applied', at: '2026-11-18T00:00:00.000Z' }],
      }),
    ],
  });
  expect(actions.map((a) => a.id)).toEqual([
    'apply-ready',
    'tailor-high',
    'tailor-mid',
    'follow-old',
    'practice-feedback',
    'gap',
  ]);
  expect(actions.find((a) => a.id === 'tailor-high')!.action).toEqual({
    kind: 'tailor',
    applicationId: 'high',
  });
  expect(actions.at(-1)!.text).toContain('2 of your roles ask for dbt');
  const gapped = coachActions({
    analysis: 'current',
    lastFeedback: null,
    applications: [
      app({
        id: 'x',
        stage: 'applied',
        levelGaps: [{ skill: 'SQL', need: 3, have: 2, level: 'required' }],
      }),
      app({
        id: 'y',
        stage: 'ready',
        levelGaps: [{ skill: 'SQL', need: 4, have: 2, level: 'required' }],
      }),
    ],
  });
  expect(gapped.find((a) => a.id === 'level-gap')!.text).toContain(
    '2 of your roles need SQL at level 4; you are at 2',
  );
  expect(
    coachActions({ applications: [app({})], analysis: 'stale', lastFeedback: null })[0].text,
  ).toContain('updated profile');
});

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
    await db.profileDraft.deleteMany({ where: { userId: id } });
    await db.profile.deleteMany({ where: { userId: id } });
    await db.user.delete({ where: { id } });
  }
  await db.$disconnect();
});

it('keeps Coach advice per profile version and limits refreshes', async () => {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `qa-coach-${crypto.randomUUID()}@careerflow.test`,
      password: 'Disposable-QA-password',
      name: 'Coach QA',
    }),
  });
  const data = await r.json();
  users.push(data.user.id);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
  expect((await call('/coach')).body).toBeNull();
  expect((await call('/coach/refresh', 'POST')).status).toBe(409);
  const draft = await call('/profiles/drafts', 'POST', sampleProfile);
  await call(`/profiles/drafts/${draft.body.id}/approve`, 'POST', { reviewed: true });

  const caps = (await call('/capabilities')).body.skills;
  expect(caps.length).toBeGreaterThan(0);
  expect(caps.every((c: any) => c.level >= 0 && c.level <= 4 && c.evidence.length)).toBe(true);
  const before = (await call('/coach')).body;
  expect(before).toMatchObject({ profileVersion: 1, analysis: null });
  expect(before.actions.map((a: any) => a.id)).toEqual(['refresh', 'find']);

  const refreshed = await call('/coach/refresh', 'POST');
  expect(refreshed.status).toBe(200);
  expect(refreshed.body.analysis.strengths.length).toBeGreaterThan(0);
  expect(refreshed.body.actions.map((a: any) => a.id)).toEqual(['find']);
  expect((await call('/coach/refresh', 'POST')).body.code).toBe('COACH_BUSY');

  // A new profile version makes the old advice stale until the Coach is asked again.
  const next = await call('/profiles/drafts', 'POST', {
    ...sampleProfile,
    goals: sampleProfile.goals + ' Open to Melbourne.',
  });
  await call(`/profiles/drafts/${next.body.id}/approve`, 'POST', { reviewed: true });
  const stale = (await call('/coach')).body;
  expect(stale).toMatchObject({ profileVersion: 2, analysis: null });
  expect(stale.actions[0].text).toContain('updated profile');
});
