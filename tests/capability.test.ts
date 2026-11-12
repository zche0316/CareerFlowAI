import { expect, it } from 'vitest';
import {
  canonicalSkill,
  capabilityLevels,
  levelGaps,
  requiredLevel,
} from '../packages/contracts/src/capability.js';
import { demoProfile } from '../scripts/demo-profile.mjs';

const now = new Date('2026-11-12T00:00:00.000Z');
const level = (skills: ReturnType<typeof capabilityLevels>, name: string) =>
  skills.find((s) => s.skill === name);
const record = (over: any) => ({
  id: 'r' + Math.random().toString(36).slice(2, 8),
  title: 'Project',
  details: [],
  ...over,
});

it('assigns each level by its rule', () => {
  const skills = capabilityLevels(
    {
      skills: ['Excel', 'Rust'],
      educations: [record({ title: 'BSc', relevantCoursework: ['Statistics'] })],
      projects: [
        record({
          title: 'Churn model',
          technologies: ['Python'],
          experienceType: 'course',
          endMonth: '2026-06',
        }),
        record({
          title: 'Dashboard',
          technologies: ['Tableau'],
          details: ['The client used the dashboard in a trial.'],
          endMonth: '2026-06',
        }),
        record({ title: 'API', technologies: ['Go'], endMonth: '2026-01' }),
        record({ title: 'CLI', technologies: ['Go'], endMonth: '2026-02' }),
      ],
      workExperiences: [
        record({
          title: 'Analyst',
          experienceType: 'work',
          technologies: ['SQL'],
          startMonth: '2024-01',
          current: true,
        }),
      ],
    },
    [],
    [],
    now,
  );
  expect(level(skills, 'Rust')).toMatchObject({ level: 1, confidence: 'listed' });
  expect(level(skills, 'Statistics')).toMatchObject({ level: 1 });
  expect(level(skills, 'Python')).toMatchObject({ level: 2, confidence: 'described' });
  expect(level(skills, 'Tableau')?.level).toBe(3); // delivered outcome
  expect(level(skills, 'Go')?.level).toBe(3); // two projects
  expect(level(skills, 'SQL')?.level).toBe(4); // over a year in a role
});

it('uses verified sources for confidence and recognition, and lowers stale skills one level', () => {
  const skills = capabilityLevels(
    {
      skills: ['Python'],
      projects: [
        record({
          id: 'p1',
          title: 'Old app',
          technologies: ['Java', 'Java'],
          endMonth: '2021-01',
          details: ['Shipped to 200 users.'],
        }),
      ],
    },
    [
      {
        skill: 'python',
        source: 'github',
        verified: true,
        supports: 3,
        detail: '12 repositories',
        lastUsed: '2026-10',
      },
    ],
    ['p1'],
    now,
  );
  expect(level(skills, 'Python')).toMatchObject({
    level: 3,
    confidence: 'verified',
    lastUsed: '2026-10',
  });
  expect(level(skills, 'Java')).toMatchObject({
    rawLevel: 3,
    level: 2,
    stale: true,
    confidence: 'story',
  });
});

it('reads the level a role asks for and the gap to the profile', () => {
  expect(requiredLevel('required', '3+ years of SQL')).toBe(4);
  expect(requiredLevel('required', '2 years experience with Python')).toBe(3);
  expect(requiredLevel('required', 'Strong SQL skills')).toBe(3);
  expect(requiredLevel('preferred', 'Familiarity with dbt')).toBe(1);
  expect(requiredLevel('required', 'SQL')).toBe(2);
  expect(canonicalSkill('Postgres')).toBe('PostgreSQL');
  const skills = capabilityLevels(
    { skills: ['SQL'], projects: [record({ technologies: ['Python'] })] },
    [],
    [],
    now,
  );
  const gaps = levelGaps(
    [
      { term: 'Python', level: 'required', excerpt: 'Strong Python', category: 'skill' },
      { term: 'SQL', level: 'required', excerpt: '3+ years of SQL', category: 'skill' },
      { term: 'dbt', level: 'preferred', excerpt: 'Familiarity with dbt', category: 'skill' },
      {
        term: 'Bachelor degree',
        level: 'required',
        excerpt: 'Bachelor degree',
        category: 'education',
      },
    ],
    skills,
  );
  expect(gaps.map((g) => [g.skill, g.have, g.need])).toEqual([
    ['SQL', 1, 4],
    ['Python', 2, 3],
    ['dbt', 0, 1],
  ]);
});

it('gives the demo graduate believable levels', () => {
  const skills = capabilityLevels(demoProfile as any, [], [], now);
  expect(level(skills, 'SQL')?.level).toBeGreaterThanOrEqual(3);
  expect(level(skills, 'Power BI')?.level).toBeGreaterThanOrEqual(2);
  expect(skills.every((s) => s.level <= 4 && s.evidence.length > 0)).toBe(true);
});

it('counts level gaps only for skills a requirement names', () => {
  const skills = capabilityLevels({ skills: ['SQL'] }, [], [], now);
  const gaps = levelGaps(
    [
      { term: 'Teamwork', level: 'required', category: 'skill' },
      { term: 'Data analysis experience using R or Stata', level: 'preferred', category: 'skill' },
      {
        term: 'Strong SQL and Python',
        level: 'required',
        excerpt: 'Strong SQL and Python',
        category: 'skill',
      },
    ],
    skills,
  );
  expect(gaps.map((g) => [g.skill, g.have, g.need])).toEqual([
    ['Python', 0, 3],
    ['SQL', 1, 3],
    ['R', 0, 1],
  ]);
});
