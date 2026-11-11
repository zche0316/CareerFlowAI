import { expect, it } from 'vitest';
import {
  scoreJobMapping,
  validateJobMapping,
  type JobMapping,
} from '../packages/agents/src/job-mapping.js';
const job = {
  id: 'new-tool',
  title: 'Analyst',
  description:
    'Experience with QuantumLedger Q7 is essential. Familiarity with Helix UAT is preferred.',
  location: 'Sydney',
};
const facts: any[] = [
  { id: 'work-1', kind: 'experience', text: 'I used QuantumLedger Q7 to reconcile records.' },
];
const mapping: JobMapping = {
  experienceYears: null,
  experienceExcerpt: '',
  items: [
    {
      term: 'QuantumLedger Q7',
      category: 'skill',
      level: 'required',
      excerpt: 'Experience with QuantumLedger Q7 is essential.',
      status: 'evidenced',
      evidence: [{ factId: 'work-1', quote: 'I used QuantumLedger Q7' }],
      reason: 'Approved work evidence states the tool.',
    },
    {
      term: 'Helix UAT',
      category: 'skill',
      level: 'preferred',
      excerpt: 'Familiarity with Helix UAT is preferred.',
      status: 'not_evidenced',
      evidence: [],
      reason: 'No supporting approved fact.',
    },
  ],
};
it('maps previously unseen tools by citations, with optional gaps distinct from required gaps', () => {
  const result = scoreJobMapping(job, mapping, facts, { location: 'Sydney' });
  expect(result.matches).toEqual(['QuantumLedger Q7']);
  expect(result.preferredGaps).toEqual(['Helix UAT']);
  expect(result.gaps).toEqual([]);
  expect(result.components.experience).toBeNull();
  expect(result.coverage).toBe(70);
  expect(result.score).toBe(86);
  expect(result.explanation).not.toContain('0/0');
});
it('rejects invented source excerpts, foreign fact IDs and fabricated candidate quotations', () => {
  for (const change of [
    { excerpt: 'A certification is required.' },
    { evidence: [{ factId: 'foreign', quote: 'I used QuantumLedger Q7' }] },
    { evidence: [{ factId: 'work-1', quote: 'I led a large finance team.' }] },
  ])
    expect(() =>
      validateJobMapping({ ...mapping, items: [{ ...mapping.items[0], ...change }] }, job, facts),
    ).toThrow();
});
it('does not turn unknown categories into positive suitability or infer years from Senior', () => {
  expect(
    scoreJobMapping(job, { items: [], experienceYears: null, experienceExcerpt: '' }, facts, {
      location: 'Sydney',
    }).score,
  ).toBe(0);
  expect(() =>
    validateJobMapping(
      { ...mapping, experienceYears: 5, experienceExcerpt: 'Senior Analyst' },
      { ...job, description: 'Senior Analyst' },
      facts,
    ),
  ).toThrow();
});
it('rejects goals as qualification evidence and course facts as fully evidenced professional skills', () => {
  for (const kind of ['goal', 'education'])
    expect(() => validateJobMapping(mapping, job, [{ ...facts[0], kind }])).toThrow();
});

it('drops requirements it cannot quote instead of rejecting the whole mapping (CFS-117)', async () => {
  const { dropUnquoted } = await import('../packages/agents/src/job-mapping.js');
  const typographic = { ...mapping.items[0], excerpt: mapping.items[0].excerpt.replace(/'/g, '’') };
  const invented = {
    ...mapping.items[0],
    term: 'Invented',
    excerpt: 'A certification is required.',
  };
  const cleaned = dropUnquoted(
    {
      ...mapping,
      items: [typographic, invented],
      experienceYears: 5,
      experienceExcerpt: 'Five years',
    },
    job,
  );
  expect(cleaned.items.map((i: any) => i.term)).toEqual([mapping.items[0].term]);
  expect(cleaned).toMatchObject({ experienceYears: null, experienceExcerpt: '' });
  expect(() => validateJobMapping(cleaned, job, facts)).not.toThrow();
  // A quote shortened with an ellipsis still has to match piece by piece, in order.
  const words = job.description.split(' ');
  const shortened = {
    ...mapping.items[0],
    excerpt: `${words.slice(0, 2).join(' ')} … ${words.slice(-2).join(' ')}`,
  };
  expect(dropUnquoted({ ...mapping, items: [shortened] }, job).items).toHaveLength(1);
  const reversed = {
    ...mapping.items[0],
    excerpt: `${words.slice(-2).join(' ')} … ${words.slice(0, 2).join(' ')}`,
  };
  expect(dropUnquoted({ ...mapping, items: [reversed] }, job).items).toHaveLength(0);
});
