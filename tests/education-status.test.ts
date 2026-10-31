import { expect, it } from 'vitest';
import { ongoingSupported, groundImportedRecords } from '../packages/agents/src/import-model.js';
import { recordSchema } from '../packages/contracts/src/profile-records.js';

it.each([
  "I'm studying",
  "I'm still studying",
  'I am still studying',
  'Currently enrolled',
  '我正在攻读',
  '在读',
])('recognises explicit ongoing study: %s', (text) => {
  expect(ongoingSupported(text)).toBe(true);
});

it('does not infer ongoing study from a negated statement', () => {
  expect(ongoingSupported("I'm not studying anymore")).toBe(false);
});

it('supports a start month and expected completion while studying and checks date evidence', () => {
  const text =
    "I'm studying Bachelor of Commerce. I started in February 2024 and expect to graduate in November 2026.";
  const record = {
    section: 'educations' as const,
    title: 'Bachelor of Commerce',
    organisation: '',
    location: '',
    startMonth: '2024-02',
    endMonth: null,
    expectedEndMonth: '2026-11',
    current: true,
    details: [],
    technologies: [],
    url: '',
    evidence: [{ page: 1, quote: text }],
  };
  const pages = [{ page: 1, text, route: 'text' as const, method: 'plain-text' as const }];
  expect(groundImportedRecords({ records: [record], questions: [] }, pages).records).toHaveLength(
    1,
  );
  expect(
    groundImportedRecords(
      { records: [{ ...record, expectedEndMonth: '2027-11' }], questions: [] },
      pages,
    ).records,
  ).toHaveLength(0);
  expect(recordSchema.parse({ ...record, id: 'degree', evidence: [] }).startMonth).toBe('2024-02');
});
