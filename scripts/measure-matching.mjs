import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { compare } from '../packages/matching/domain.js';
const jobs = JSON.parse(await readFile(new URL('../packages/matching/jobs.json', import.meta.url)));
const profile = JSON.parse(
  await readFile(new URL('../packages/matching/profile.json', import.meta.url)),
);
const algorithm = await readFile(new URL('../packages/matching/domain.js', import.meta.url));
const results = [];
for (const size of [8, 80]) {
  const input = Array.from({ length: size }, (_, i) => ({
    ...jobs[i % jobs.length],
    id: `synthetic-${i}`,
  }));
  const corpus = input.map((j) => j.title + ' ' + j.description);
  const run = () => input.map((j) => compare(profile, j, corpus)).sort((a, b) => b.score - a.score);
  for (let i = 0; i < 5; i++) run();
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  results.push({
    jobs: size,
    repetitions: 30,
    warmups: 5,
    medianMs: samples[14],
    p95Ms: samples[28],
    maxMs: samples[29],
  });
}
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      algorithmSha256: createHash('sha256').update(algorithm).digest('hex'),
      fixture: true,
      scope:
        'Warm in-process matching only; excludes network, database, LLM, exports and concurrent users. Repeated fictional jobs are not a representative relevance dataset. No before/after speedup is claimed.',
      results,
    },
    null,
    2,
  ),
);
