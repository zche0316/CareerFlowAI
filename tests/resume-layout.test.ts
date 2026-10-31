import { expect, it } from 'vitest';
import { resumeLayout } from '../packages/contracts/src/resume-layout.js';
import { composeSelection } from '../apps/api/src/resume-composition.js';
it('selects at most three relevant courses without losing the major or qualification', () => {
  const courses = [
    'SQL Databases',
    'Data Analysis',
    'Business Statistics',
    'Data Visualisation',
    'Medieval History',
  ];
  const facts: any[] = [
    {
      id: 'educations-degree',
      kind: 'education',
      text: 'Bachelor of Commerce',
      recordId: 'degree',
      section: 'educations',
    },
    ...courses.map((course, i) => ({
      id: `educations-degree-coursework-${i + 1}`,
      kind: 'education',
      text: `Relevant coursework: ${course}`,
      recordId: 'degree',
      recordHeaderId: 'educations-degree',
      section: 'educations',
    })),
  ];
  const selection = composeSelection(
    facts.map((f) => ({ factId: f.id, reason: 'Relevant' })),
    facts,
    'SQL data analysis business statistics data visualisation',
  );
  const picked = selection.filter((c) => c.factId.includes('-coursework-'));
  expect(picked).toHaveLength(3);
  expect(picked.some((c) => c.factId.endsWith('-5'))).toBe(false);
  const sections = resumeLayout({
    name: 'Alex',
    jobTitle: 'Analyst',
    records: [
      {
        id: 'degree',
        section: 'educations',
        title: 'Bachelor of Commerce',
        major: 'Business Analytics',
        startMonth: '2024-02',
        current: true,
        expectedEndMonth: '2026-11',
      },
    ],
    claims: selection.map((c) => ({ ...facts.find((f) => f.id === c.factId), factId: c.factId })),
  });
  expect(JSON.stringify(sections)).toContain('Major: Business Analytics');
  expect(JSON.stringify(sections)).toContain('Expected completion: 2026-11');
  expect(JSON.stringify(sections)).not.toContain('Medieval History');
});
const facts: any[] = [
  {
    id: 'h',
    kind: 'experience',
    text: 'Engineer Example 2024-01',
    recordId: 'r',
    section: 'workExperiences',
  },
  {
    id: 'a',
    kind: 'experience',
    text: 'Personal actions: I wrote 20 tests for the test dataset only.',
    recordId: 'r',
    section: 'workExperiences',
    recordHeaderId: 'h',
  },
  {
    id: 'b',
    kind: 'experience',
    text: 'Tools: Python, SQL.',
    recordId: 'r',
    section: 'workExperiences',
    recordHeaderId: 'h',
  },
  {
    id: 'e',
    kind: 'education',
    text: 'Bachelor Example University',
    recordId: 'ed',
    section: 'educations',
  },
];
it('repairs header-only selection using actual contribution evidence and preserves education', () => {
  const selection = composeSelection(
    [
      { factId: 'h', reason: 'relevant' },
      { factId: 'b', reason: 'keywords' },
    ],
    facts,
    'Python tests',
  );
  expect(selection.map((x) => x.factId)).toEqual(['h', 'a', 'e']);
  expect(facts[1].text).toContain('I wrote 20 tests');
});
it('uses one structured, source-linked view with roles/dates and bullets, without audit IDs in document text', () => {
  const c: any = {
    name: 'Fictional QA',
    jobTitle: 'Engineer',
    summary: 'Seeking a graduate role.',
    records: [
      {
        id: 'r',
        section: 'workExperiences',
        title: 'Engineer',
        organisation: 'Example',
        startMonth: '2024-01',
        endMonth: '2024-03',
      },
      { id: 'ed', section: 'educations', title: 'Bachelor', organisation: 'Example University' },
    ],
    claims: facts.filter((x) => x.id !== 'b').map((x) => ({ ...x, factId: x.id })),
  };
  const sections = resumeLayout(c);
  expect(sections.map((x) => x.title)).toEqual([
    'Career Objective',
    'Work Experience',
    'Education',
  ]);
  const body = sections.flatMap((x) => x.items).join('\n');
  expect(body).toContain('2024-01 – 2024-03');
  expect(body).toContain('• Wrote 20 tests for the test dataset only.');
  expect(body).not.toContain('Evidence passport');
  expect(c.claims[1].text).toContain('Personal actions: I');
  c.claims = c.claims.filter((x: any) => x.factId !== 'a');
  expect(resumeLayout(c).find((x) => x.title === 'Work Experience')).toBeUndefined();
});
