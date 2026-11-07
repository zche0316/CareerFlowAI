import { createHash } from 'node:crypto';

// SCAFFOLD (plan milestone M2). Scout runs on a schedule, pulls jobs from the same public sources
// as Job Matcher (official Greenhouse/Lever/Ashby boards, Adzuna, Tavily discovery), drops jobs it
// has already seen and returns a shortlist. Persistence and scheduling are behind ports.

export type ScoutJob = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  description: string;
  applicationUrl?: string;
};

export type ScoutQuery = Record<string, unknown> & { provider: string };

export interface ScoutPorts {
  savedSearches(userId: string): Promise<ScoutQuery[]>;
  fetch(query: ScoutQuery, signal?: AbortSignal): Promise<ScoutJob[]>; // JobRepository.search
  seenFingerprints(userId: string): Promise<Set<string>>;
  score(userId: string, jobs: ScoutJob[]): Promise<{ job: ScoutJob; score: number }[]>; // Job Matcher
  saveSweep(userId: string, sweep: ScoutSweep): Promise<void>;
}

export type ScoutSweep = {
  at: string;
  fetched: number;
  fresh: number;
  shortlist: { job: ScoutJob; score: number; fingerprint: string }[];
  failures: { provider: string; message: string }[];
};

// The same vacancy appears on several boards with different IDs; compare normalised content.
export function jobFingerprint(job: Pick<ScoutJob, 'title' | 'company' | 'location'>) {
  const norm = (s = '') => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return createHash('sha256')
    .update([norm(job.company), norm(job.title), norm(job.location)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

export async function runScoutSweep(
  userId: string,
  ports: ScoutPorts,
  options: { topK?: number; minScore?: number; signal?: AbortSignal } = {},
): Promise<ScoutSweep> {
  const { topK = 3, minScore = 60, signal } = options;
  const seen = await ports.seenFingerprints(userId);
  const failures: ScoutSweep['failures'] = [];
  const byFingerprint = new Map<string, ScoutJob>();
  let fetched = 0;
  for (const query of await ports.savedSearches(userId)) {
    try {
      const jobs = await ports.fetch(query, signal);
      fetched += jobs.length;
      for (const job of jobs) {
        const fp = jobFingerprint(job);
        if (!seen.has(fp) && !byFingerprint.has(fp)) byFingerprint.set(fp, job);
      }
    } catch (e) {
      // One failing source must not hide results from the others; failures are reported.
      failures.push({ provider: query.provider, message: e instanceof Error ? e.message : 'Failed' });
    }
  }
  const fresh = [...byFingerprint.entries()];
  const scored = fresh.length ? await ports.score(userId, fresh.map(([, job]) => job)) : [];
  const shortlist = scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id))
    .slice(0, topK)
    .map((s) => ({ ...s, fingerprint: jobFingerprint(s.job) }));
  const sweep = { at: new Date().toISOString(), fetched, fresh: fresh.length, shortlist, failures };
  await ports.saveSweep(userId, sweep);
  return sweep;
}

// Wiring sketch (pg-boss already backs the mission queue):
//   await boss.schedule('scout-sweep', '0 21 * * *', { userId }, { tz: 'Australia/Sydney' });
//   await boss.work('scout-sweep', ([job]) => runScoutSweep(job.data.userId, scoutPorts));
// A non-empty shortlist then starts a mission whose supervisor goes straight to selection.
