import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
import { buildFacts } from '../apps/api/src/domain.js';
import { resumeRecordIndex, resumeLayout } from '../packages/contracts/src/resume-layout.js';
import * as provider from '../packages/agents/src/provider.js';

let server: Server, base: string;
const users: string[] = [];
async function client() {
  const response = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Fictional audit',
      email: `audit-${randomUUID()}@example.test`,
      password: 'Disposable-audit-password',
    }),
  });
  expect(response.status).toBe(201);
  const session = await response.json();
  users.push(session.user.id);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  return {
    id: session.user.id,
    async request(path: string, method = 'GET', body?: unknown) {
      const r = await fetch(base + '/api' + path, {
        method,
        headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    },
  };
}
const form = { ...sampleProfile, projects: [], workExperiences: [], educations: [] };
function labelled(background = 'We ran a practice workshop.') {
  return `Title: Fictional volunteer\nType: volunteer\nOrganisation: Example Centre\nDates: 2025-07 to 2025-08\nBackground: ${background}\nPersonal actions: I explained sorting in Excel.\nTeam outcomes: Satisfaction was not measured.\nTools: Excel`;
}
beforeAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
  for (const userId of users) {
    await db.profileDraft.deleteMany({ where: { userId } });
    await db.profile.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});

describe('Profile conversation reliability', () => {
  it('control: a short labelled answer creates a reviewable project without an AI call', async () => {
    const c = await client();
    const t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
    const generate = vi.spyOn(provider, 'generate');
    const r = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
      currentProfile: form,
      revision: t.revision,
      text: labelled(),
      consent: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.messages.at(-1).failed).not.toBe(true);
    expect(r.body.proposals.find((p: any) => p.field === 'projects')?.after[0].title).toBe(
      'Fictional volunteer',
    );
    expect(generate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps the newest answer available when the saved source window reaches 18000 characters', async () => {
    const c = await client();
    let t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
    // Four legal, saved messages; fixture generation makes no external calls.
    for (let i = 0; i < 4; i++) {
      const text = (
        `Older context ${i}: ` + 'I reviewed existing course notes. '.repeat(130)
      ).slice(0, 3990);
      const r = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        text,
        consent: true,
      });
      expect(r.status).toBe(200);
      t = r.body;
    }
    const text = (
      labelled('A practice workshop. '.repeat(75)) +
      '\nReflection: ' +
      'I learned to explain clearly. '.repeat(25)
    ).trim();
    expect(text.length).toBeGreaterThan(2040);
    expect(text.length).toBeLessThan(4000);
    const r = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
      currentProfile: form,
      revision: t.revision,
      text,
      consent: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.messages.some((m: any) => m.role === 'user' && m.text === text)).toBe(true);
    const project = r.body.proposals
      .find((p: any) => p.field === 'projects' && p.status === 'PENDING')
      ?.after.find((p: any) => p.title === 'Fictional volunteer');
    expect(project).toBeDefined();
    const answer = r.body.messages.find((m: any) => m.role === 'user' && m.text === text);
    expect(project.conversationEvidence).toContainEqual({
      threadId: t.id,
      messageId: answer.id,
      quote: text,
    });
  });

  it.each([
    ['volunteer', 'volunteer', 'projects', 'Volunteering'],
    ['club', 'club', 'projects', 'Clubs & Activities'],
    ['course project', 'course', 'projects', 'Projects'],
    ['personal project', 'personal', 'projects', 'Projects'],
    ['work', 'work', 'workExperiences', 'Work Experience'],
  ])(
    'preserves explicit %s type through approval and resume grouping',
    async (label, type, field, heading) => {
      const c = await client();
      const t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
      const r = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
        currentProfile: form,
        revision: t.revision,
        text: labelled().replace('Type: volunteer', `Type: ${label}`),
        consent: true,
      });
      const applied = await c.request(`/profile-threads/${t.id}/proposals`, 'POST', {
        currentProfile: form,
        revision: r.body.revision,
        reviewed: true,
      });
      expect(applied.status).toBe(200);
      const draft = await c.request('/profiles/drafts', 'POST', applied.body.data);
      expect(draft.status).toBe(201);
      const approved = await c.request(`/profiles/drafts/${draft.body.id}/approve`, 'POST', {
        reviewed: true,
      });
      expect(approved.status).toBe(200);
      const facts = buildFacts(applied.body.data);
      const sections = resumeLayout({
        name: form.name,
        jobTitle: 'Fictional role',
        records: resumeRecordIndex(applied.body.data),
        claims: facts.map((f) => ({ ...f, factId: f.id })),
      });
      expect(applied.body.data[field][0].experienceType).toBe(type);
      const saved = await db.profile.findFirstOrThrow({ where: { userId: c.id, version: 1 } });
      expect((saved.data as any)[field][0].experienceType).toBe(type);
      expect(sections.some((s) => s.title === heading)).toBe(true);
    },
  );

  it('adds the explicit type to an existing record without duplicating it or replacing its ID', async () => {
    const c = await client();
    const id = randomUUID();
    const currentProfile = {
      ...form,
      projects: [
        {
          id,
          title: 'Fictional volunteer',
          organisation: 'Example Centre',
          location: '',
          startMonth: '2025-07',
          endMonth: '2025-08',
          current: false,
          details: ['We ran a practice workshop.'],
          technologies: ['Excel'],
          url: '',
          evidence: [],
        },
      ],
    };
    const t = (await c.request('/profile-threads', 'POST', { currentProfile })).body;
    const answer = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
      currentProfile,
      revision: t.revision,
      text: labelled(),
      consent: true,
    });
    expect(answer.status).toBe(200);
    const proposed = answer.body.proposals.find(
      (p: any) => p.field === 'projects' && p.status === 'PENDING',
    );
    expect(proposed.after).toHaveLength(1);
    expect(proposed.after[0]).toMatchObject({ id, experienceType: 'volunteer' });
    expect(proposed.after[0].details).toContain('We ran a practice workshop.');
  });
});
