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

// Words that change between boards for the same employer or place, not the role itself.
const legalSuffix = new Set(
  'pty proprietary ltd limited inc incorporated llc plc corp corporation co gmbh ag sa bv'.split(
    ' ',
  ),
);
const placeNoise = new RegExp(
  '\\b(' +
    [
      'new south wales',
      'victoria',
      'queensland',
      'western australia',
      'south australia',
      'tasmania',
      'australian capital territory',
      'northern territory',
      'nsw',
      'vic',
      'qld',
      'wa',
      'sa',
      'tas',
      'act',
      'nt',
      'australia',
      'au',
      'new zealand',
      'nz',
      'hybrid',
      'remote',
      'on site',
      'onsite',
      'cbd',
      'metro',
      'greater',
      'region',
    ].join('|') +
    ')\\b|\\d+',
  'g',
);
const words = (s = '') =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N},|]+/gu, ' ');
const squash = (s: string) => s.replace(/[,|]/g, ' ').replace(/\s+/g, ' ').trim();

/** Company without legal suffixes or a leading "the": "The Acme Pty Ltd" -> "acme". */
export function companyKey(company = '') {
  const tokens = squash(words(company)).split(' ').filter(Boolean);
  while (tokens.length > 1 && legalSuffix.has(tokens.at(-1)!)) tokens.pop();
  if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
  return tokens.join(' ');
}
/** Title with common abbreviations spelled out: "Sr. Data Analyst" -> "senior data analyst". */
export const titleKey = (title = '') =>
  squash(
    words(title)
      .replace(/\bsr\b/g, 'senior')
      .replace(/\bjr\b/g, 'junior')
      .replace(/\bgrad\b/g, 'graduate'),
  );
/** The city only: "Sydney NSW 2000", "Sydney, New South Wales" and "Hybrid - Sydney" -> "sydney". */
export const placeKey = (location = '') =>
  words(location.replace(/\s[-–]\s/g, ','))
    .replace(placeNoise, ' ')
    .split(/[,|]/)
    .map(squash)
    .find(Boolean) || '';

// The same vacancy appears on several boards with different IDs and spellings; compare the
// employer, role and city after removing those differences.
export function jobFingerprint(job: Pick<ScoutJob, 'title' | 'company' | 'location'>) {
  return createHash('sha256')
    .update([companyKey(job.company), titleKey(job.title), placeKey(job.location)].join('|'))
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
