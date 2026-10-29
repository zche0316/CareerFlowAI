import { it, expect } from 'vitest';
import { profileSchema, sampleProfile } from '../packages/contracts/src/index.js';
import { recordSchema } from '../packages/contracts/src/profile-records.js';
import { buildFacts, validateResumeClaims } from '../apps/api/src/domain.js';
import { groundImportedRecords, importResultSchema } from '../packages/agents/src/import-model.js';
import { pageRoute } from '../packages/agents/src/router.js';
const record = recordSchema.parse({
  id: 'work-one',
  title: 'Software Engineer',
  organisation: 'Example Pty Ltd',
  startMonth: '2024-01',
  endMonth: '2025-02',
  details: ['Built SQL reports.'],
});
it('supports multiple independent dated records and preserves IDs, source quotes and section through resume selection', () => {
  const p = profileSchema.parse({
    ...sampleProfile,
    education: '',
    experience: '',
    workExperiences: [record, { ...record, id: 'work-two', title: 'Analyst' }],
    projects: [{ ...record, id: 'project-one' }],
    educations: [{ ...record, id: 'edu-one', title: 'Bachelor of IT' }],
  });
  const f = buildFacts(p);
  expect(f.find((x) => x.id === 'workExperiences-work-one')?.text).toContain('2024-01 – 2025-02');
  expect(f.filter((x) => x.kind === 'experience' && !x.recordHeaderId)).toHaveLength(3);
  expect(f.filter((x) => x.recordHeaderId)).toHaveLength(4);
  const chosen = validateResumeClaims(
    [{ factId: 'projects-project-one', reason: 'Relevant confirmed project' }],
    f,
  );
  expect(chosen[0].section).toBe('projects');
  expect(
    buildFacts({ ...p, workExperiences: [...p.workExperiences!].reverse() })
      .map((x) => x.id)
      .sort(),
  ).toEqual(f.map((x) => x.id).sort());
});
it('rejects reversed/invalid dates, current end dates, duplicate record IDs and dangerous links', () => {
  for (const patch of [
    { endMonth: '2023-01' },
    { startMonth: '2024-13' },
    { current: true },
    { url: 'javascript:alert(1)' },
  ])
    expect(() => recordSchema.parse({ ...record, ...patch })).toThrow();
  expect(() => profileSchema.parse({ ...sampleProfile, projects: [record, record] })).toThrow();
});
it('routes short or corrupt page text to vision and ordinary text locally', () => {
  expect(pageRoute('')).toBe('vision');
  expect(pageRoute('x\uFFFD'.repeat(100))).toBe('vision');
  expect(
    pageRoute('A normal resume with enough readable words and numbers for local extraction.'),
  ).toBe('text');
});
it('grounds imported fields and normalized dates in exact saved page quotes, rejecting invented or shifted records', () => {
  const text = 'Software Engineer at Example Pty Ltd\nJan 2024 - Feb 2025\nBuilt SQL reports.';
  const r = { ...record, section: 'workExperiences', evidence: [{ page: 1, quote: text }] };
  const parsed = importResultSchema.parse({
    records: [
      r,
      { ...r, title: 'Chief Technology Officer' },
      { ...r, startMonth: '2022-01' },
      { ...r, evidence: [{ page: 2, quote: text }] },
    ],
    questions: ['Which city?'],
  });
  const grounded = groundImportedRecords(parsed, [
    { page: 1, text, route: 'text', method: 'pdf-text' },
  ]);
  expect(grounded.records).toHaveLength(1);
  expect(grounded.rejected).toHaveLength(3);
  expect(grounded.records[0].startMonth).toBe('2024-01');
});

it('supports current education with a separately stated expected completion month', () => {
  const r = recordSchema.parse({
    ...record,
    current: true,
    endMonth: null,
    expectedEndMonth: '2027-11',
  });
  expect(r.expectedEndMonth).toBe('2027-11');
  expect(() => recordSchema.parse({ ...r, expectedEndMonth: '2020-01' })).toThrow();
});

it('accepts explicit dotted and Chinese year-month dates without inferring months from a year alone', () => {
  for (const dates of ['2024.01 - 2025.02', '2024 年 01 月 - 2025年2月']) {
    const text = `Software Engineer at Example Pty Ltd ${dates} Built SQL reports.`;
    const result = groundImportedRecords(
      importResultSchema.parse({
        records: [{ ...record, section: 'workExperiences', evidence: [{ page: 1, quote: text }] }],
        questions: [],
      }),
      [{ page: 1, text, route: 'text', method: 'pdf-text' }],
    );
    expect(result.records).toHaveLength(1);
  }
  const text = 'Software Engineer at Example Pty Ltd 2024 - 2025 Built SQL reports.';
  const result = groundImportedRecords(
    importResultSchema.parse({
      records: [{ ...record, section: 'workExperiences', evidence: [{ page: 1, quote: text }] }],
      questions: [],
    }),
    [{ page: 1, text, route: 'text', method: 'pdf-text' }],
  );
  expect(result.records).toHaveLength(0);
  expect(result.rejectedDetails[0].reasons.join(' ')).toContain('Start month');
});

it('retains anchored import records while omitting unsupported optional fields with exact diagnostics', () => {
  const text = 'Software Engineer at Example Pty Ltd Jan 2024 - Feb 2025 Built SQL reports.';
  const r = {
    ...record,
    section: 'workExperiences',
    location: 'Sydney',
    details: ['Built SQL reports.', 'Led five teams.'],
    technologies: ['SQL', 'Rust'],
    evidence: [{ page: 1, quote: text }],
  };
  const input = importResultSchema.parse({ records: [r], questions: [] });
  const pages = [{ page: 1, text, route: 'text' as const, method: 'pdf-text' as const }];
  expect(groundImportedRecords(input, pages).records).toHaveLength(0);
  const partial = groundImportedRecords(input, pages, { salvageOptional: true });
  expect(partial.records).toHaveLength(1);
  expect(partial.records[0].location).toBe('');
  expect(partial.records[0].details).toEqual(['Built SQL reports.']);
  expect(partial.records[0].technologies).toEqual(['SQL']);
  expect(partial.repairs[0].fields.map((f) => f.field)).toEqual([
    'location',
    'details[2]',
    'technologies[2]',
  ]);
  expect(input.records[0].location).toBe('Sydney');
  for (const patch of [
    { title: 'Chief Technology Officer' },
    { startMonth: '2020-01' },
    { evidence: [{ page: 2, quote: text }] },
  ]) {
    const rejected = groundImportedRecords(
      importResultSchema.parse({ records: [{ ...r, ...patch }], questions: [] }),
      pages,
      { salvageOptional: true },
    );
    expect(rejected.records).toHaveLength(0);
    expect(rejected.repairs).toHaveLength(0);
    expect(rejected.rejectedDetails).toHaveLength(1);
  }
});

it('uses canonical grouped records instead of duplicate legacy summaries or absence markers', () => {
  const p = {
    ...sampleProfile,
    education: 'Conflicting old education summary',
    experience: 'none yet',
    educations: [{ ...record, id: 'degree-only', title: 'Bachelor of IT' }],
    projects: [{ ...record, id: 'project-only', title: 'Atlas' }],
  };
  const facts = buildFacts(p);
  expect(facts.some((f) => ['education-1', 'experience-1'].includes(f.id))).toBe(false);
  expect(facts.filter((f) => f.recordId === 'project-only')).toHaveLength(2);
  expect(facts.find((f) => f.id === 'projects-project-only-detail-1')?.recordHeaderId).toBe(
    'projects-project-only',
  );
  expect(
    buildFacts({
      ...sampleProfile,
      education: 'none yet',
      experience: 'No formal work experience yet',
    }).some((f) => f.kind === 'education' || f.kind === 'experience'),
  ).toBe(false);
});
