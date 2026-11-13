import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  compare,
  extractRequirements,
  validateProfile,
  vectorSimilarity,
} from './domain.js';

const jobs = JSON.parse(await fs.readFile(new URL('./jobs.json', import.meta.url)));

const profile = JSON.parse(await fs.readFile(new URL('./profile.json', import.meta.url)));
test('approved profiles only; aliases normalised', () => {
  assert.throws(() => validateProfile({ ...profile, approved: false }));
  assert.throws(() => validateProfile({ ...profile, experienceYears: -1 }));
  assert.throws(() => validateProfile({ ...profile, id: '../escape' }));
  assert.deepEqual(validateProfile({ ...profile, skills: ['PostgreSQL', 'SQL'] }).skills, ['sql']);
});
test('requirement extraction distinguishes required, preferred and missing evidence', () => {
  const r = extractRequirements(jobs[0]);
  assert.deepEqual(r.required, ['python', 'sql', 'data analysis']);
  assert.deepEqual(r.preferred, ['power bi']);
  assert.equal(r.experienceYears, 1);
  assert.equal(extractRequirements(jobs[7]).confidence, 'low');
});
test('identical vectors = 1; unrelated = 0', () => {
  assert.ok(Math.abs(vectorSimilarity('python sql', 'python sql', ['python sql']) - 1) < 1e-10);
  assert.equal(vectorSimilarity('python', 'nursing', ['python', 'nursing']), 0);
});
test('score bounded and independently reproducible; missing evidence exposed', () => {
  const r = compare(
    validateProfile(profile),
    jobs[0],
    jobs.map((j) => j.description),
  );
  const c = r.components;
  assert.equal(
    r.score,
    Math.round(
      100 *
        (0.4 * c.skill +
          0.05 * c.preferred +
          0.15 * c.experience +
          0.1 * c.education +
          0.15 * c.preference +
          0.15 * c.semantic),
    ),
  );
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.gaps.includes('data analysis'));
  assert.ok(r.matches.includes('python'));
  assert.ok(compare(validateProfile(profile), jobs[3], []).gaps.some((g) => g.includes('years')));
});
