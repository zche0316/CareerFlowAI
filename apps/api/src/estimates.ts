import type { Express } from 'express';
import { db } from './db.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';

// Expected model calls before a run starts (CFS-124). Live mode only: the estimate is the average
// of the user's last few finished runs of the same kind, or a typical figure when there are none.

export const ESTIMATE_KINDS = ['search', 'tailor', 'practice', 'coach', 'scout'] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

export type Sample = { calls: number; inputTokens: number; outputTokens: number };

export type Estimate = {
  calls: number;
  maxCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** How many earlier runs the figure comes from; 0 means the typical figure. */
  runs: number;
};

// Typical calls when the user has no finished live run of a kind yet, from the graph's steps:
// a search maps several roles, then the resume team, interview questions and feedback.
const TYPICAL: Record<EstimateKind, [calls: number, max: number]> = {
  search: [15, 20],
  tailor: [6, 10],
  practice: [3, 5],
  coach: [1, 1],
  scout: [6, 7],
};

const HISTORY = 5;

/** Average and largest of the latest samples; the typical figure when there are none. Pure. */
export function summarise(samples: Sample[], kind: EstimateKind): Estimate {
  const used = samples.filter((s) => s.calls > 0).slice(0, HISTORY);
  if (!used.length) {
    const [calls, maxCalls] = TYPICAL[kind];
    return { calls, maxCalls, inputTokens: null, outputTokens: null, runs: 0 };
  }
  const avg = (pick: (s: Sample) => number) =>
    Math.round(used.reduce((sum, s) => sum + pick(s), 0) / used.length);
  return {
    calls: avg((s) => s.calls),
    maxCalls: Math.max(...used.map((s) => s.calls)),
    inputTokens: avg((s) => s.inputTokens),
    outputTokens: avg((s) => s.outputTokens),
    runs: used.length,
  };
}

/** Same rule as the run route in the Quest UI: practice, a run on a known role, or a search. */
export function runEstimateKind(data: any): 'search' | 'tailor' | 'practice' {
  if (data?.practiceOnly) return 'practice';
  if (data?.preselected || data?.scout) return 'tailor';
  return 'search';
}

export async function estimatesFor(userId: string) {
  const mode = configuredMode();
  if (mode === 'fixture') return { live: false, mode, estimates: null };
  const [missions, reviews, sweeps] = await Promise.all([
    db.mission.findMany({
      where: { userId, mode, status: 'COMPLETE' },
      orderBy: { updatedAt: 'desc' },
      take: 40,
      select: { data: true },
    }),
    db.coachReview.findMany({
      where: { userId, mode },
      orderBy: { createdAt: 'desc' },
      take: HISTORY,
      select: { calls: true, inputTokens: true, outputTokens: true },
    }),
    db.scoutSweep.findMany({
      where: { userId, mode, status: 'COMPLETE' },
      orderBy: { createdAt: 'desc' },
      take: HISTORY,
      select: { id: true, calls: true },
    }),
  ]);
  const runs: Record<'search' | 'tailor' | 'practice', Sample[]> = {
    search: [],
    tailor: [],
    practice: [],
  };
  for (const m of missions) {
    const d = m.data as any;
    runs[runEstimateKind(d)].push({
      calls: d.apiCalls || 0,
      inputTokens: d.inputTokens || 0,
      outputTokens: d.outputTokens || 0,
    });
  }
  // Sweeps keep only a call count; their tokens are in the trace spans.
  const spans = sweeps.length
    ? await db.traceSpan.groupBy({
        by: ['sweepId'],
        where: { userId, sweepId: { in: sweeps.map((s) => s.id) } },
        _sum: { inputTokens: true, outputTokens: true },
      })
    : [];
  const sweepSamples = sweeps.map((s) => {
    const t = spans.find((x) => x.sweepId === s.id)?._sum;
    return { calls: s.calls, inputTokens: t?.inputTokens || 0, outputTokens: t?.outputTokens || 0 };
  });
  return {
    live: true,
    mode,
    estimates: {
      search: summarise(runs.search, 'search'),
      tailor: summarise(runs.tailor, 'tailor'),
      practice: summarise(runs.practice, 'practice'),
      coach: summarise(reviews, 'coach'),
      scout: summarise(sweepSamples, 'scout'),
    } satisfies Record<EstimateKind, Estimate>,
  };
}

export function registerEstimates(app: Express) {
  app.get('/api/estimates', async (req, res) => res.json(await estimatesFor(req.actor!.id)));
}
