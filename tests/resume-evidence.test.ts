import { describe, expect, it } from 'vitest';
import { filterResumeEvidence } from '../packages/agents/src/resume-evidence.js';

describe('resume evidence selection', () => {
  it('retains only approved eligible IDs and counts unsupported suggestions', () => {
    const selected = [
      { factId: 'approved-1', reason: 'Relevant' },
      { factId: 'unknown', reason: 'Invented' },
      { factId: 'ineligible', reason: 'Not allowed' },
    ];
    expect(filterResumeEvidence(selected, new Set(['approved-1']))).toEqual({
      accepted: [selected[0]],
      rejectedCount: 2,
    });
  });
  it('returns no accepted facts if all selected IDs are unsupported', () => {
    expect(filterResumeEvidence([{ factId: 'other-user' }], new Set(['owned']))).toEqual({
      accepted: [],
      rejectedCount: 1,
    });
  });
});
