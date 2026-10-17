import { describe, it, expect } from 'vitest';
import { profileSchema, sampleProfile } from '../packages/contracts/src/index.js';
import { buildFacts, validateResumeClaims } from '../apps/api/src/domain.js';
import { generate } from '../packages/agents/src/provider.js';
import { coachSchema } from '../packages/contracts/src/index.js';
describe('Candidate evidence rules', () => {
  it('allows interests without claimed skills and explicit no experience', () => {
    expect(
      profileSchema.parse({ ...sampleProfile, skills: [], experience: 'none yet' }).skills,
    ).toEqual([]);
  });
  it('rejects missing goal, reversed dates and invalid salary ranges', () => {
    for (const input of [
      { ...sampleProfile, goals: '' },
      { ...sampleProfile, startDate: '2026-01-01', endDate: '2025-12-31' },
      { ...sampleProfile, salaryMin: 100, salaryMax: 50, currency: 'AUD' },
      { ...sampleProfile, salaryMin: 100, currency: '' },
    ])
      expect(() => profileSchema.parse(input)).toThrow();
  });
  it('never renders invented candidate claims or duplicate evidence', () => {
    const facts = buildFacts(sampleProfile);
    expect(() =>
      validateResumeClaims([{ factId: 'invented-aws-cert', reason: 'nice fit' }], facts),
    ).toThrow(/unsupported/);
    expect(() =>
      validateResumeClaims(
        [
          { factId: facts[0].id, reason: 'fit' },
          { factId: facts[0].id, reason: 'fit' },
        ],
        facts,
      ),
    ).toThrow(/duplicate/);
    const [claim] = validateResumeClaims([{ factId: facts[0].id, reason: 'fit' }], facts);
    expect(claim.text).toBe(facts[0].text);
  });
  it('fixture mode is deterministic and never invokes a live model', async () => {
    let calls = 0;
    const hooks = {
      onCall: async () => {
        calls++;
      },
      onTool: async () => {},
      onUsage: async () => {},
    };
    const result = await generate(
      'coach',
      { goal: sampleProfile.goals, facts: buildFacts(sampleProfile) },
      coachSchema,
      'fixture',
      hooks,
    );
    expect(calls).toBe(0);
    expect(result.strengths[0].evidenceIds).toEqual(['skill-1']);
  });
});
