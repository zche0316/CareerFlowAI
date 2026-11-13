import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import { checkListing, recheckRoles } from '../apps/api/src/role-recheck.js';

// CFS-122: tracked roles are re-checked with their source. Closed listings close roles the user
// has not applied to; applied roles are only flagged. No real network: board and link replies
// are injected.

let userId = '';
const board = (provider: string, id: string) => ({
  title: `Role ${id}`,
  company: 'Example',
  applicationUrl: `https://jobs.example.com/${id}`,
  source: { provider, board: 'example', listingId: id, liveVacancy: true },
});
const linked = (id: string, host = 'careers.example.org') => ({
  title: `Role ${id}`,
  company: 'Linked',
  applicationUrl: `https://${host}/jobs/${id}`,
  source: { name: 'Pasted listing', externalListing: true, liveVacancy: false },
});
const demo = { title: 'Demo', company: 'Demo', source: { type: 'disclosed-fixture' } };

beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  const u = await db.user.create({
    data: {
      email: `qa-recheck-${crypto.randomUUID()}@careerflow.test`,
      name: 'Recheck QA',
      passwordHash: 'x',
    },
  });
  userId = u.id;
});
afterAll(async () => {
  await db.application.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

const revalidate = async (job: any) => ({
  status: job.source.listingId.startsWith('gone') ? 'closed_or_removed' : 'published_at_check',
});
const fetcher = async (url: string) => {
  if (url.endsWith('/robots.txt'))
    return new Response(url.includes('private.example') ? 'User-agent: *\nDisallow: /' : '', {
      status: 200,
    });
  return new Response('', { status: url.includes('/missing') ? 404 : 200 });
};

it('checks a listing with its board API, or its link where robots.txt allows', async () => {
  const now = new Date('2026-11-14T00:00:00.000Z');
  expect(await checkListing(board('greenhouse', 'gone-1'), { revalidate, now })).toMatchObject({
    status: 'closed',
    method: 'official-job-board-api',
  });
  expect((await checkListing(board('lever', '2'), { revalidate, now })).status).toBe('published');
  // A board that cannot be reached is reported, not treated as closed.
  expect(
    await checkListing(board('ashby', '3'), {
      revalidate: async () => {
        throw Error('HTTP 503');
      },
    }),
  ).toMatchObject({ status: 'unverified' });
  expect((await checkListing(linked('missing'), { fetcher })).status).toBe('closed');
  expect((await checkListing(linked('ok'), { fetcher })).status).toBe('reachable');
  expect(await checkListing(linked('x', 'private.example'), { fetcher })).toMatchObject({
    status: 'unverified',
    reason: expect.stringContaining('automated readers'),
  });
  expect((await checkListing(demo, { fetcher })).method).toBe('none');
});

it('closes unapplied roles whose listing is gone and only flags applied ones', async () => {
  const role = (job: any, status: string, fp: string) =>
    db.application.create({
      data: {
        userId,
        fingerprint: fp,
        job: json({ job, score: 60 }),
        source: 'search',
        status,
        history: json([{ status, at: '2026-11-01T00:00:00.000Z' }]),
        mode: 'fixture',
      },
    });
  const saved = await role(board('greenhouse', 'gone-saved'), 'saved', 'a');
  const applied = await role(board('greenhouse', 'gone-applied'), 'applied', 'b');
  const open = await role(board('lever', 'open'), 'discovered', 'c');
  const rejected = await role(board('greenhouse', 'gone-rejected'), 'rejected', 'd');

  const first = await recheckRoles(userId, { revalidate, fetcher });
  expect(first).toMatchObject({ checked: 3, closed: 1, flagged: 1, published: 1 });
  const read = (id: string) => db.application.findUniqueOrThrow({ where: { id } });

  const closed = await read(saved.id);
  expect(closed.status).toBe('closed');
  expect((closed.history as any[]).at(-1)).toMatchObject({
    status: 'closed',
    note: expect.stringContaining('Listing closed'),
  });
  const stillApplied = await read(applied.id);
  expect(stillApplied.status).toBe('applied');
  expect((stillApplied.history as any[]).length).toBe(1);
  expect((stillApplied.job as any).listingCheck.status).toBe('closed');
  expect((await read(open.id)).status).toBe('discovered');
  // Rejected roles are not tracked, so they are not checked.
  expect((await read(rejected.id)).job).not.toHaveProperty('listingCheck');

  // Checked roles wait about a day before the next check.
  expect((await recheckRoles(userId, { revalidate, fetcher })).checked).toBe(0);
  expect((await recheckRoles(userId, { revalidate, fetcher, force: true })).checked).toBe(2);
});
