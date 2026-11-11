import { expect, it } from 'vitest';
import { profileSchema } from '../packages/contracts/src/index.js';
import { memorySchema } from '../packages/contracts/src/career-evidence.js';
import { demoMemories, demoProfile } from '../scripts/demo-profile.mjs';

it('the demo profile is a valid, clearly fictional graduate profile', () => {
  const profile = profileSchema.parse(demoProfile);
  expect(profile.careerStage).toBe('graduate');
  const records = [
    ...(profile.educations || []),
    ...(profile.workExperiences || []),
    ...(profile.projects || []),
  ];
  expect(records.length).toBeGreaterThanOrEqual(7);
  // Every named organisation is labelled fictional so the demo never implies a real employer.
  for (const r of records.filter((r) => r.organisation))
    expect(r.organisation, r.id).toMatch(/\(fictional\)$/);
  expect(profile.contact?.workRights).toMatch(/fictional/);
});

it('the demo memories are valid and point at profile records', () => {
  const ids = new Set(
    [...demoProfile.workExperiences, ...demoProfile.projects].map((r: any) => r.id),
  );
  for (const memory of demoMemories) {
    const parsed = memorySchema.parse(memory);
    if (parsed.recordId) expect(ids.has(parsed.recordId)).toBe(true);
  }
});
