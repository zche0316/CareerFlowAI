import { describe, expect, it } from 'vitest';
import {
  negotiationDecisionSchema,
  negotiationInputSchema,
  negotiationOutputSchema,
} from '../packages/contracts/src/index.js';
import { generate } from '../packages/agents/src/provider.js';

describe('Salary negotiation practice contracts', () => {
  it('validates practice offer, target, currency and candidate response', () => {
    expect(
      negotiationInputSchema.parse({
        offerSalary: 65000,
        targetSalary: 72000,
        currency: 'aud',
        candidateMessage: 'I would like to discuss the salary range for this role.',
      }),
    ).toEqual({
      offerSalary: 65000,
      targetSalary: 72000,
      currency: 'AUD',
      candidateMessage: 'I would like to discuss the salary range for this role.',
    });
    expect(() =>
      negotiationInputSchema.parse({
        offerSalary: 0,
        targetSalary: 72000,
        currency: 'AUD',
        candidateMessage: 'I would like to discuss the salary range for this role.',
      }),
    ).toThrow();
    expect(() =>
      negotiationInputSchema.parse({
        offerSalary: 65000,
        targetSalary: 72000,
        currency: 'AU',
        candidateMessage: 'I would like to discuss the salary range for this role.',
      }),
    ).toThrow();
  });

  it('accepts only user-owned final practice decisions', () => {
    expect(negotiationDecisionSchema.parse({ decision: 'accept' })).toEqual({
      decision: 'accept',
    });
    expect(negotiationDecisionSchema.parse({ decision: 'decline' })).toEqual({
      decision: 'decline',
    });
    expect(() => negotiationDecisionSchema.parse({ decision: 'auto_accept' })).toThrow();
  });

  it('returns deterministic recruiter feedback without making the decision for the user', async () => {
    const result = await generate(
      'negotiation',
      {
        goal: 'Prepare for an analyst role.',
        facts: [],
        job: { title: 'Junior Data Analyst', description: 'Use SQL for reporting.' },
        offerSalary: 65000,
        targetSalary: 72000,
        currency: 'AUD',
        candidateMessage: 'I would like to discuss the salary range for this role.',
      },
      negotiationOutputSchema,
      'fixture',
      {
        onCall: async () => {
          throw Error('Fixture mode must not reserve a live model call.');
        },
        onTool: async () => {},
        onUsage: async () => {},
      },
    );
    expect(result.recruiterReply).toContain('Junior Data Analyst');
    expect(result.feedback.strengths.length).toBeGreaterThan(0);
    expect(result.feedback.improvements.length).toBeGreaterThan(0);
    expect(result.feedback.nextSteps.join(' ')).toMatch(/decide for yourself/i);
  });
});
