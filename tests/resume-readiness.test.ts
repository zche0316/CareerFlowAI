import { expect, it } from 'vitest';
import { resumeLayout, resumeReadiness } from '../packages/contracts/src/resume-layout.js';

it('flags missing contact, incomplete dates and selected empty experiences without blocking export', () => {
  const resume = {
    name: 'Example candidate',
    jobTitle: 'Analyst',
    contact: { email: '', phone: '' },
    records: [
      {
        id: 'p1',
        section: 'projects',
        title: 'Empty project',
        startMonth: '2025-01',
        endMonth: '2025-03',
      },
      { id: 'p2', section: 'projects', title: 'Selected project', startMonth: '2025-01' },
      { id: 'p3', section: 'projects', title: 'Unselected project' },
    ],
    claims: [
      {
        factId: 'p1',
        kind: 'experience',
        text: 'Empty project',
        section: 'projects',
        recordId: 'p1',
      },
      {
        factId: 'p2',
        kind: 'experience',
        text: 'Selected project',
        section: 'projects',
        recordId: 'p2',
      },
      {
        factId: 'p2-detail',
        kind: 'experience',
        text: 'Built SQL reports.',
        section: 'projects',
        recordId: 'p2',
        recordHeaderId: 'p2',
      },
      { factId: 'skill', kind: 'skill', text: 'SQL' },
    ],
  };
  const issues = resumeReadiness(resume);
  expect(issues.map((x) => x.key)).toEqual([
    'email',
    'phone',
    'empty:projects:p1',
    'dates:projects:p2',
  ]);
  expect(issues.some((x) => x.text.includes('Unselected project'))).toBe(false);
  expect(
    resumeLayout(resume)
      .find((x) => x.title === 'Projects')
      ?.items.join(),
  ).not.toContain('Empty project');
});

it('does not demand an end date for an ongoing record or fabricate contact requirements', () => {
  const issues = resumeReadiness({
    name: 'Alex',
    jobTitle: 'Engineer',
    contact: { email: 'alex@example.test', phone: '0400000000' },
    records: [
      { id: 'p', section: 'projects', title: 'Ongoing', startMonth: '2025-01', current: true },
    ],
    claims: [
      { text: 'Python', kind: 'skill' },
      {
        text: 'Built a tool',
        kind: 'experience',
        section: 'projects',
        recordId: 'p',
        recordHeaderId: 'p',
      },
    ],
  });
  expect(issues).toEqual([]);
});
