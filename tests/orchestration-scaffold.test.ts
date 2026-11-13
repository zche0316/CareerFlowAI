import { describe, expect, it } from 'vitest';
import { fanOutTailoring } from '../packages/agents/src/scout/fan-out.js';
import {
  appendHandoffs,
  handoff,
  MAX_HANDOFFS,
} from '../packages/agents/src/orchestration/handoff.js';

describe('orchestration scaffolding', () => {
  it('fans out one tailoring branch per shortlisted job, bounded', () => {
    const sends = fanOutTailoring('s1', ['a', 'b', 'c', 'd']);
    expect(sends).toHaveLength(3);
    expect(sends[0]).toMatchObject({ node: 'tailor_job', args: { sweepId: 's1', jobId: 'a' } });
  });

  it('keeps a bounded handoff history', () => {
    const many = Array.from({ length: MAX_HANDOFFS + 5 }, (_, i) => handoff('a', 'b', String(i)));
    expect(appendHandoffs([], many)).toHaveLength(MAX_HANDOFFS);
  });
});
