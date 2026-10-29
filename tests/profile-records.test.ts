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
  expect(f.filter((x) => x.kind === 'experience')).toHaveLength(3);
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
