import { useEffect, useState } from 'react';

// Expected model calls before a run starts (CFS-124). The figures come from GET /api/estimates:
// the average of the user's last finished live runs of the same kind, or a typical figure.

export type EstimateKind = 'search' | 'tailor' | 'practice' | 'coach' | 'scout';
type Estimate = {
  calls: number;
  maxCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  runs: number;
};
type Estimates = { live: boolean; estimates: Record<EstimateKind, Estimate> | null };

const nouns: Record<EstimateKind, [one: string, many: string]> = {
  search: ['Find roles run', 'Find roles runs'],
  tailor: ['tailoring run', 'tailoring runs'],
  practice: ['practice run', 'practice runs'],
  coach: ['Coach refresh', 'Coach refreshes'],
  scout: ['Scout sweep', 'Scout sweeps'],
};

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** One sentence for a start button: live estimate, or that rehearsal mode costs nothing. */
export function estimateText(data: Estimates | null, kind: EstimateKind, prefix = 'Live mode: ') {
  if (!data) return '';
  if (!data.live) return 'Rehearsal mode: no model cost.';
  const e = data.estimates?.[kind];
  if (!e) return '';
  const calls =
    e.calls === e.maxCalls
      ? `${e.calls} model call${e.calls === 1 ? '' : 's'}`
      : `${e.calls} model calls (up to ${e.maxCalls})`;
  if (!e.runs)
    return `${prefix}expect about ${calls}. No finished ${nouns[kind][0]} to measure yet.`;
  const total = (e.inputTokens || 0) + (e.outputTokens || 0);
  return `${prefix}usually about ${calls}${total ? ` and ${tokens(total)} tokens` : ''}, from your last ${e.runs === 1 ? nouns[kind][0] : `${e.runs} ${nouns[kind][1]}`}.`;
}

let cache: Promise<Estimates | null> | null = null;
let version = 0;
const listeners = new Set<(v: number) => void>();

/** Fetch the figures again after a run or Coach refresh adds history. */
export function reloadEstimates() {
  cache = null;
  version++;
  listeners.forEach((l) => l(version));
}

/** Loads the estimates once per page load (or reload); a missing or odd reply shows nothing. */
export function useEstimates() {
  const [data, setData] = useState<Estimates | null>(null);
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => void listeners.delete(setV);
  }, []);
  useEffect(() => {
    let current = true;
    cache ||= fetch('/api/estimates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && typeof d === 'object' && typeof d.live === 'boolean' ? d : null))
      .catch(() => null);
    void cache.then((d) => current && setData(d));
    return () => {
      current = false;
    };
  }, [v]);
  return data;
}

export function RunEstimate({
  kind,
  className = 'muted',
}: {
  kind: EstimateKind;
  className?: string;
}) {
  const text = estimateText(useEstimates(), kind);
  return text ? (
    <small className={className} data-testid={`estimate-${kind}`}>
      {text}
    </small>
  ) : null;
}
