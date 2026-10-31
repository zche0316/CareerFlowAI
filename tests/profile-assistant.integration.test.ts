import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
import { sampleProfile, blankProfile } from '../packages/contracts/src/index.js';
import { digest, json, validateResumeClaims } from '../apps/api/src/domain.js';
import * as importProvider from '../packages/agents/src/import-model.js';
import * as provider from '../packages/agents/src/provider.js';
import { conversationModelProfile } from '../apps/api/src/profile-conversations.js';
let server: Server, base: string;
const ids: string[] = [];
type Client = {
  id: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<{ status: number; body: any }>;
};
async function client(): Promise<Client> {
  const r = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `assistant-${crypto.randomUUID()}@careerflow.test`,
      password: 'Assistant-test-password',
      name: 'Fictional QA',
    }),
  });
  const data = await r.json(),
    cookie = r.headers.get('set-cookie')!.split(';')[0];
  ids.push(data.user.id);
  return {
    id: data.user.id,
    request: async (path, method = 'GET', body) => {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
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
  for (const userId of ids) {
    await db.approvedResume.deleteMany({ where: { userId } });
    await db.mission.deleteMany({ where: { userId } });
    await db.profileDraft.deleteMany({ where: { userId } });
    await db.profile.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  await db.$disconnect();
});
async function approved(c: Client) {
  const input = { ...sampleProfile, experience: 'I used SQL to clean 120 records.' };
  const d = await c.request('/profiles/drafts', 'POST', input);
  const p = await c.request(`/profiles/drafts/${d.body.id}/approve`, 'POST', { reviewed: true });
  const mission = await db.mission.create({
    data: {
      userId: c.id,
      profileId: p.body.id,
      goal: 'Fictional assistant integration test',
      status: 'COMPLETE',
      mode: 'fixture',
      data: json({
        selectedJob: {
          job: {
            id: 'fictional-job',
            applicationUrl: 'https://example.test/job',
            source: { fictional: true },
            title: 'Analyst',
            company: 'Fictional QA',
          },
        },
      }),
      events: [],
    },
  });
  const content = {
    name: 'Fictional QA',
    jobTitle: 'Analyst',
    profileVersion: p.body.version,
    claims: [{ factId: 'experience-1', kind: 'experience', text: input.experience }],
  };
  const resume = await db.approvedResume.create({
    data: {
      userId: c.id,
      missionId: mission.id,
      draftHash: digest({ content, mission: mission.id }),
      content: json(content),
    },
  });
  await db.mission.update({
    where: { id: mission.id },
    data: { data: json({ ...(mission.data as any), approvedResumeId: resume.id }) },
  });
  return { profile: p.body, resume, mission };
}
describe('Persistent profile conversations', () => {
  it('persists proactive questions and user messages; failure retains the working form without approval', async () => {
    const c = await client(),
      other = await client();
    const t = await c.request('/profile-threads', 'POST', { currentProfile: blankProfile });
    expect(t.status).toBe(201);
    expect(t.body.messages[0].questions.length).toBeGreaterThan(0);
    expect((await other.request(`/profile-threads/${t.body.id}`)).status).toBe(404);
    const spy = vi
      .spyOn(provider, 'generate')
      .mockRejectedValueOnce(
        Object.assign(Error('Deadline reached'), { name: 'ProviderTimeoutError' }),
      );
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: blankProfile,
        text: 'My goal is a graduate data role.',
        revision: t.body.revision,
        consent: true,
      });
      expect(sent.status).toBe(200);
      expect(sent.body.messages.at(-1).failed).toBe(true);
      expect(sent.body.messages.at(-1).diagnostic).toMatchObject({
        category: 'timeout',
        stage: 'model-response',
        timeoutMs: 60000,
      });
      expect(sent.body.messages.at(-1).diagnostic.elapsedMs).toBeGreaterThanOrEqual(0);
      const saved = await c.request(`/profile-threads/${t.body.id}`);
      expect(
        saved.body.messages.some((m: any) => m.text === 'My goal is a graduate data role.'),
      ).toBe(true);
      expect(saved.body.workingForm).toEqual(blankProfile);
      expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('proposes grounded scalar/record changes; stale manual edits win; applying still requires profile approval', async () => {
    const c = await client(),
      form = structuredClone(sampleProfile);
    const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
    const text = 'I prefer Melbourne. Built Atlas with SQL.';
    const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
      builder: {
        draft: { location: 'Melbourne' },
        proposedChanges: [
          { field: 'location', proposedValue: 'Melbourne', evidence: 'I prefer Melbourne.' },
        ],
        followUpQuestions: [],
      },
      records: [
        {
          section: 'projects',
          title: 'Atlas',
          organisation: '',
          location: '',
          startMonth: null,
          endMonth: null,
          current: false,
          details: ['Built Atlas with SQL.'],
          technologies: ['SQL'],
          url: '',
          evidence: [{ page: 1, quote: 'Built Atlas with SQL.' }],
        },
      ],
    } as any);
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: form,
        text,
        revision: t.body.revision,
        consent: true,
      });
      expect(sent.body.messages.at(-1).failed).not.toBe(true);
      const p = sent.body.proposals.find((p: any) => p.field === 'location');
      expect(p.after).toBe('Melbourne');
      expect(
        (
          await c.request(`/profile-threads/${t.body.id}/proposals/${p.id}`, 'POST', {
            currentProfile: { ...form, location: 'Perth' },
            revision: sent.body.revision,
            decision: 'apply',
          })
        ).status,
      ).toBe(409);
      const applied = await c.request(`/profile-threads/${t.body.id}/proposals/${p.id}`, 'POST', {
        currentProfile: form,
        revision: sent.body.revision,
        decision: 'apply',
      });
      expect(applied.body.value).toBe('Melbourne');
      const record = sent.body.proposals.find((p: any) => p.field === 'projects');
      expect(record.after[0].conversationEvidence[0].threadId).toBe(t.body.id);
      const appliedRecord = await c.request(
        `/profile-threads/${t.body.id}/proposals/${record.id}`,
        'POST',
        {
          currentProfile: { ...form, location: 'Melbourne' },
          revision: applied.body.thread.revision,
          decision: 'apply',
        },
      );
      expect(appliedRecord.status).toBe(200);
      const draft = await c.request('/profiles/drafts', 'POST', {
        ...form,
        projects: appliedRecord.body.value,
      });
      expect(draft.status).toBe(201);
      const fact = draft.body.facts.find((f: any) => f.recordId === appliedRecord.body.value[0].id);
      expect(
        validateResumeClaims([{ factId: fact.id, reason: 'Project evidence' }], draft.body.facts)[0]
          .conversationEvidence?.[0].threadId,
      ).toBe(t.body.id);
      const other = await client();
      expect(
        (
          await other.request('/profiles/drafts', 'POST', {
            ...form,
            projects: appliedRecord.body.value,
          })
        ).status,
      ).toBe(422);
      expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('serializes concurrent turns and rejects stale revision retries', async () => {
    const c = await client();
    const t = await c.request('/profile-threads', 'POST', { currentProfile: sampleProfile });
    const result = await Promise.all(
      [1, 2].map((n) =>
        c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
          currentProfile: sampleProfile,
          text: `Question ${n}: SQL examples`,
          revision: 0,
          consent: true,
        }),
      ),
    );
    expect(result.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('keeps a Chinese education record when the model invents an optional start month', async () => {
    const c = await client();
    const form = structuredClone(blankProfile);
    const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
    const text =
      '我正在悉尼大学攻读 Bachelor of Commerce，主修 Business Analytics，预计 2026 年 11 月毕业。';
    const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
      reply: '已经更新了你的教育背景。',
      builder: { draft: {}, proposedChanges: [], followUpQuestions: [] },
      records: [
        {
          section: 'educations',
          title: 'Bachelor of Commerce',
          organisation: '悉尼大学',
          location: '',
          startMonth: '2023-02',
          endMonth: null,
          current: true,
          details: [],
          technologies: [],
          url: '',
          evidence: [{ page: 1, quote: text }],
        },
      ],
    } as any);
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: form,
        text,
        revision: t.body.revision,
        consent: true,
      });
      const proposal = sent.body.proposals.find((p: any) => p.field === 'educations');
      expect(proposal.after[0]).toMatchObject({
        title: 'Bachelor of Commerce',
        organisation: '悉尼大学',
        current: true,
        startMonth: null,
      });
      expect(sent.body.messages.at(-1).text).toContain('请在 Profile 中逐项查看并接受');
      expect(sent.body.workingForm.educations || []).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
  it('retains enrolment, ongoing study and expected graduation without repeated education questions', async () => {
    const c = await client();
    const form = {
      ...structuredClone(blankProfile),
      name: 'Alex Chen',
      goals: 'Graduate Business Analyst',
    };
    const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
    const text =
      "I'm studying a Bachelor of Commerce at the University of Sydney. I started in February 2024 and expect to graduate in November 2026. I'm still studying. My major is Business Analytics. My relevant coursework includes Database Systems and Business Statistics.";
    const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
      builder: { draft: {}, proposedChanges: [], followUpQuestions: [] },
      records: [
        {
          section: 'educations',
          title: 'Bachelor of Commerce',
          organisation: 'University of Sydney',
          location: '',
          startMonth: '2024-02',
          endMonth: '2026-11',
          major: 'Business Analytics',
          relevantCoursework: ['Database Systems', 'Business Statistics'],
          current: false,
          details: [],
          technologies: [],
          url: '',
          evidence: [{ page: 1, quote: text }],
        },
      ],
    } as any);
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: form,
        text,
        revision: t.body.revision,
        consent: true,
      });
      const proposal = sent.body.proposals.find((p: any) => p.field === 'educations');
      expect(proposal.after[0]).toMatchObject({
        startMonth: '2024-02',
        endMonth: null,
        expectedEndMonth: '2026-11',
        current: true,
      });
      expect(sent.body.messages.at(-1).questions.join(' ')).not.toMatch(
        /ongoing or completed|When did.*start/,
      );
      const accepted = await c.request(
        `/profile-threads/${t.body.id}/proposals/${proposal.id}`,
        'POST',
        {
          currentProfile: form,
          revision: sent.body.revision,
          decision: 'apply',
        },
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.value[0]).toMatchObject({
        major: 'Business Analytics',
        relevantCoursework: ['Database Systems', 'Business Statistics'],
        startMonth: '2024-02',
        endMonth: null,
        expectedEndMonth: '2026-11',
        current: true,
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('invalidates field proposals when their confirmed memory source is deleted', async () => {
    const c = await client(),
      form = structuredClone(sampleProfile);
    const memory = await c.request('/career-memories', 'POST', {
      kind: 'NOTE',
      title: 'Melbourne preference',
      text: 'I prefer Melbourne.',
      source: { kind: 'user', quote: 'I prefer Melbourne.' },
    });
    await c.request(`/career-memories/${memory.body.id}`, 'PATCH', { revision: 1, reviewed: true });
    const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
    const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
      builder: {
        draft: { location: 'Melbourne' },
        proposedChanges: [
          { field: 'location', proposedValue: 'Melbourne', evidence: 'I prefer Melbourne.' },
        ],
        followUpQuestions: [],
      },
      records: [],
    } as any);
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: form,
        text: 'Use my Melbourne preference.',
        revision: 0,
        consent: true,
      });
      const p = sent.body.proposals.find((p: any) => p.field === 'location');
      expect(p.evidence[0].memoryRef).toContain(memory.body.id);
      await c.request(`/career-memories/${memory.body.id}`, 'DELETE', { revision: 2 });
      const apply = await c.request(`/profile-threads/${t.body.id}/proposals/${p.id}`, 'POST', {
        currentProfile: form,
        revision: sent.body.revision,
        decision: 'apply',
      });
      expect(apply.status).toBe(409);
      expect(apply.body.code).toBe('STALE_MEMORY_SOURCE');
    } finally {
      spy.mockRestore();
    }
  });
});
describe('Profile edit mode', () => {
  it('uses edit intent without restarting interview or applying suggestions', async () => {
    const c = await client();
    const t = await c.request('/profile-threads', 'POST', {
      currentProfile: sampleProfile,
      mode: 'edit',
      title: 'Profile edits',
    });
    expect(t.body.messages[0].questions).toEqual([]);
    const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
      reply: 'I have prepared a location suggestion for your review.',
      builder: {
        draft: { location: 'Melbourne' },
        proposedChanges: [
          { field: 'location', proposedValue: 'Melbourne', evidence: 'I prefer Melbourne.' },
        ],
        followUpQuestions: [],
      },
      records: [],
    } as any);
    try {
      const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
        currentProfile: sampleProfile,
        revision: t.body.revision,
        consent: true,
        mode: 'edit',
        text: 'I prefer Melbourne.',
      });
      expect(sent.status).toBe(200);
      expect(sent.body.messages.at(-1).questions).toEqual([]);
      expect(
        sent.body.proposals.some((p: any) => p.field === 'location' && p.status === 'PENDING'),
      ).toBe(true);
      expect(sent.body.workingForm.location).toBe(sampleProfile.location);
      expect((spy.mock.calls[0][1] as any).goal).toContain('Edit the existing career profile');
      expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
describe('Profile wording polish', () => {
  it('proposes conservative edits with source snapshots and leaves factual approval explicit', async () => {
    const c = await client(),
      other = await client();
    const form = { ...sampleProfile, experience: 'I used SQL to clean 120 records.' };
    const t = await c.request('/profile-threads', 'POST', {
      currentProfile: form,
      mode: 'edit',
      title: 'Profile edits',
    });
    const forbidden = await other.request(`/profile-threads/${t.body.id}/polish`, 'POST', {
      currentProfile: form,
      revision: t.body.revision,
      consent: true,
    });
    expect(forbidden.status).toBe(404);
    const result = await c.request(`/profile-threads/${t.body.id}/polish`, 'POST', {
      currentProfile: form,
      revision: t.body.revision,
      consent: true,
    });
    expect(result.status).toBe(200);
    const p = result.body.proposals.find((p: any) => p.field === 'experience');
    expect(p.after).toBe('used SQL to clean 120 records.');
    expect(result.body.workingForm.experience).toBe(form.experience);
    expect(
      result.body.messages.find((m: any) => m.kind === 'profile-polish').profileSnapshot,
    ).toEqual(form);
    expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    const stale = await c.request(`/profile-threads/${t.body.id}/proposals/${p.id}`, 'POST', {
      currentProfile: { ...form, experience: 'My manual edit' },
      revision: result.body.revision,
      decision: 'apply',
    });
    expect(stale.status).toBe(409);
  });
});
describe('Career memory lifecycle and scoped retrieval', () => {
  it('retrieves only owned confirmed memories and retires corrected/deleted versions', async () => {
    const c = await client(),
      other = await client();
    const make = (text: string, supersedesId?: string) => ({
      kind: 'NOTE',
      title: 'Atlas evidence',
      text,
      source: { kind: 'user', quote: text },
      ...(supersedesId ? { supersedesId } : {}),
    });
    const first = await c.request('/career-memories', 'POST', make('Atlas SQL dataset'));
    expect(first.status).toBe(201);
    expect((await c.request('/career-evidence?q=Atlas')).body.hits).toHaveLength(0);
    expect(
      (
        await c.request(`/career-memories/${first.body.id}`, 'PATCH', {
          revision: 1,
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    expect((await c.request('/career-evidence?q=Atlas')).body.hits).toHaveLength(1);
    expect((await other.request('/career-evidence?q=Atlas')).body.hits).toHaveLength(0);
    const next = await c.request(
      '/career-memories',
      'POST',
      make('Atlas Python dataset', first.body.id),
    );
    expect(
      (
        await c.request(`/career-memories/${next.body.id}`, 'PATCH', {
          revision: 1,
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    expect((await c.request('/career-evidence?q=SQL')).body.hits).toHaveLength(0);
    const hits = (await c.request('/career-evidence?q=Python')).body.hits;
    expect(hits).toHaveLength(1);
    expect(
      (await other.request(`/career-memories/${next.body.id}`, 'DELETE', { revision: 2 })).status,
    ).toBe(409);
    expect(
      (await c.request(`/career-memories/${next.body.id}`, 'DELETE', { revision: 2 })).status,
    ).toBe(200);
    expect((await c.request('/career-evidence?q=Python')).body.insufficientRecall).toBe(true);
  });
  it('rejects forged provenance, cross-user project links and incomplete STAR stories', async () => {
    const c = await client();
    expect(
      (
        await c.request('/career-memories', 'POST', {
          kind: 'STAR',
          title: 'Incomplete',
          source: { kind: 'user', quote: 'Test' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await c.request('/career-memories', 'POST', {
          kind: 'NOTE',
          title: 'Forged',
          text: 'SQL',
          source: {
            kind: 'conversation',
            id: `${crypto.randomUUID()}/${crypto.randomUUID()}`,
            quote: 'SQL',
          },
        })
      ).status,
    ).toBe(404);
  });
});
describe('Reviewed resume expression and application preparation', () => {
  it('keeps immutable facts, blocks invented metrics, creates a distinct downloadable reviewed edition', async () => {
    const c = await client(),
      other = await client(),
      fixture = await approved(c);
    expect((await other.request(`/resumes/${fixture.resume.id}/wording`)).status).toBe(404);
    const p = await c.request(`/resumes/${fixture.resume.id}/wording`, 'POST', {
      factId: 'experience-1',
      consent: true,
    });
    expect(p.body.status).toBe('PENDING');
    expect(
      (
        await c.request(`/resume-wordings/${p.body.id}`, 'PATCH', {
          decision: 'accept',
          reviewed: true,
          after: 'used SQL to clean 200 records.',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await c.request(`/resume-wordings/${p.body.id}`, 'PATCH', {
          decision: 'accept',
          reviewed: true,
        })
      ).status,
    ).toBe(200);
    const final = await c.request(`/resumes/${fixture.resume.id}/wording/finalize`, 'POST', {
      reviewed: true,
    });
    expect(final.status).toBe(201);
    expect(final.body.id).not.toBe(fixture.resume.id);
    expect(final.body.content.claims[0].factText).toBe('I used SQL to clean 120 records.');
    expect(final.body.content.claims[0].text).toBe('used SQL to clean 120 records.');
    expect(
      (await db.approvedResume.findUniqueOrThrow({ where: { id: fixture.resume.id } })).content,
    ).toEqual(fixture.resume.content);
    const duplicate = await c.request(`/resumes/${fixture.resume.id}/wording/finalize`, 'POST', {
      reviewed: true,
    });
    expect(duplicate.body.id).toBe(final.body.id);
    const unchanged = await c.request(`/resumes/${final.body.id}/wording`, 'POST', {
      factId: 'experience-1',
      consent: true,
    });
    expect(unchanged.body.status).toBe('NO_CHANGE');
  });
  it('checks application-only gaps, persists reviewed answers and rejects stale/forged fields', async () => {
    const c = await client(),
      fixture = await approved(c);
    const path = `/missions/${fixture.mission.id}/application-readiness`;
    const check = await c.request(path);
    expect(check.body.schemaKnown).toBe(false);
    expect(check.body.fields.length).toBe(4);
    expect(
      (await c.request(path, 'POST', { hash: 'stale', answers: {}, reviewed: true })).status,
    ).toBe(409);
    expect(
      (
        await c.request(path, 'POST', {
          hash: check.body.hash,
          answers: { fake: 'answer' },
          reviewed: true,
        })
      ).status,
    ).toBe(422);
    const save = await c.request(path, 'POST', {
      hash: check.body.hash,
      answers: { candidate_name: 'Fictional QA' },
      reviewed: true,
    });
    expect(save.body.missingCount).toBe(3);
    expect((await c.request(path)).body.answers.candidate_name).toBe('Fictional QA');
    const p = await db.profile.findUniqueOrThrow({ where: { id: fixture.profile.id } });
    expect((p.data as any).name).toBe(sampleProfile.name);
  });
});

it('organizes only selected import pages, discloses rejected records and enforces the selected text budget', async () => {
  const c = await client();
  const quote = 'Engineer at Example 2024.01 - 2025.02 Built SQL reports.';
  const source = await db.profileImport.create({
    data: {
      userId: c.id,
      filename: 'Fictional bilingual fixture.pdf',
      mime: 'application/pdf',
      file: Buffer.from('test fixture'),
      pages: json([
        { page: 1, text: 'First-language filler '.repeat(430), route: 'text', method: 'pdf-text' },
        {
          page: 2,
          text: quote + ' Second-language filler'.repeat(430),
          route: 'text',
          method: 'pdf-text',
        },
      ]),
      proposed: json({ records: [], questions: [], rejected: [] }),
      events: [],
    },
  });
  const spy = vi.spyOn(importProvider, 'importModel').mockResolvedValue({
    result: {
      records: [
        {
          section: 'workExperiences',
          title: 'Engineer',
          organisation: 'Example',
          location: 'Unverified City',
          startMonth: '2024-01',
          endMonth: '2025-02',
          current: false,
          details: ['Built SQL reports.'],
          technologies: ['SQL'],
          url: '',
          evidence: [{ page: 2, quote }],
        },
      ],
      questions: [],
    },
    usage: { model: 'test-fixture', inputTokens: 0, outputTokens: 0 },
  } as any);
  process.env.PROVIDER_MODE = 'openai';
  try {
    const tooLong = await c.request(`/profiles/imports/${source.id}/structure`, 'POST', {
      consent: true,
    });
    expect(tooLong.body.code).toBe('TEXT_LIMIT');
    const wrong = await c.request(`/profiles/imports/${source.id}/structure`, 'POST', {
      consent: true,
      pages: [1],
    });
    expect(wrong.body.status).toBe('NEEDS_CORRECTION');
    expect(wrong.body.proposed.rejectedDetails.length).toBe(1);
    const right = await c.request(`/profiles/imports/${source.id}/structure`, 'POST', {
      consent: true,
      pages: [2],
    });
    expect(right.body.status).toBe('READY_FOR_REVIEW');
    expect(right.body.proposed.records[0].location).toBe('');
    expect(right.body.proposed.repairs[0].fields[0].field).toBe('location');
    expect(right.body.proposed.records[0].startMonth).toBe('2024-01');
    expect(spy.mock.calls.at(-1)?.[1]).toEqual([
      { page: 2, text: (source.pages as any[])[1].text },
    ]);
  } finally {
    spy.mockRestore();
    process.env.PROVIDER_MODE = 'fixture';
  }
});

it('confirms a correction of a draft correction without retaining the old confirmed source in retrieval', async () => {
  const c = await client();
  const create = (text: string, supersedesId?: string) =>
    c.request('/career-memories', 'POST', {
      kind: 'NOTE',
      title: 'Correction chain',
      text,
      source: { kind: 'user', quote: text },
      ...(supersedesId ? { supersedesId } : {}),
    });
  const original = await create('Originalanchor SQL story');
  await c.request(`/career-memories/${original.body.id}`, 'PATCH', { revision: 1, reviewed: true });
  const middle = await create('Intermediate corrected story', original.body.id);
  const latest = await create('Latestanchor Python story', middle.body.id);
  expect(
    (
      await c.request(`/career-memories/${latest.body.id}`, 'PATCH', {
        revision: 1,
        reviewed: true,
      })
    ).status,
  ).toBe(200);
  expect((await c.request('/career-evidence?q=Originalanchor')).body.hits).toHaveLength(0);
  expect((await c.request('/career-evidence?q=Latestanchor')).body.hits).toHaveLength(1);
  expect(
    (await db.careerMemory.findUniqueOrThrow({ where: { id: original.body.id } })).status,
  ).toBe('SUPERSEDED');
});

it('builds one project across conversational answers and applies a reviewed turn atomically without legacy duplicate facts', async () => {
  const c = await client(),
    other = await client();
  const form = { ...structuredClone(sampleProfile), education: 'none yet', experience: 'none yet' };
  const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
  const first = 'My Atlas project checked missing values.';
  const second = 'I used SQL to check duplicates.';
  const rec = {
    section: 'projects',
    title: 'Atlas',
    organisation: '',
    location: '',
    startMonth: null,
    endMonth: null,
    current: false,
    details: [first],
    technologies: [],
    url: '',
    evidence: [{ page: 1, quote: first }],
  };
  const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
    reply: "I've added these details to your profile.",
    builder: {
      draft: {},
      proposedChanges: [],
      followUpQuestions: ['What did you do?', 'What was the result?'],
    },
    records: [rec],
  } as any);
  try {
    const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
      currentProfile: form,
      text: first,
      revision: t.body.revision,
      consent: true,
    });
    expect(sent.body.messages.at(-1).questions).toHaveLength(1);
    expect(sent.body.messages.at(-1).text).not.toContain("I've added");
    expect(
      (
        await other.request(`/profile-threads/${t.body.id}/proposals`, 'POST', {
          currentProfile: form,
          revision: sent.body.revision,
          reviewed: true,
        })
      ).status,
    ).toBe(404);
    const applied = await c.request(`/profile-threads/${t.body.id}/proposals`, 'POST', {
      currentProfile: form,
      revision: sent.body.revision,
      reviewed: true,
    });
    expect(applied.status).toBe(200);
    expect(applied.body.data.projects).toHaveLength(1);
    expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    const originalId = applied.body.data.projects[0].id;
    spy.mockResolvedValueOnce({
      builder: {
        draft: { location: 'Melbourne' },
        proposedChanges: [
          { field: 'location', proposedValue: 'Melbourne', evidence: 'I prefer Melbourne.' },
        ],
        followUpQuestions: [],
      },
      records: [
        {
          ...rec,
          details: [second],
          evidence: [
            { page: 1, quote: first },
            { page: 2, quote: second },
          ],
        },
      ],
    } as any);
    const followup = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
      currentProfile: applied.body.data,
      text: second + ' I prefer Melbourne.',
      revision: applied.body.thread.revision,
      consent: true,
    });
    expect(followup.body.messages.at(-1).failed).not.toBe(true);
    const conflict = await c.request(`/profile-threads/${t.body.id}/proposals`, 'POST', {
      currentProfile: { ...applied.body.data, location: 'Perth' },
      revision: followup.body.revision,
      reviewed: true,
    });
    expect(conflict.status).toBe(409);
    const unchanged = await c.request(`/profile-threads/${t.body.id}`);
    expect(
      unchanged.body.proposals.filter((p: any) => p.status === 'PENDING').length,
    ).toBeGreaterThan(0);
    const updated = await c.request(`/profile-threads/${t.body.id}/proposals`, 'POST', {
      currentProfile: applied.body.data,
      revision: followup.body.revision,
      reviewed: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.projects).toHaveLength(1);
    expect(updated.body.data.projects[0].id).toBe(originalId);
    expect(updated.body.data.projects[0].details).toEqual([first, second]);
    const draft = await c.request('/profiles/drafts', 'POST', updated.body.data);
    expect(draft.status).toBe(201);
    expect(draft.body.facts.filter((f: any) => f.recordId === originalId)).toHaveLength(3);
    expect(draft.body.facts.some((f: any) => f.text === 'none yet')).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it('recovers omitted citations only from exact user clauses while preserving negations and anchored education', async () => {
  const c = await client();
  const t = await c.request('/profile-threads', 'POST', { currentProfile: blankProfile });
  const text =
    'My name is Alex QA. I want a Graduate Data Analyst role. I use SQL. I have no Python experience. Bachelor of IT at Example University, 2022-02 to 2025-11.';
  const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
    builder: {
      draft: {
        name: 'Alex QA',
        goals: 'Graduate Data Analyst role',
        skills: ['SQL', 'Python'],
        careerStage: 'graduate',
      },
      proposedChanges: [{ field: 'name', proposedValue: 'Alex QA', evidence: 'I am Alex QA.' }],
      followUpQuestions: ['What project did you do?'],
    },
    records: [
      {
        section: 'educations',
        title: 'Bachelor of IT',
        organisation: 'Example University',
        location: '',
        startMonth: '2022-02',
        endMonth: '2025-11',
        current: false,
        details: ['Invented degree details'],
        technologies: [],
        url: '',
        evidence: [
          { page: 1, quote: 'Bachelor of IT at Example University from 2022-02 to 2025-11.' },
        ],
      },
    ],
  } as any);
  try {
    const sent = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
      currentProfile: blankProfile,
      text,
      revision: t.body.revision,
      consent: true,
    });
    expect(sent.body.messages.at(-1).failed).not.toBe(true);
    expect(sent.body.proposals.find((p: any) => p.field === 'name').after).toBe('Alex QA');
    expect(sent.body.proposals.find((p: any) => p.field === 'goals').after).toBe(
      'Graduate Data Analyst role',
    );
    expect(sent.body.proposals.some((p: any) => p.field === 'careerStage')).toBe(false);
    expect(sent.body.proposals.find((p: any) => p.field === 'skills').after).toEqual(['SQL']); // retain explicit SQL, exclude negated Python
    expect(sent.body.proposals.find((p: any) => p.field === 'educations').after[0].details).toEqual(
      [],
    );
  } finally {
    spy.mockRestore();
  }
});

it('finishes experiences without an AI call, persists control state, preserves pending details and ends the interview without approval', async () => {
  const c = await client(),
    other = await client();
  const form = {
    ...structuredClone(sampleProfile),
    projects: [
      {
        id: 'control-alpha',
        title: 'Alpha project',
        organisation: 'Example University',
        location: '',
        startMonth: null,
        endMonth: null,
        current: false,
        details: ['I used SQL. The outcome is unknown.'],
        technologies: ['SQL'],
        url: '',
        evidence: [],
      },
    ],
  };
  const started = await c.request('/profile-threads', 'POST', { currentProfile: form });
  const spy = vi
    .spyOn(provider, 'generate')
    .mockRejectedValue(Error('Provider deliberately unavailable'));
  try {
    const stopped = await c.request(`/profile-threads/${started.body.id}/messages`, 'POST', {
      currentProfile: form,
      revision: started.body.revision,
      consent: true,
      text: 'I think the content is enough now for this project',
    });
    expect(stopped.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    expect(stopped.body.interview.closed).toHaveLength(1);
    expect(stopped.body.messages.at(-1).questions.join(' ')).not.toContain('Alpha');
    expect((await c.request(`/profile-threads/${started.body.id}`)).body.interview.closed).toEqual(
      stopped.body.interview.closed,
    );
    expect(
      (
        await other.request(`/profile-threads/${started.body.id}/controls`, 'POST', {
          currentProfile: form,
          revision: stopped.body.revision,
          action: 'finish_interview',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await c.request(`/profile-threads/${started.body.id}/controls`, 'POST', {
          currentProfile: form,
          revision: started.body.revision,
          action: 'finish_interview',
        })
      ).status,
    ).toBe(409);
    const ended = await c.request(`/profile-threads/${started.body.id}/controls`, 'POST', {
      currentProfile: form,
      revision: stopped.body.revision,
      action: 'finish_interview',
    });
    expect(ended.body.interview.phase).toBe('review');
    expect(ended.body.messages.at(-1).questions).toEqual([]);
    expect(
      (
        await c.request(`/profile-threads/${started.body.id}/messages`, 'POST', {
          currentProfile: form,
          revision: ended.body.revision,
          consent: true,
          text: 'More details',
        })
      ).status,
    ).toBe(409);
    expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
    const resumed = await c.request(`/profile-threads/${started.body.id}/controls`, 'POST', {
      currentProfile: form,
      revision: ended.body.revision,
      action: 'resume',
    });
    expect(resumed.body.interview.closed).toHaveLength(1);
    const failed = await c.request(`/profile-threads/${started.body.id}/messages`, 'POST', {
      currentProfile: form,
      revision: resumed.body.revision,
      consent: true,
      text: 'My next project is Beta.',
    });
    expect(failed.body.messages.at(-1).failed).toBe(true);
    expect(failed.body.messages.at(-1).questions).toEqual([]);
    const savedAnswer = failed.body.messages
      .filter((m: any) => m.role === 'user' && m.kind !== 'interview-control')
      .at(-1);
    spy.mockResolvedValueOnce({
      builder: { draft: {}, proposedChanges: [], followUpQuestions: ['When did Alpha start?'] },
      records: [
        {
          section: 'projects',
          title: 'Beta',
          organisation: '',
          location: '',
          startMonth: null,
          endMonth: null,
          current: false,
          details: [],
          technologies: [],
          url: '',
          evidence: [{ page: 1, quote: 'My next project is Beta.' }],
        },
      ],
    } as any);
    const retry = await c.request(`/profile-threads/${started.body.id}/messages`, 'POST', {
      currentProfile: form,
      revision: failed.body.revision,
      consent: true,
      text: savedAnswer.text,
      retryMessageId: savedAnswer.id,
    });
    expect(retry.body.messages.at(-1).failed).not.toBe(true);
    expect(retry.body.messages.filter((m: any) => m.id === savedAnswer.id)).toHaveLength(1);
    expect(retry.body.messages.at(-1).questions.join(' ')).toContain('Beta');
    expect(retry.body.messages.at(-1).questions.join(' ')).not.toContain('Alpha');
    const pending = retry.body.proposals.filter((p: any) => p.status === 'PENDING');
    expect(pending.length).toBeGreaterThan(0);
    const finish = await c.request(`/profile-threads/${started.body.id}/controls`, 'POST', {
      currentProfile: form,
      revision: retry.body.revision,
      action: 'finish_interview',
    });
    expect(finish.body.proposals.filter((p: any) => p.status === 'PENDING')).toEqual(pending);
    expect(finish.body.interview.phase).toBe('review');
  } finally {
    spy.mockRestore();
  }
});

it('organises all saved answers for a finished legacy experience without adding a new answer or restarting questions', async () => {
  const c = await client();
  const form = structuredClone(sampleProfile);
  const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
  const source = 'My Legacy Data Project used SQL.';
  const messages = [
    { id: crypto.randomUUID(), role: 'user', text: source },
    {
      id: crypto.randomUUID(),
      role: 'user',
      text: 'It was a course project from 2024.09-2024.10.',
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: crypto.randomUUID(),
      role: 'user',
      text: `Unrelated short answer ${i}.`,
    })),
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      questions: ['When did Legacy Data Project start?'],
    },
    {
      id: crypto.randomUUID(),
      role: 'user',
      text: 'I think the content is enough now for this project',
    },
  ];
  await db.profileThread.update({ where: { id: t.body.id }, data: { messages: json(messages) } });
  const stopped = await c.request(`/profile-threads/${t.body.id}/controls`, 'POST', {
    currentProfile: form,
    revision: t.body.revision,
    action: 'finish_interview',
  });
  expect(stopped.body.hasUnfiledExperience).toBe(true);
  const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
    builder: {
      draft: {},
      proposedChanges: [],
      followUpQuestions: ['When did Legacy Data Project start?'],
    },
    records: [
      {
        section: 'projects',
        title: 'Legacy Data Project',
        organisation: '',
        location: '',
        startMonth: null,
        endMonth: null,
        current: false,
        details: [source],
        technologies: ['SQL'],
        url: '',
        evidence: [{ page: 3, quote: 'Legacy Data Project 2024-09 to 2024-10' }],
      },
    ],
  } as any);
  try {
    const recovered = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
      currentProfile: form,
      revision: stopped.body.revision,
      consent: true,
      text: 'Organise saved answers.',
      recoverSavedAnswers: true,
    });
    expect(
      recovered.body.messages.at(-1).failed,
      JSON.stringify(recovered.body.messages.at(-1).diagnostic),
    ).not.toBe(true);
    expect(recovered.body.interview.phase).toBe('review');
    expect(recovered.body.messages.at(-1).questions).toEqual([]);
    expect(recovered.body.messages.filter((m: any) => m.role === 'user')).toHaveLength(
      messages.filter((m) => m.role === 'user').length + 1,
    ); // only finish control
    expect(recovered.body.proposals.find((p: any) => p.field === 'projects').after[0].title).toBe(
      'Legacy Data Project',
    );
    expect(recovered.body.hasUnfiledExperience).toBe(false);
    expect(recovered.body.messages.at(-1).preparation.status).toBe('ready');
    expect((spy.mock.calls[0][1] as any).prepareSavedAnswers).toBe(true);
    expect((spy.mock.calls[0][1] as any).goal).toContain('Do not ask questions');
    expect(await db.profile.count({ where: { userId: c.id } })).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

it('retains an explicitly chosen title verbatim and resolves date/source messages when a model corrects its spelling and cites wrong pages', async () => {
  const c = await client(),
    form = structuredClone(sampleProfile);
  const t = await c.request('/profile-threads', 'POST', { currentProfile: form });
  const user = (text: string) => ({ id: crypto.randomUUID(), role: 'user', text });
  const assistant = (q: string) => ({
    id: crypto.randomUUID(),
    role: 'assistant',
    text: q,
    questions: [q],
  });
  const title = 'Data Project Based on Wisonsion Dataset';
  const messages = [
    user('I used Python and Pandas to clean the course dataset.'),
    assistant('What title would you like to give this project?'),
    user(title),
    assistant('When did Data Project start and end?'),
    user('It was a course project from 2024.09-2024.10.'),
    assistant('Where was the Data Project carried out?'),
    user('Example University'),
    user('I think the content is enough now for this project'),
  ];
  await db.profileThread.update({ where: { id: t.body.id }, data: { messages: json(messages) } });
  const ended = await c.request(`/profile-threads/${t.body.id}/controls`, 'POST', {
    currentProfile: form,
    revision: t.body.revision,
    action: 'finish_interview',
  });
  const spy = vi.spyOn(provider, 'generate').mockResolvedValueOnce({
    builder: { draft: {}, proposedChanges: [], followUpQuestions: [] },
    records: [
      {
        section: 'projects',
        title: 'Data Project Based on Wisconsin Dataset',
        organisation: 'Example University',
        location: '',
        startMonth: '2024-09',
        endMonth: '2024-10',
        current: false,
        details: ['Invented polished summary'],
        technologies: ['Python', 'Pandas'],
        url: '',
        evidence: [{ page: 1, quote: 'Data Project at Example University 2024-09 to 2024-10' }],
      },
      {
        section: 'projects',
        title: 'Unrelated Old Example',
        organisation: 'Example Company',
        location: '',
        startMonth: '2020-01',
        endMonth: '2020-02',
        current: false,
        details: [],
        technologies: [],
        url: '',
        evidence: [{ page: 1, quote: 'Unrelated Old Example 2020' }],
      },
    ],
  } as any);
  try {
    const r = await c.request(`/profile-threads/${t.body.id}/messages`, 'POST', {
      currentProfile: form,
      revision: ended.body.revision,
      consent: true,
      text: 'Prepare saved answers',
      recoverSavedAnswers: true,
    });
    expect(
      r.body.messages.at(-1).failed,
      JSON.stringify(r.body.messages.at(-1).diagnostic),
    ).not.toBe(true);
    const record = r.body.proposals.find((p: any) => p.field === 'projects').after[0];
    expect(record.title).toBe(title);
    expect(record.startMonth).toBe('2024-09');
    expect(record.endMonth).toBe('2024-10');
    expect(record.details).toContain('I used Python and Pandas to clean the course dataset.');
    expect(record.details.join(' ')).not.toContain('Invented polished summary');
    expect(r.body.messages.at(-1).preparation.status).toBe('ready');
  } finally {
    spy.mockRestore();
  }
});

it('organises owned experience into pending source-linked groups and an idempotent draft memory', async () => {
  vi.restoreAllMocks();
  const c = await client(),
    other = await client();
  const form = {
    ...sampleProfile,
    projects: [
      {
        id: 'organise-test',
        title: 'Fictional QA project',
        organisation: 'Example University',
        location: '',
        startMonth: '2024-09',
        endMonth: '2024-10',
        current: false,
        details: ['I wrote 20 tests for the test dataset.', 'Our team presented a report.'],
        technologies: ['Python'],
        url: '',
        evidence: [],
      },
    ],
  };
  const t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
  const body = {
    currentProfile: form,
    revision: t.revision,
    recordId: 'organise-test',
    recordSection: 'projects',
    consent: true,
  };
  expect((await other.request(`/profile-threads/${t.id}/organise`, 'POST', body)).status).toBe(404);
  expect(
    (await c.request(`/profile-threads/${t.id}/organise`, 'POST', { ...body, consent: false }))
      .status,
  ).toBe(422);
  const result = await c.request(`/profile-threads/${t.id}/organise`, 'POST', body);
  expect(result.status).toBe(200);
  const memory = await db.careerMemory.findUniqueOrThrow({ where: { id: result.body.memoryId } });
  expect(memory.status).toBe('DRAFT');
  expect(memory.text).toContain('20 tests for the test dataset');
  const saved = (await c.request(`/profile-threads/${t.id}`)).body;
  expect(saved.workingForm.projects[0].organisedStory).toBeUndefined();
  expect(saved.proposals.at(-1).after[0].organisedStory.groups[0].items).toHaveLength(2);
  expect((await c.request(`/profile-threads/${t.id}/organise`, 'POST', body)).status).toBe(409);
  const again = await c.request(`/profile-threads/${t.id}/organise`, 'POST', {
    ...body,
    revision: saved.revision,
  });
  expect(again.body.memoryId).toBe(memory.id);
  const applied = await c.request(`/profile-threads/${t.id}/proposals`, 'POST', {
    currentProfile: form,
    revision: again.body.revision,
    reviewed: true,
  });
  expect(applied.status).toBe(200);
  expect(applied.body.data.projects[0].details).toEqual(form.projects[0].details);
  expect(applied.body.data.projects[0].organisedStory.groups).toHaveLength(1);
});

it('rejects invented organiser output without saving a memory or altering a draft', async () => {
  const c = await client(),
    form = {
      ...sampleProfile,
      projects: [
        { id: 'unsafe-summary', title: 'Fictional project', details: ['I wrote 20 tests.'] },
      ],
    };
  const t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
  vi.spyOn(provider, 'generate').mockResolvedValueOnce({
    groups: [
      { category: 'action', items: [{ text: 'I managed 200 staff.', sourceIndices: [99] }] },
    ],
  } as any);
  const result = await c.request(`/profile-threads/${t.id}/organise`, 'POST', {
    currentProfile: form,
    revision: t.revision,
    recordId: 'unsafe-summary',
    recordSection: 'projects',
    consent: true,
  });
  expect(result.status).toBe(422);
  expect(await db.careerMemory.count({ where: { userId: c.id } })).toBe(0);
  expect((await c.request(`/profile-threads/${t.id}`)).body.revision).toBe(t.revision);
  vi.restoreAllMocks();
});

it('projects a compact model context without duplicating raw evidence and organised stories', () => {
  const details = ['I wrote 20 tests.'.repeat(100)];
  const source = {
    ...sampleProfile,
    projects: [
      {
        id: 'same-legacy-id',
        title: 'Fictional project',
        details,
        conversationEvidence: [{ quote: 'x'.repeat(6000) }],
        organisedStory: { groups: [{ items: details }] },
      },
    ],
  };
  const context = conversationModelProfile(source);
  expect(context.projects[0].title).toBe('Fictional project');
  expect(context.projects[0].conversationEvidence).toBeUndefined();
  expect(context.projects[0].organisedStory).toBeUndefined();
  expect(context.projects[0].details).toEqual([]);
  expect(source.projects[0].details[0].length).toBeGreaterThan(160);
});

it('maps a complete labelled volunteer answer into its own project without a second generative extraction', async () => {
  vi.restoreAllMocks();
  const c = await client(),
    form = { ...sampleProfile, projects: [] };
  const t = (await c.request('/profile-threads', 'POST', { currentProfile: form })).body;
  const generate = vi.spyOn(provider, 'generate');
  const text =
    'Title: Fictional volunteer\nType: volunteer\nOrganisation: Example Centre\nDates: 2025-07 to 2025-08, completed.\nBackground: We ran a practice workshop.\nPersonal responsibility: I prepared the exercise.\nPersonal actions: I explained sorting in Excel.\nTeam outcomes: Satisfaction was not measured.\nTools: Excel\nReflection: I learned to explain one step at a time.';
  const answer = await c.request(`/profile-threads/${t.id}/messages`, 'POST', {
    currentProfile: form,
    revision: t.revision,
    text,
    consent: true,
  });
  expect(answer.status).toBe(200);
  expect(generate).not.toHaveBeenCalled();
  const proposal = answer.body.proposals.find(
    (p: any) => p.field === 'projects' && p.status === 'PENDING',
  );
  expect(proposal.after).toHaveLength(1);
  expect(proposal.after[0].title).toBe('Fictional volunteer');
  expect(proposal.after[0].startMonth).toBe('2025-07');
  expect(proposal.after[0].details.join(' ')).toContain('Satisfaction was not measured.');
  expect(answer.body.messages.find((m: any) => m.role === 'user').fieldTags).toContain(
    'personal actions',
  );
  vi.restoreAllMocks();
});
