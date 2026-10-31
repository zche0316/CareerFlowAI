import { describe, expect, it } from 'vitest';
import { nextMissionStep } from '../apps/web/src/workspace-home.js';

describe('opening a saved mission at the next user action', () => {
  it('opens job selection when matching results are ready', () => {
    expect(nextMissionStep({ status: 'AWAITING_JOB', data: { matches: [{}] } })).toBe(2);
  });
  it('opens resume review without bypassing approval', () => {
    expect(nextMissionStep({ status: 'AWAITING_APPROVAL', data: { resumeDraft: {} } })).toBe(3);
  });
  it('opens interview practice only after resume approval', () => {
    expect(
      nextMissionStep({ status: 'AWAITING_INTERVIEW', data: { approvedResumeId: 'saved' } }),
    ).toBe(4);
  });
  it('returns a completed mission to its feedback', () => {
    expect(
      nextMissionStep({ status: 'COMPLETE', data: { approvedResumeId: 'saved', feedback: {} } }),
    ).toBe(4);
  });
  it('keeps a failed resume draft at its recovery stage', () => {
    expect(nextMissionStep({ status: 'FAILED', data: { resumeDraft: {} } })).toBe(3);
  });
  it('shows job results for an empty search so users can adjust criteria', () => {
    expect(nextMissionStep({ status: 'NO_MATCHES', data: {} })).toBe(2);
  });
  it('keeps a selected job at resume preparation while the agent is still working', () => {
    expect(
      nextMissionStep({
        status: 'RUNNING',
        data: { selectedJob: { job: { id: 'target' } }, matches: [{}] },
      }),
    ).toBe(3);
  });
  it('keeps a new queued search at career analysis until results exist', () => {
    expect(nextMissionStep({ status: 'QUEUED', data: {} })).toBe(1);
  });
});
