import { expect, it } from 'vitest';
import { experienceOverview } from '../packages/contracts/src/experience-view.js';
it('shows the complete role overview separately from later STAR details', () => {
  const overview = 'I supported reporting. I used SQL; I did not manage the team.';
  expect(
    experienceOverview({
      overview,
      details: [overview, 'Warehouses used different labels.'],
      starStory: { situation: 'Warehouses used different labels.' },
    }),
  ).toBe(overview);
});
it('provides an extractive fallback for old records without cutting a semicolon qualification', () => {
  const details = [
    'I handled reporting.',
    'I used SQL.',
    'We reviewed 2,000 orders.',
    'I supported analysis;',
    'I did not manage the team.',
    'Additional background.',
  ];
  const result = experienceOverview({ details });
  expect(result).toContain('I supported analysis; I did not manage the team.');
  expect(result).not.toContain('Additional background.');
  expect(details).toHaveLength(6);
});
