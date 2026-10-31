import { afterAll, beforeAll, it, expect, vi } from 'vitest';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
import * as provider from '../packages/agents/src/provider.js';
import type { Server } from 'node:http';
let server: Server, base: string, userId: string;
beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as any).port;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});
async function client() {
  const response = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'story-' + crypto.randomUUID() + '@careerflow.test',
      name: 'Alex Chen',
      password: 'Story-integration-password',
    }),
  });
  expect(response.status).toBe(201);
  const session = await response.json();
  userId = session.user.id;
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  return {
    request: async (path: string, method = 'GET', body?: unknown) => {
      const r = await fetch(base + '/api' + path, {
        method,
        headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json() };
    },
  };
}
it('keeps a role overview and one grounded STAR example in the same experience, then saves the story without another model call', async () => {
  const c = await client();
  let form: any = { ...sampleProfile, workExperiences: [], projects: [] };
  let t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
  const overview = 'I supported reporting using SQL; I did not manage the team.';
  const first = `From November 2025 to February 2026, I worked as a Business Analyst Intern at Northstar Logistics. ${overview}`;
  const record = {
    section: 'workExperiences',
    title: 'Business Analyst Intern',
    organisation: 'Northstar Logistics',
    location: '',
    startMonth: '2025-11',
    endMonth: '2026-02',
    current: false,
    details: [],
    technologies: ['SQL'],
    url: '',
    evidence: [{ page: 1, quote: first }],
  };
  const starStory = {
    situation: 'The warehouses used different delay labels.',
    task: 'I was responsible for standardising categories.',
    action: 'I compared labels and reviewed the definitions with my supervisor.',
    result: 'Reporting preparation fell from half a day to about one hour.',
  };
  const text = Object.values(starStory).join(' ');
  const spy = vi
    .spyOn(provider, 'generate')
    .mockResolvedValueOnce({
      builder: { draft: {}, proposedChanges: [], followUpQuestions: [] },
      records: [record],
    } as any)
    .mockResolvedValueOnce({
      builder: { draft: {}, proposedChanges: [], followUpQuestions: [] },
      records: [{ ...record, starStory, evidence: [{ page: 2, quote: text }] }],
    } as any);
  try {
    t = (
      await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        text: first,
        consent: true,
      })
    ).body;
    expect(t.messages.at(-1).questions[0]).toContain('specific problem or improvement');
    let accepted = (
      await c.request(`/profile-threads/${t.id}/proposals`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        reviewed: true,
      })
    ).body;
    form = accepted.data;
    t = accepted.thread;
    const recordId = form.workExperiences[0].id;
    t = (
      await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        text,
        consent: true,
      })
    ).body;
    accepted = (
      await c.request(`/profile-threads/${t.id}/proposals`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        reviewed: true,
      })
    ).body;
    form = accepted.data;
    t = accepted.thread;
    expect(form.workExperiences).toHaveLength(1);
    expect(form.workExperiences[0]).toMatchObject({ id: recordId, overview, starStory });
    expect(t.messages.at(-1).questions).toEqual([]);
    const organised = await c.request(`/profile-threads/${t.id}/organise`, 'POST', {
      currentProfile: form,
      revision: t.revision,
      recordId,
      recordSection: 'workExperiences',
      consent: true,
    });
    expect(organised.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    const memory = await db.careerMemory.findUniqueOrThrow({
      where: { id: organised.body.memoryId },
    });
    expect(memory).toMatchObject({ kind: 'STAR', recordId, status: 'DRAFT', star: starStory });
  } finally {
    spy.mockRestore();
  }
});
