import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError } from './errors.js';
import type { ExternalEvidence } from '../../../packages/contracts/src/capability.js';

// Profile sources (CFS-112 to CFS-114): read public, verifiable data and turn it into a proposed
// profile. Nothing is saved here. The browser shows the proposal; the user reviews it and approves
// it through the normal draft-and-approve flow, so imported facts enter the evidence library only
// after approval, each with its source and whether it was verified.

export type Proposal = {
  source: string;
  summary: string[];
  projects: any[];
  workExperiences: any[];
  educations: any[];
  skills: string[];
  verifiedEvidence: (ExternalEvidence & { url?: string })[];
  warnings: string[];
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const UA = { 'User-Agent': 'CareerFlow-profile-import', Accept: 'application/json' };

const month = (iso?: string | null) => (iso ? String(iso).slice(0, 7) : null);
const monthsAgo = (iso: string | null, now = new Date()) => {
  if (!iso) return Infinity;
  const [y, m] = iso.split('-').map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'item';

async function getJson(fetcher: Fetcher, url: string, what: string) {
  let response: Response;
  try {
    response = await fetcher(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new AppError(503, 'SOURCE_UNAVAILABLE', `${what} could not be reached. Try again later.`);
  }
  if (response.status === 404) throw new AppError(404, 'SOURCE_NOT_FOUND', `${what}: not found.`);
  if (response.status === 403 || response.status === 429)
    throw new AppError(
      429,
      'SOURCE_RATE_LIMITED',
      `${what} is rate-limiting requests. Try again later.`,
    );
  if (!response.ok)
    throw new AppError(503, 'SOURCE_UNAVAILABLE', `${what} returned ${response.status}.`);
  return response.json();
}

// ---- GitHub (CFS-112) --------------------------------------------------------------------------

const MAX_REPOS = 6;

/**
 * Public repositories through the official REST API: the most recently pushed non-fork
 * repositories become personal projects; languages, tests and CI become verified evidence.
 * Uses GITHUB_TOKEN when the server has one (higher rate limit), never the user's own token.
 */
export async function githubProposal(
  username: string,
  fetcher: Fetcher = fetch,
): Promise<Proposal> {
  const api = 'https://api.github.com';
  const headers: Record<string, string> = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const get = (url: string) =>
    getJson((u, init) => fetcher(u, { ...init, headers: { ...UA, ...headers } }), url, 'GitHub');
  const user = await get(`${api}/users/${encodeURIComponent(username)}`);
  const repos: any[] = (
    await get(`${api}/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`)
  )
    .filter((r: any) => !r.fork && !r.archived)
    .slice(0, MAX_REPOS);
  const projects: any[] = [];
  const evidence = new Map<
    string,
    ExternalEvidence & { repos: number; stars: number; size: number }
  >();
  const practice = { tests: 0, ci: 0 };
  for (const r of repos) {
    const languages: Record<string, number> = await get(r.languages_url).catch(() => ({}));
    const root: any[] = await get(`${api}/repos/${r.full_name}/contents`).catch(() => []);
    const names = new Set(root.map((f: any) => String(f.name).toLowerCase()));
    const hasCi = names.has('.github') || names.has('.gitlab-ci.yml') || names.has('.circleci');
    const hasTests = ['test', 'tests', '__tests__', 'spec', 'e2e'].some((n) => names.has(n));
    if (hasCi) practice.ci++;
    if (hasTests) practice.tests++;
    const langs = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([l]) => l)
      .slice(0, 4);
    const pushed = month(r.pushed_at);
    projects.push({
      id: `gh-${slug(r.name)}`,
      title: r.name,
      experienceType: 'personal',
      organisation: 'GitHub',
      location: '',
      startMonth: month(r.created_at),
      endMonth: monthsAgo(pushed) <= 3 ? null : pushed,
      current: monthsAgo(pushed) <= 3,
      overview: r.description || '',
      details: [
        `Public repository${r.stargazers_count ? ` with ${r.stargazers_count} star${r.stargazers_count === 1 ? '' : 's'}` : ''}${hasTests ? ', automated tests' : ''}${hasCi ? ' and CI' : ''}.`,
      ],
      technologies: langs,
      url: r.html_url,
      evidence: [],
    });
    for (const lang of langs) {
      const e = evidence.get(lang) || {
        skill: lang,
        source: 'github',
        verified: true,
        supports: 2 as const,
        detail: '',
        lastUsed: pushed || undefined,
        repos: 0,
        stars: 0,
        size: 0,
      };
      e.repos++;
      e.stars += r.stargazers_count || 0;
      e.size += r.size || 0; // KB
      if (pushed && (!e.lastUsed || pushed > e.lastUsed)) e.lastUsed = pushed;
      evidence.set(lang, e);
    }
  }
  const verifiedEvidence = [...evidence.values()].map(({ repos: n, stars, size, ...e }) => ({
    ...e,
    // A repository of meaningful size, several repositories or real adoption count as level 3.
    supports: (n >= 2 || size >= 500 || stars >= 5 ? 3 : 2) as 2 | 3,
    detail: `${n} public GitHub repositor${n === 1 ? 'y' : 'ies'}${stars ? `, ${stars} stars` : ''}`,
    url: user.html_url,
  }));
  if (practice.tests)
    verifiedEvidence.push({
      skill: 'Testing',
      source: 'github',
      verified: true,
      supports: practice.tests >= 2 ? 3 : 2,
      detail: `${practice.tests} repositories with automated tests`,
      url: user.html_url,
    });
  if (practice.ci)
    verifiedEvidence.push({
      skill: 'CI/CD',
      source: 'github',
      verified: true,
      supports: 2,
      detail: `${practice.ci} repositories with CI configuration`,
      url: user.html_url,
    });
  return {
    source: 'github',
    summary: [
      `${repos.length} public repositor${repos.length === 1 ? 'y' : 'ies'} from ${user.login}`,
      `${evidence.size} language${evidence.size === 1 ? '' : 's'} with verified use`,
    ],
    projects,
    workExperiences: [],
    educations: [],
    skills: [...evidence.keys()],
    verifiedEvidence,
    warnings: repos.length ? [] : ['No public, non-fork repositories were found.'],
  };
}

// ---- Merge into the approved profile ------------------------------------------------------------

/** The approved profile with the proposal added: records by id, skills and evidence deduplicated. */
export function mergeProposal(profile: any, p: Proposal) {
  const byId = (current: any[] = [], incoming: any[]) => {
    const ids = new Set(current.map((r) => r.id));
    return [...current, ...incoming.filter((r) => !ids.has(r.id))].slice(0, 20);
  };
  const evidenceKey = (e: any) => `${e.source}|${e.skill}|${e.detail}`.toLowerCase();
  const kept = (profile.verifiedEvidence || []).filter(
    (e: any) => e.source !== p.source || !p.verifiedEvidence.some((n) => n.skill === e.skill),
  );
  const evidence = [...kept, ...p.verifiedEvidence];
  return {
    ...profile,
    projects: byId(profile.projects, p.projects),
    workExperiences: byId(profile.workExperiences, p.workExperiences),
    educations: byId(profile.educations, p.educations),
    skills: [...new Set([...(profile.skills || []), ...p.skills])].slice(0, 60),
    verifiedEvidence: [...new Map(evidence.map((e: any) => [evidenceKey(e), e])).values()].slice(
      0,
      200,
    ),
  };
}

export async function preview(
  userId: string,
  kind: string,
  body: unknown,
  fetcher: Fetcher = fetch,
) {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile)
    throw new AppError(409, 'PROFILE_REQUIRED', 'Approve your profile before adding sources.');
  const proposal = await readSource(kind, body, fetcher);
  return { proposal, merged: mergeProposal(profile.data, proposal) };
}

export async function readSource(kind: string, body: unknown, fetcher: Fetcher): Promise<Proposal> {
  if (kind === 'github') {
    const { username } = z
      .object({
        username: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,39}$/, 'Use a GitHub username.'),
      })
      .parse(body);
    return githubProposal(username, fetcher);
  }
  throw new AppError(404, 'NOT_FOUND', 'Unknown profile source.');
}

export function registerProfileSources(app: Express) {
  app.post('/api/profile-sources/:kind/preview', async (req, res) =>
    res.json(await preview(req.actor!.id, String(req.params.kind), req.body)),
  );
}
