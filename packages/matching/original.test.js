import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compare,
  extractRequirements,
  validateProfile,
  vectorSimilarity,
  CareerDataService,
  JobRepository,
  AgentOrchestrator,
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
        (0.45 * c.skill +
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
test('orchestrator failure, retry, ranking, empty and verified handoff', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'careerflow-test-'));
  try {
    const data = new CareerDataService(dir),
      repo = new JobRepository(new URL('./jobs.json', import.meta.url)),
      o = new AgentOrchestrator(data, repo);
    await assert.rejects(o.match('missing', { minScore: 40 }), /Profile unavailable/);
    await data.saveProfile(profile);
    await assert.rejects(
      o.match(profile.id, { minScore: 40, simulateFailure: true }),
      /Job Source unavailable/,
    );
    const r = await o.match(profile.id, { minScore: 0 });
    assert.equal(r.ranked.length, 8);
    assert.ok(r.ranked.every((x, i) => !i || r.ranked[i - 1].score >= x.score));
    await assert.rejects(o.select(r.id, 'forged'), /current ranked/);
    const target = await o.select(r.id, r.ranked[0].job.id);
    assert.equal(target.job.id, r.ranked[0].job.id);
    assert.equal(target.trace.at(-1), 'Completed');
    assert.deepEqual(target.handoffTo, ['Resume Tailoring Agent', 'Interview Coach Agent']);
    assert.ok(
      JSON.parse(await fs.readFile(path.join(dir, profile.id + '-target.json'))).careerProfile
        .approved,
    );
    await data.saveProfile({ ...profile, goals: 'Changed goal' });
    await assert.rejects(o.select(r.id, r.ranked[0].job.id), /Profile changed/);
    const empty = await o.match(profile.id, { minScore: 100 });
    assert.equal(empty.ranked.length, 0);
    assert.equal(empty.trace.at(-1), 'No Suitable Jobs');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('O2 compares 2–4 distinct ranked jobs, preserves missing values and rejects stale profiles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'careerflow-o2-'));
  try {
    const data = new CareerDataService(dir),
      o = new AgentOrchestrator(data, new JobRepository(new URL('./jobs.json', import.meta.url)));
    await data.saveProfile(profile);
    const run = await o.match(profile.id, { minScore: 0 });
    const c = await o.compareSelected(run.id, ['j1', 'j8']);
    assert.equal(c.rows[0].salary.currency, 'AUD');
    assert.equal(c.rows[1].salary, null);
    assert.equal(c.rows[1].growth, null);
    assert.equal(c.rows[0].source.type, 'disclosed-fixture');
    for (const ids of [['j1'], ['j1', 'j1'], ['j1', 'forged']])
      await assert.rejects(o.compareSelected(run.id, ids));
    await data.saveProfile({ ...profile, goals: 'changed' });
    await assert.rejects(o.compareSelected(run.id, ['j1', 'j2']), /Profile changed/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
