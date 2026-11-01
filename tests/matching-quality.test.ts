import { expect, it } from 'vitest';
import { compare, extractRequirements, experienceRequirement, educationMeets, locationMatches } from '../packages/matching/domain.js';
const profile = { skills: ['Python'], experienceYears: 0, education: "Bachelor of IT", location: 'Sydney', employmentType: 'Full-time', goals: 'data analyst' };
const job = { id: 'quality', title: 'Analyst', company: 'Fictional QA', location: 'Sydney, NSW, Australia', employmentType: 'Full-time', description: 'Required skills: Python.', source: { liveVacancy: false } };
it('does not reward an unknown experience requirement as full satisfaction', () => {
  const unknown = compare(profile, job, []);
  const explicitZero = compare(profile, { ...job, description: job.description + ' Minimum 0 years experience.' }, []);
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
  const r = compare(profile, { ...job, description: 'Required skills: Python. Minimum 3 years experience.' }, []);
  expect(r.gaps).toContain('3 additional years of experience');
});
it('compares known qualification levels without treating unrelated text as a degree', () => {
  expect(educationMeets('Master of IT', 'Bachelor degree')).toBe(true);
  expect(educationMeets('Bachelor of IT', 'Master degree')).toBe(false);
  expect(educationMeets('Worked on a master data project', 'Bachelor degree')).toBe(false);
  expect(extractRequirements({ ...job, description: "A bachelor’s degree is required." }).qualification).toContain('bachelor');
});
it('matches Australian city/state aliases without equating all cities or unqualified remote regions', () => {
  expect(locationMatches('Sydney', 'Sydney, NSW, Australia')).toBe(true);
  expect(locationMatches('NSW', 'Sydney')).toBe(true);
  expect(locationMatches('Australia', 'Melbourne')).toBe(true);
  expect(locationMatches('Australia', 'Seattle, WA, USA')).toBe(false);
  expect(locationMatches('Sydney', 'Melbourne')).toBe(false);
  expect(locationMatches('Sydney', 'Remote - US only')).toBe(false);
});
