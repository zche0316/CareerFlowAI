import { describe, expect, it } from 'vitest';
import { nextTeam } from '../packages/agents/src/orchestration/supervisor.js';
import { freshJobs, jobFingerprint, type ScoutJob } from '../packages/agents/src/scout/scout.js';
import { fanOutTailoring } from '../packages/agents/src/scout/fan-out.js';
import {
  appendHandoffs,
  handoff,
  MAX_HANDOFFS,
} from '../packages/agents/src/orchestration/handoff.js';

const job = (id: string, title: string, company = 'Acme'): ScoutJob => ({
  id,
  title,
  company,
  location: 'Sydney NSW',
  description: title,
});

describe('orchestration scaffolding', () => {
  it('supervisor routes weakly supported jobs to the coach before tailoring', () => {
    const base = {
      hasAnalysis: true,
      matches: 4,
      selectedJob: true,
      approvedResume: false,
      interviewComplete: false,
    };
    expect(nextTeam(base).team).toBe('resume_team');
    expect(nextTeam({ ...base, weakCoverage: true }).team).toBe('career_coach');
    expect(nextTeam({ ...base, matches: null, scoutShortlist: 2 }).team).toBe('select_job');
  });

  it('scout drops jobs seen before and duplicates across boards', () => {
    const seen = new Set([jobFingerprint(job('old', 'Data Analyst'))]);
    const sorted = freshJobs(
      [job('g1', 'Data Analyst'), job('g2', 'Graduate Engineer'), job('a9', 'Graduate  Engineer')],
      seen,
    );
    expect(sorted.fresh.map((j) => j.id)).toEqual(['g2']);
    expect(sorted.seenAgain).toEqual([...seen]);
    expect(sorted.duplicates).toBe(1);
  });

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
