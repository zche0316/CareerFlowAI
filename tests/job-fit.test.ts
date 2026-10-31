import { describe, expect, it } from 'vitest';
import { jobFitEvidence } from '../apps/api/src/job-fit.js';

const job = {
  title: 'Developer',
  company: 'Example',
  description: 'We use C++ and SQL.\nExperience with data analysis is helpful.',
  applicationUrl: 'https://example.com/job',
};

describe('job fit evidence', () => {
  it('pairs job excerpts with only approved evidence matching the whole term', () => {
    const result = jobFitEvidence(
      {
        job,
        requirements: { required: ['C++', 'sql', 'data analysis', 'docker'], inferred: true },
      },
      [
        { id: 'skill-1', kind: 'skill', text: 'C++' },
        { id: 'exp-1', kind: 'experience', text: 'I used SQL to check synthetic data.' },
        { id: 'int-1', kind: 'interest', text: 'data analysis' },
        { id: 'exp-2', kind: 'experience', text: 'PostgreSQL project' },
      ],
    );
    expect(result.interpretation).toBe('mentioned');
    expect(result.items.map((item) => item.term)).toEqual(['C++', 'sql', 'data analysis']);
    expect(result.items[0].evidence.map((f) => f.id)).toEqual(['skill-1']);
    expect(result.items[1].evidence.map((f) => f.id)).toEqual(['exp-1']);
    expect(result.items[2].evidence).toEqual([]);
    expect(job.description).toContain(result.items[0].excerpt);
  });
  it('does not invent requirements when no selected job or source match exists', () => {
    expect(() => jobFitEvidence(null, [])).toThrow('Select a job');
    expect(jobFitEvidence({ job, requirements: { required: ['docker'] } }, []).items).toEqual([]);
  });
});

it('retains source-backed finance requirements even in an older empty matching snapshot', () => {
  const finance = {
    ...job,
    title: 'Business Analyst',
    description:
      'Support Workday Financials. Coordinate user acceptance testing and reconciliations.',
  };
  const result = jobFitEvidence({ job: finance, requirements: { required: [] } }, [
    { id: 'course', kind: 'interest', text: 'I want to learn Workday.' },
  ]);
  expect(result.interpretation).toBe('mentioned');
  expect(result.items.map((i) => i.term)).toEqual([
    'workday',
    'reconciliations',
    'user acceptance testing',
  ]);
  expect(result.items.every((i) => finance.description.includes(i.excerpt))).toBe(true);
  expect(result.items.every((i) => i.evidence.length === 0)).toBe(true);
});
