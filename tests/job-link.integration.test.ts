import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
import * as links from '../packages/recruitment/src/job-link.js';
let server: Server, base: string, userId: string;
beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
  if (userId) {
    await db.mission.deleteMany({ where: { userId } });
    await db.profile.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});
it('stores a URL-read candidate without selecting it and rejects late, completed and foreign imports', async () => {
  const registered = await fetch(base + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `url-${crypto.randomUUID()}@careerflow.test`,
      password: 'Job-link-test-password',
      name: 'Candidate',
    }),
  });
  const session = await registered.json();
  userId = session.user.id;
  const cookie = registered.headers.get('set-cookie')!.split(';')[0];
  const request = (id: string) =>
    fetch(base + `/missions/${id}/job-link`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: JSON.stringify({ url: 'https://www.linkedin.com/jobs/view/1234567890' }),
    });
  await db.user.update({ where: { id: userId }, data: { profileVersion: 1 } });
  const profile = await db.profile.create({
    data: { userId, version: 1, data: sampleProfile, facts: [] },
  });
  const mission = await db.mission.create({
    data: {
      userId,
      profileId: profile.id,
      status: 'NO_MATCHES',
      goal: 'Analyst',
      mode: 'fixture',
      data: { apiCalls: 3, matches: [] },
      events: [],
    },
  });
  const job = {
    id: 'url-job',
    title: 'Reporting Analyst',
    company: 'Example',
    location: 'Sydney',
    description: 'Use SQL and Excel for reporting and requirements analysis.',
    employmentType: 'full-time',
    salary: null,
    growth: null,
    applicationUrl: 'https://www.linkedin.com/jobs/view/1234567890',
    source: {
      name: 'LinkedIn',
      version: 'user-provided',
      provider: 'manual',
      externalListing: true,
      liveVacancy: false,
      importedFromURL: 'https://www.linkedin.com/jobs/view/1234567890',
    },
  };
  const spy = vi.spyOn(links, 'resolveJobLink').mockResolvedValue(job);
  expect((await request(mission.id)).status).toBe(200);
  const saved = await db.mission.findUniqueOrThrow({ where: { id: mission.id } });
  expect(saved.status).toBe('AWAITING_JOB');
  expect((saved.data as any).matches[0].job.id).toBe('url-job');
  expect((saved.data as any).selectedJob).toBeUndefined();
  expect((saved.data as any).apiCalls).toBe(3);
  expect((await request(crypto.randomUUID())).status).toBe(404);
  expect(spy).toHaveBeenCalledTimes(1);
  let release!: (job: any) => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => (started = r));
  spy.mockImplementation(() => {
    started();
    return new Promise((r) => (release = r));
  });
  const pending = request(mission.id);
  await entered;
  await db.mission.update({
    where: { id: mission.id },
    data: {
      status: 'AWAITING_APPROVAL',
      data: { ...(saved.data as any), selectedJob: { job: { id: 'chosen' } } },
    },
  });
  release(job);
  expect((await pending).status).toBe(409);
  await db.mission.update({ where: { id: mission.id }, data: { status: 'COMPLETE' } });
  expect((await request(mission.id)).status).toBe(409);
  expect((await db.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe(
    'COMPLETE',
  );
});
