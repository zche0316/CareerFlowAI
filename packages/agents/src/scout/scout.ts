import { createHash } from 'node:crypto';

// Scout sweep logic (plan milestone M2): pull jobs from the same public sources as Job Matcher,
// drop jobs already seen and duplicates across boards, and return a shortlist. Persistence is
// behind ports; apps/api/src/scout.ts wires them and scout/graph.ts orchestrates the sweep.

export type ScoutJob = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  description: string;
  applicationUrl?: string;
};

// The same vacancy appears on several boards with different IDs; compare normalised content.
export function jobFingerprint(job: Pick<ScoutJob, 'title' | 'company' | 'location'>) {
  const norm = (s = '') =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return createHash('sha256')
    .update([norm(job.company), norm(job.title), norm(job.location)].join('|'))
    .digest('hex')
    .slice(0, 32);
}

/** Split fetched jobs into ones never seen before (deduplicated across boards) and repeats. */
export function freshJobs<T extends Pick<ScoutJob, 'title' | 'company' | 'location'>>(
  jobs: T[],
  seen: Set<string>,
) {
  const fresh = new Map<string, T>();
  const seenAgain = new Set<string>();
  let duplicates = 0;
  for (const job of jobs) {
    const fp = jobFingerprint(job);
    if (seen.has(fp)) seenAgain.add(fp);
    else if (fresh.has(fp)) duplicates++;
    else fresh.set(fp, job);
  }
  return { fresh: [...fresh.values()], seenAgain: [...seenAgain], duplicates };
}
