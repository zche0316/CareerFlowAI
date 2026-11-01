import { afterAll, beforeAll, it, expect, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
import * as provider from '../packages/agents/src/provider.js';
let server: Server, base: string, userId: string;
beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (userId) {
    await db.mission.deleteMany({ where: { userId } });
    await db.profile.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});
it('edits the preview from approved profile facts, searches memory only on demand and rejects stale or unsupported edits', async () => {
  const registered = await fetch(base + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `resume-${crypto.randomUUID()}@careerflow.test`,
      password: 'Resume-edit-password',
      name: 'Alex',
    }),
  });
  expect(registered.status).toBe(201);
  const session = await registered.json();
  userId = session.user.id;
  const cookie = registered.headers.get('set-cookie')!.split(';')[0];
  const request = (id: string, body: unknown, suffix = '') =>
    fetch(base + `/missions/${id}/resume-agent${suffix}`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
      body: JSON.stringify(body),
    });
  const fact = {
    id: 'experience-1',
    kind: 'experience',
    text: 'I supported reporting for 2,000 orders using SQL.',
    source: 'user',
  };
  await db.user.update({ where: { id: userId }, data: { profileVersion: 1 } });
  const p = await db.profile.create({
    data: { userId, version: 1, data: sampleProfile, facts: [fact] },
  });
  const m = await db.mission.create({
    data: {
      userId,
      profileId: p.id,
      goal: 'Business Analyst',
      mode: 'fixture',
      status: 'AWAITING_APPROVAL',
      events: [],
      data: {
        resumeDraft: {
          hash: 'original',
          jobTitle: 'Business Analyst',
          claims: [{ factId: fact.id, text: fact.text, kind: fact.kind }],
        },
      },
    },
  });
  const spy = vi
    .spyOn(provider, 'generate')
    .mockImplementation(async (role, context, schema, mode, hooks) => {
      expect(role).toBe('resume-edit');
      expect(context).not.toHaveProperty('conversationHistory');
      expect(context.facts[0].text).toBe(fact.text);
      expect(await hooks.onSearchHistory!('SQL', 0)).toMatchObject({ hits: [] });
      return {
        message: 'Polished wording.',
        claims: [
          {
            factId: fact.id,
            text: 'Using SQL, I supported reporting for 2,000 orders.',
            reason: 'Reporting experience.',
          },
        ],
      } as any;
    });
  const edit = await request(m.id, { draftHash: 'original', message: 'Refine wording' });
  expect(edit.status).toBe(200);
  const result = await edit.json();
  expect(result.resumeDraft.claims[0].text).toBe(
    'Using SQL, I supported reporting for 2,000 orders.',
  );
  expect(result.resumeDraft.hash).not.toBe('original');
  expect((await request(m.id, { draftHash: 'original', message: 'Try again' })).status).toBe(409);
  spy.mockResolvedValueOnce({
    message: 'Invented result.',
    claims: [
      {
        factId: fact.id,
        text: 'Managed 5,000 orders and saved $1 million.',
        reason: 'Unsupported.',
      },
    ],
  } as any);
  const unsafe = await request(m.id, {
    draftHash: result.resumeDraft.hash,
    message: 'Improve impact',
  });
  expect(unsafe.status).toBe(200);
  expect((await unsafe.json()).resumeDraft.claims[0].text).toBe(
    'Using SQL, I supported reporting for 2,000 orders.',
  );
  const stored = (await db.mission.findUniqueOrThrow({ where: { id: m.id } })).data as any;
  expect(stored.resumeChanges[0].before).toBe('Supported reporting for 2,000 orders using SQL.');
  expect(stored.resumeChanges[0].after).toBe('Using SQL, I supported reporting for 2,000 orders.');
  const callsBeforeRestore = spy.mock.calls.length;
  const restored = await request(
    m.id,
    { draftHash: stored.resumeDraft.hash, factId: fact.id },
    '/restore',
  );
  expect(restored.status).toBe(200);
  const restoredDraft = (await restored.json()).resumeDraft;
  expect(restoredDraft.claims[0].text).toBe(fact.text);
  expect(spy.mock.calls.length).toBe(callsBeforeRestore);
  expect(
    ((await db.mission.findUniqueOrThrow({ where: { id: m.id } })).data as any).resumeChanges,
  ).toEqual([]);
  spy.mockResolvedValueOnce({
    message: 'Removed first person.',
    claims: [
      {
        factId: fact.id,
        text: 'Supported reporting for 2,000 orders using SQL.',
        reason: 'Formatting only.',
      },
    ],
  } as any);
  const noChange = await request(m.id, {
    draftHash: restoredDraft.hash,
    message: 'Refine wording',
  });
  expect((await noChange.json()).resumeDraft.hash).toBe(restoredDraft.hash);
  expect(
    ((await db.mission.findUniqueOrThrow({ where: { id: m.id } })).data as any).resumeChat.at(-1)
      .text,
  ).toContain('No wording changes needed');
  const manual = await request(
    m.id,
    {
      draftHash: restoredDraft.hash,
      factId: fact.id,
      text: 'Using SQL, I supported reporting for 2,000 orders.',
    },
    '/manual',
  );
  expect(manual.status).toBe(200);
  const manualDraft = (await manual.json()).resumeDraft;
  expect(manualDraft.hash).not.toBe(restoredDraft.hash);
  expect(manualDraft.claims[0].factText).toBe(fact.text);
  expect(
    (
      await request(
        m.id,
        {
          draftHash: restoredDraft.hash,
          factId: fact.id,
          text: 'Using SQL, I supported reporting for 2,000 orders.',
        },
        '/manual',
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        m.id,
        {
          draftHash: manualDraft.hash,
          factId: fact.id,
          text: 'I managed a team of 20 and increased revenue by 50%.',
        },
        '/manual',
      )
    ).status,
  ).toBe(422);
  expect(spy.mock.calls.length).toBe(callsBeforeRestore + 1);
  expect((await db.profile.findUniqueOrThrow({ where: { id: p.id } })).facts).toEqual([fact]);
  expect(
    (await request('another-account-mission', { draftHash: 'original', message: 'Edit' })).status,
  ).toBe(404);
});
