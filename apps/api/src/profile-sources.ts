import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError } from './errors.js';
import { strFromU8, unzipSync } from 'fflate';
import {
  mentionsSkill,
  type ExternalEvidence,
} from '../../../packages/contracts/src/capability.js';
import { robotsAllow } from '../../../packages/recruitment/src/agent-discovery.js';

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

// ---- Certificates (CFS-113) --------------------------------------------------------------------

const levelFromCertificate = (name: string) =>
  /\b(professional|expert|specialty|specialist|advanced)\b/i.test(name) ? 3 : 2;

/** One certificate: verified when its Open Badges assertion can be fetched and has not expired. */
async function readCertificate(url: string, fetcher: Fetcher) {
  const tryJson = async (u: string) => {
    try {
      const r = await fetcher(u, { headers: UA, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  };
  const doc = (await tryJson(url)) || (await tryJson(url.replace(/\/?$/, '') + '.json'));
  // Open Badges 2.0 assertion, or a 3.0 verifiable credential.
  let badge = doc?.badge ?? doc?.credentialSubject?.achievement ?? doc?.badge_template;
  if (typeof badge === 'string') badge = await tryJson(badge);
  const issuer =
    typeof badge?.issuer === 'string'
      ? (await tryJson(badge.issuer))?.name
      : badge?.issuer?.name || doc?.issuer?.name || '';
  const name = badge?.name || doc?.name || '';
  const issued = month(doc?.issuedOn || doc?.issuanceDate || doc?.issued_at);
  const expires = doc?.expires || doc?.expirationDate || doc?.expires_at;
  const expired = expires ? new Date(expires).getTime() < Date.now() : false;
  return {
    url,
    name: String(name),
    issuer: String(issuer || ''),
    issued,
    verified: Boolean(name) && !expired && !doc?.revoked,
    expired,
  };
}

export async function certificateProposal(
  urls: string[],
  fetcher: Fetcher = fetch,
): Promise<Proposal> {
  const educations: any[] = [];
  const verifiedEvidence: Proposal['verifiedEvidence'] = [];
  const warnings: string[] = [];
  for (const url of urls.slice(0, 10)) {
    const c = await readCertificate(url, fetcher);
    if (!c.name) {
      warnings.push(
        `${url}: no Open Badges data found; it was not added. Add it to your profile by hand.`,
      );
      continue;
    }
    if (c.expired) warnings.push(`${c.name} has expired; it is added as not verified.`);
    educations.push({
      id: `cert-${slug(c.name)}`,
      title: c.name,
      organisation: c.issuer,
      location: '',
      startMonth: null,
      endMonth: c.issued,
      current: false,
      details: [
        c.verified
          ? 'Certificate verified through its Open Badges record.'
          : 'Certificate link supplied; not verified.',
      ],
      technologies: [],
      url,
      evidence: [],
    });
    for (const skill of Object.keys(aliasesForCertificates))
      if (aliasesForCertificates[skill].test(c.name))
        verifiedEvidence.push({
          skill,
          source: 'certificate',
          verified: c.verified,
          supports: levelFromCertificate(c.name),
          detail: `${c.name}${c.issuer ? ` (${c.issuer})` : ''}`,
          lastUsed: c.issued || undefined,
          url,
        });
  }
  return {
    source: 'certificate',
    summary: [
      `${educations.length} certificate${educations.length === 1 ? '' : 's'} read`,
      `${educations.filter((e) => e.details[0].startsWith('Certificate verified')).length} verified`,
    ],
    projects: [],
    workExperiences: [],
    educations,
    skills: [...new Set(verifiedEvidence.map((e) => e.skill))],
    verifiedEvidence,
    warnings,
  };
}

// Skills a certificate name points to; matched on whole words.
const aliasesForCertificates: Record<string, RegExp> = {
  AWS: /\b(aws|amazon web services)\b/i,
  Azure: /\bazure\b/i,
  GCP: /\b(google cloud|gcp)\b/i,
  Kubernetes: /\b(kubernetes|cka|ckad)\b/i,
  Docker: /\bdocker\b/i,
  Python: /\bpython\b/i,
  Java: /\bjava\b/i,
  SQL: /\bsql\b/i,
  'Power BI': /\bpower bi\b|\bpl-300\b/i,
  Tableau: /\btableau\b/i,
  'Machine learning': /\bmachine learning\b/i,
};

// ---- LinkedIn data export (CFS-113) -----------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') ((field += '"'), i++);
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (row.push(field), (field = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      (row.push(field), rows.push(row), (row = []), (field = ''));
    } else field += ch;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  // LinkedIn exports can start with notes before the header row: the header is the first full
  // row with the most common number of columns.
  const counts = new Map<number, number>();
  for (const r of rows)
    if (r.some((c) => c.trim())) counts.set(r.length, (counts.get(r.length) || 0) + 1);
  const width = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const headerAt = rows.findIndex((r) => r.length === width && r.every((c) => c.trim()));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((h) => h.trim());
  return rows
    .slice(headerAt + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const linkedInMonth = (s?: string) => {
  // "Mar 2024", "2024-03" or "2024"
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const d = new Date(`1 ${s}`);
  return Number.isNaN(d.getTime())
    ? null
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Positions, education, skills and certifications from the official LinkedIn data export. */
export function linkedInProposal(files: Record<string, string>): Proposal {
  const find = (name: string) =>
    Object.entries(files).find(([k]) => k.toLowerCase().endsWith(name.toLowerCase()))?.[1];
  const positions = parseCsv(find('Positions.csv') || '');
  const education = parseCsv(find('Education.csv') || '');
  const skills = parseCsv(find('Skills.csv') || '')
    .map((r) => r['Name'])
    .filter(Boolean);
  const certs = parseCsv(find('Certifications.csv') || '');
  const workExperiences = positions.slice(0, 10).map((r) => {
    const end = linkedInMonth(r['Finished On']);
    return {
      id: `li-${slug(`${r['Company Name']}-${r['Title']}`)}`,
      title: r['Title'] || 'Role',
      experienceType: 'work',
      organisation: r['Company Name'] || '',
      location: r['Location'] || '',
      startMonth: linkedInMonth(r['Started On']),
      endMonth: end,
      current: !end,
      details: (r['Description'] || '')
        .split(/\n+/)
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 10),
      technologies: [],
      url: '',
      evidence: [],
    };
  });
  const educations = [
    ...education.slice(0, 6).map((r) => ({
      id: `li-${slug(`${r['School Name']}-${r['Degree Name']}`)}`,
      title: r['Degree Name'] || r['School Name'] || 'Education',
      organisation: r['School Name'] || '',
      location: '',
      startMonth: linkedInMonth(r['Start Date']),
      endMonth: linkedInMonth(r['End Date']),
      current: false,
      details: [r['Notes'], r['Activities']].filter(Boolean),
      technologies: [],
      url: '',
      evidence: [],
    })),
    ...certs.slice(0, 10).map((r) => ({
      id: `li-cert-${slug(r['Name'])}`,
      title: r['Name'],
      organisation: r['Authority'] || '',
      location: '',
      startMonth: null,
      endMonth: linkedInMonth(r['Started On']),
      current: false,
      details: ['Certificate listed in the LinkedIn export; not verified.'],
      technologies: [],
      url: /^https?:\/\//.test(r['Url'] || '') ? r['Url'] : '',
      evidence: [],
    })),
  ];
  if (!positions.length && !education.length && !skills.length && !certs.length)
    throw new AppError(
      422,
      'EXPORT_UNREADABLE',
      'No Positions, Education, Skills or Certifications file was found in the upload.',
    );
  return {
    source: 'linkedin',
    summary: [
      `${workExperiences.length} position${workExperiences.length === 1 ? '' : 's'}`,
      `${education.length} education record${education.length === 1 ? '' : 's'}, ${certs.length} certification${certs.length === 1 ? '' : 's'}`,
      `${skills.length} skill${skills.length === 1 ? '' : 's'}`,
    ],
    projects: [],
    workExperiences,
    educations,
    skills: skills.slice(0, 40),
    verifiedEvidence: [],
    warnings: ['LinkedIn data is self-reported: it is added as described evidence, not verified.'],
  };
}

/** The uploaded export: a ZIP of CSV files, or a single CSV file. */
export function readUpload(base64: string): Record<string, string> {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new AppError(422, 'EXPORT_UNREADABLE', 'Upload the LinkedIn export ZIP (up to 4 MB).');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => f.name.toLowerCase().endsWith('.csv') && f.originalSize < 2_000_000,
    });
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
  }
  const text = bytes.toString('utf8');
  const header = text.split(/\r?\n/).find((l) => l.includes(','));
  const name = /Company Name/.test(header || '')
    ? 'Positions.csv'
    : /School Name/.test(header || '')
      ? 'Education.csv'
      : /Authority/.test(header || '')
        ? 'Certifications.csv'
        : 'Skills.csv';
  return { [name]: text };
}

// ---- Personal website (CFS-113) ---------------------------------------------------------------

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Projects from a personal site, without a model call: each h2/h3 heading with the paragraph that
 * follows becomes a project draft, and known skills in that text become its technologies. Pages
 * the site's robots.txt forbids are not read.
 */
export async function websiteProposal(url: string, fetcher: Fetcher = fetch): Promise<Proposal> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol))
    throw new AppError(422, 'INVALID_URL', 'Use an http or https address.');
  const robots = await fetcher(`${u.origin}/robots.txt`, {
    headers: UA,
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  if (robots && !robotsAllow(robots, u))
    throw new AppError(
      403,
      'ROBOTS_DISALLOWED',
      'This site asks automated readers not to read the page. Add the projects by hand.',
    );
  let html = '';
  try {
    const r = await fetcher(u.href, {
      headers: { 'User-Agent': UA['User-Agent'], Accept: 'text/html' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw Error(String(r.status));
    html = (await r.text()).slice(0, 500_000);
  } catch {
    throw new AppError(
      503,
      'SOURCE_UNAVAILABLE',
      'The page could not be read. Check the address and try again.',
    );
  }
  html = html.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  const projects: any[] = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[1-3][^>]*>|$)/gi;
  for (let m; (m = re.exec(html)) && projects.length < 6;) {
    const title = decode(m[1]).slice(0, 200);
    const paragraphs = [...m[2].matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((x) => decode(x[2]))
      .filter((t) => t.length > 20)
      .slice(0, 4);
    if (!title || !paragraphs.length) continue;
    const text = paragraphs.join(' ');
    projects.push({
      id: `site-${slug(title)}`,
      title,
      experienceType: 'personal',
      organisation: '',
      location: '',
      startMonth: null,
      endMonth: null,
      current: false,
      overview: paragraphs[0].slice(0, 4000),
      details: paragraphs.slice(1).map((p) => p.slice(0, 2000)),
      technologies: Object.keys(aliasesForSite)
        .filter((k) => mentionsSkill(text, k))
        .slice(0, 8),
      url: u.href,
      evidence: [],
    });
  }
  return {
    source: 'website',
    summary: [
      `${projects.length} project section${projects.length === 1 ? '' : 's'} found on ${u.hostname}`,
    ],
    projects,
    workExperiences: [],
    educations: [],
    skills: [...new Set(projects.flatMap((p) => p.technologies))],
    verifiedEvidence: [],
    warnings: projects.length
      ? ['Your own site is your description: it is added as described evidence, not verified.']
      : ['No project sections (a heading followed by text) were found on this page.'],
  };
}
const aliasesForSite = Object.fromEntries(
  [
    'Python',
    'JavaScript',
    'TypeScript',
    'React',
    'Node.js',
    'SQL',
    'PostgreSQL',
    'Docker',
    'AWS',
    'Java',
    'Go',
    'Rust',
    'R',
    'pandas',
    'Tableau',
    'Power BI',
    'Machine learning',
    'Kubernetes',
    'C#',
    'C++',
  ].map((k) => [k, true]),
);

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
  if (kind === 'certificate') {
    const { urls } = z.object({ urls: z.string().trim().min(8).max(5000) }).parse(body);
    const list = urls.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
    if (!list.length)
      throw new AppError(422, 'INVALID_URL', 'Paste at least one certificate link.');
    return certificateProposal(list, fetcher);
  }
  if (kind === 'linkedin') {
    const { file } = z.object({ file: z.string().min(10).max(6_000_000) }).parse(body);
    return linkedInProposal(readUpload(file));
  }
  if (kind === 'website') {
    const { url } = z.object({ url: z.string().trim().url().max(500) }).parse(body);
    return websiteProposal(url, fetcher);
  }
  throw new AppError(404, 'NOT_FOUND', 'Unknown profile source.');
}

export function registerProfileSources(app: Express) {
  app.post('/api/profile-sources/:kind/preview', async (req, res) =>
    res.json(await preview(req.actor!.id, String(req.params.kind), req.body)),
  );
}
