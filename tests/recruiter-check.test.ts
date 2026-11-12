import { expect, it } from 'vitest';
import { keywordCoverage, knockouts } from '../apps/api/src/recruiter-check.js';

const content = {
  name: 'Jordan Ellis',
  jobTitle: 'Data Analyst',
  claims: [
    { kind: 'experience', text: 'Wrote Postgres queries for a weekly delivery report.' },
    { kind: 'skill', text: 'Tableau' },
    { kind: 'experience', text: 'Built dashboards in Power BI for depot managers.' },
  ],
};

it('finds required terms literally or by synonym and says where they sit', () => {
  const { rows, swaps } = keywordCoverage(
    [
      { term: 'PostgreSQL', level: 'required', category: 'skill' },
      { term: 'Power BI', level: 'required', category: 'skill' },
      { term: 'Tableau', level: 'preferred', category: 'skill' },
      { term: 'Snowflake', level: 'required', category: 'skill' },
      { term: 'Bachelor degree', level: 'required', category: 'education' },
    ],
    content,
  );
  expect(rows.map((r) => [r.term, r.exact, r.synonym, r.where])).toEqual([
    ['PostgreSQL', false, true, 'experience'],
    ['Power BI', true, false, 'experience'],
    ['Tableau', true, false, 'skills only'],
    ['Snowflake', false, false, 'missing'],
  ]);
  // The exact term is suggested only where an approved line already names the skill.
  expect(swaps).toEqual([
    { term: 'PostgreSQL', line: 'Wrote Postgres queries for a weekly delivery report.' },
  ]);
});

it('reads knock-out conditions from the listing and the profile', () => {
  const match = {
    job: {
      title: 'Analyst',
      location: 'Sydney NSW',
      description:
        'You must be an Australian citizen or permanent resident to apply. Based in our Sydney office.',
    },
    mapping: {
      experienceYears: 2,
      experienceExcerpt: '2+ years in analytics',
      items: [
        {
          term: 'Degree',
          category: 'education',
          level: 'required',
          excerpt: 'Bachelor degree in a quantitative field',
        },
      ],
    },
  };
  const profile = {
    location: 'Melbourne',
    experienceYears: 0,
    educations: [{ id: 'e1' }],
    contact: { workRights: 'Australian citizen' },
  };
  const result = Object.fromEntries(knockouts(match, profile).map((k) => [k.kind, k.status]));
  expect(result).toEqual({
    'Work rights': 'met',
    Location: 'check',
    'Years of experience': 'not_met',
    Degree: 'met',
  });
  expect(
    knockouts(match, { ...profile, contact: {} }).find((k) => k.kind === 'Work rights')!.status,
  ).toBe('unknown');
});

it('reads live-style requirement phrases for the skills they name (CFS-117 follow-up)', () => {
  const { rows } = keywordCoverage(
    [
      { term: 'Data analysis experience using R or Stata', level: 'preferred', category: 'skill' },
      { term: 'Statistical analysis of messy data', level: 'required', category: 'skill' },
      { term: 'Creative problem-solving', level: 'required', category: 'skill' },
    ],
    {
      ...content,
      claims: [
        ...content.claims,
        { kind: 'experience', text: 'Ran a statistical analysis of messy train delay data in R.' },
      ],
    },
  );
  expect(rows.map((r) => [r.kind, r.where])).toEqual([
    ['skill', 'experience'],
    ['skill', 'experience'],
    ['phrase', 'missing'],
  ]);
});
