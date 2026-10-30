import { expect, it } from 'vitest';
import {
  compare,
  extractRequirements,
  experienceRequirement,
  educationMeets,
  locationMatches,
} from '../packages/matching/domain.js';
const profile = {
  skills: ['Python'],
  experienceYears: 0,
  education: 'Bachelor of IT',
  location: 'Sydney',
  employmentType: 'Full-time',
  goals: 'data analyst',
};
const job = {
  id: 'quality',
  title: 'Analyst',
  company: 'Fictional QA',
  location: 'Sydney, NSW, Australia',
  employmentType: 'Full-time',
  description: 'Required skills: Python.',
  source: { liveVacancy: false },
};
it('does not reward an unknown experience requirement as full satisfaction', () => {
  const unknown = compare(profile, job, []);
  const explicitZero = compare(
    profile,
    { ...job, description: job.description + ' Minimum 0 years experience.' },
    [],
  );
  expect(unknown.requirements.experienceYears).toBeNull();
  expect(unknown.components.experience).toBe(0.5);
  expect(unknown.limitations.join(' ')).toContain('Experience requirement unknown');
  expect(unknown.explanation).toContain('unknown');
  expect(unknown.gaps.join(' ')).not.toContain('additional years');
  expect(explicitZero.components.experience).toBe(1);
  expect(explicitZero.score).toBeGreaterThan(unknown.score);
});
it('extracts explicit experience ranges and plus-years without using unrelated numbers', () => {
  expect(experienceRequirement('2–4 years of relevant experience')).toBe(2);
  expect(experienceRequirement('3+ years commercial experience')).toBe(3);
  expect(experienceRequirement('Established 20 years ago; 4 offices')).toBeNull();
  const r = compare(
    profile,
    { ...job, description: 'Required skills: Python. Minimum 3 years experience.' },
    [],
  );
  expect(r.gaps).toContain('3 additional years of experience');
});
it('compares known qualification levels without treating unrelated text as a degree', () => {
  expect(educationMeets('Master of IT', 'Bachelor degree')).toBe(true);
  expect(educationMeets('Bachelor of IT', 'Master degree')).toBe(false);
  expect(educationMeets('Worked on a master data project', 'Bachelor degree')).toBe(false);
  expect(
    extractRequirements({ ...job, description: 'A bachelor’s degree is required.' }).qualification,
  ).toContain('bachelor');
});
it('matches Australian city/state aliases without equating all cities or unqualified remote regions', () => {
  expect(locationMatches('Sydney', 'Sydney, NSW, Australia')).toBe(true);
  expect(locationMatches('NSW', 'Sydney')).toBe(true);
  expect(locationMatches('Australia', 'Melbourne')).toBe(true);
  expect(locationMatches('Australia', 'Seattle, WA, USA')).toBe(false);
  expect(locationMatches('Sydney', 'Melbourne')).toBe(false);
  expect(locationMatches('Sydney', 'Remote - US only')).toBe(false);
});

it('keeps narrative stack mentions and negated or alternative skills out of mandatory gaps', () => {
  const result = compare(
    profile,
    {
      ...job,
      source: { liveVacancy: true },
      description:
        'Our stack uses Python, Docker and AWS. SQL is not required. Python or React required.',
    },
    [],
  );
  expect(result.requirements.required).toEqual([]);
  expect(result.requirements.preferred).toEqual([]);
  expect(result.requirements.mentioned).toEqual(
    expect.arrayContaining(['python', 'docker', 'aws', 'sql', 'react']),
  );
  expect(result.gaps).not.toContain('docker');
  expect(result.components.skill).toBe(0.5);
  expect(result.requirements.confidence).toBe('low');
});

it('extracts multi-line sections, aliases and preferred clauses with source excerpts', () => {
  const r = extractRequirements({
    ...job,
    description:
      'Requirements:\n• Python\n• PostgreSQL\nPreferred skills: AWS\nDocker\nResponsibilities:\nBuild React dashboards.',
  });
  expect(r.required).toEqual(['python', 'sql']);
  expect(r.preferred).toEqual(['aws', 'docker']);
  expect(r.mentioned).toContain('react');
  expect(
    r.skillEvidence.some((e: any) => e.text.includes('PostgreSQL') && e.kind === 'required'),
  ).toBe(true);
});

it('scores preferred evidence separately without turning optional gaps into required gaps', () => {
  const vacancy = {
    ...job,
    description: 'Required skills: Python. Preferred skills: Docker. Minimum 0 years experience.',
  };
  const without = compare(profile, vacancy, []);
  const withPreferred = compare({ ...profile, skills: ['Python', 'Docker'] }, vacancy, []);
  expect(without.components.skill).toBe(1);
  expect(without.components.preferred).toBe(0);
  expect(withPreferred.components.preferred).toBe(1);
  expect(without.preferredGaps).toEqual(['docker']);
  expect(without.gaps).not.toContain('docker');
  expect(withPreferred.score).toBeGreaterThan(without.score);
  expect(withPreferred.scoringVersion).toBe('matching-v2');
  const weights = withPreferred.scoringWeights as Record<string, number>;
  expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(withPreferred.score).toBe(
    Math.round(
      100 *
        Object.entries(weights).reduce(
          (sum, [key, weight]) =>
            sum + weight * (withPreferred.components as Record<string, number>)[key],
          0,
        ),
    ),
  );
});

it('does not double count a skill stated in both required and preferred sections', () => {
  const r = extractRequirements({
    ...job,
    description: 'Required skills: Python. Preferred skills: Python, SQL.',
  });
  expect(r.required).toEqual(['python']);
  expect(r.preferred).toEqual(['sql']);
});

it('distinguishes unknown experience, explicit no-experience and preferred experience', () => {
  expect(experienceRequirement('No prior experience required.')).toBe(0);
  expect(experienceRequirement('5 years experience preferred.')).toBeNull();
  expect(experienceRequirement('Minimum 2 years experience. 5 years experience preferred.')).toBe(
    2,
  );
  expect(experienceRequirement('Minimum 2 years experience. At least 3 years experience.')).toBe(3);
  expect(experienceRequirement('3 years experience is not required.')).toBeNull();
});

it('does not infer subject equivalence or combine unrelated degrees', async () => {
  const { educationAssessment } = await import('../packages/matching/domain.js');
  expect(educationAssessment('Master of Arts', 'Bachelor degree in computer science').status).toBe(
    'unknown',
  );
  expect(
    educationAssessment(
      'Master of Arts\nDiploma in Computer Science',
      'Bachelor degree in computer science',
    ).status,
  ).toBe('unknown');
  expect(
    educationAssessment('Master of Computer Science', 'Bachelor degree in computer science').status,
  ).toBe('met');
  expect(educationAssessment('Bachelor of IT', 'Master degree').status).toBe('not_met');
  expect(educationAssessment('Studying Master of IT', 'Master degree').status).toBe('unknown');
  expect(
    educationAssessment('Bachelor of IT', 'Master degree or equivalent experience').status,
  ).toBe('unknown');
  expect(educationAssessment('Bachelor of IT', 'Bachelor degree in astrophysics').status).toBe(
    'unknown',
  );
  expect(educationAssessment('', 'Bachelor degree').status).toBe('unknown');
});

it('does not treat a preferred degree as a mandatory qualification', () => {
  expect(
    extractRequirements({
      ...job,
      description: 'Master degree preferred. Required skills: Python.',
    }).qualification,
  ).toBe('unspecified');
});

it('resolves geographic scope and keeps ambiguous remote and state codes unknown', async () => {
  const { locationAssessment } = await import('../packages/matching/domain.js');
  const status = (a: string, b: string) => locationAssessment(a, b).status;
  expect(status('Sydney', 'Remote')).toBe('unknown');
  expect(status('Sydney', 'Remote worldwide')).toBe('met');
  expect(status('Sydney', 'Remote - Australia')).toBe('met');
  expect(status('Sydney', 'Remote - USA only')).toBe('not_met');
  expect(status('Sydney', 'Remote - Melbourne only')).toBe('not_met');
  expect(status('Sydney', 'NSW, Australia')).toBe('unknown');
  expect(status('WA', 'Perth')).toBe('unknown');
  expect(status('Western Australia', 'Perth, Australia')).toBe('met');
  expect(status('Sydney, Australia', 'Sydney, Canada')).toBe('not_met');
  expect(status('Australia', 'Sydney, Australia')).toBe('met');
  expect(status('NSW', 'Newcastle, Australia')).toBe('met');
  expect(status('Sydney', '')).toBe('unknown');
});

it('exposes unknown assessments without calling them unmet qualifications or locations', () => {
  const r = compare(
    { ...profile, education: '' },
    {
      ...job,
      location: 'Remote',
      description: 'Required skills: Python. Qualification: Bachelor degree.',
    },
    [],
  );
  expect(r.assessment.education.status).toBe('unknown');
  expect(r.assessment.location.status).toBe('unknown');
  expect(r.components.education).toBe(0.5);
  expect(r.gaps.join(' ')).not.toMatch(/Qualification evidence|Location preference mismatch/);
});

it('ends inline requirement scope at sentence boundaries instead of absorbing narrative skills', () => {
  const r = extractRequirements({
    ...job,
    description: 'Required skills: Python. We use SQL and Docker. AWS preferred.',
  });
  expect(r.required).toEqual(['python']);
  expect(r.preferred).toEqual(['aws']);
  expect(r.mentioned).toEqual(expect.arrayContaining(['sql', 'docker']));
});
