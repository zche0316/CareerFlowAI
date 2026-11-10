import { describe, expect, it } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';
import { buildScoutGraph, type ScoutGraphPorts } from '../packages/agents/src/scout/graph.js';

function fakePorts(scores: Record<string, number>, minScore = 50) {
  const calls: string[] = [];
  const running = { now: 0, peak: 0 };
  const reported: any[] = [];
  const ports: ScoutGraphPorts = {
    collect: async () => {
      calls.push('collect');
      return { fetched: 9, fresh: Object.keys(scores).length, failures: 1 };
    },
    rank: async () => {
      calls.push('rank');
      return Object.entries(scores)
        .filter(([, score]) => score >= minScore)
        .sort((a, b) => b[1] - a[1])
        .map(([jobId, score]) => ({ jobId, score }));
    },
    tailor: async (_, jobId) => {
      running.now++;
      running.peak = Math.max(running.peak, running.now);
      await new Promise((r) => setTimeout(r, 20));
      running.now--;
      calls.push('tailor:' + jobId);
      return { jobId, missionId: 'm-' + jobId };
    },
    report: async (_, packages, handoffs) => void reported.push({ packages, handoffs }),
  };
  return { ports, calls, running, reported };
}

describe('scout graph', () => {
  it('fans out one tailoring branch per shortlisted job in parallel and reports once', async () => {
    const f = fakePorts({ a: 90, b: 70, c: 65, d: 60, e: 10 });
    const graph = buildScoutGraph(f.ports, new MemorySaver());
    const out = await graph.invoke({ sweepId: 's1' }, { configurable: { thread_id: 'scout:s1' } });
    expect(out.shortlist).toEqual(['a', 'b', 'c']);
    expect(out.packages.map((p) => p.jobId).sort()).toEqual(['a', 'b', 'c']);
    expect(f.running.peak).toBe(3);
    expect(f.reported).toHaveLength(1);
    expect(f.reported[0].packages).toHaveLength(3);
    expect(f.reported[0].handoffs.map((h: any) => `${h.from}>${h.to}`)).toEqual([
      'scout>job_matcher',
      'job_matcher>resume_team',
      'resume_team>human_review',
      'resume_team>human_review',
      'resume_team>human_review',
    ]);
  });

  it('skips tailoring and still reports when nothing reaches the minimum score', async () => {
    const f = fakePorts({ a: 20, b: 10 });
    const out = await buildScoutGraph(f.ports).invoke({ sweepId: 's2' });
    expect(out.packages).toEqual([]);
    expect(f.calls).toEqual(['collect', 'rank']);
    expect(f.reported[0].handoffs.at(-1)).toMatchObject({ from: 'job_matcher', to: 'report' });
  });
});
