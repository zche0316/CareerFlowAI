import { createHash } from 'node:crypto';
import { JobSourceError } from './source-error.js';
import { countrySpec } from './geography.js';
import { tavilyAccess, tavilyRequest } from './tavily.js';

// Jobs reported by a model that searched the web itself. The model's list is a set of claims;
// each is checked here before it counts:
//   1. robots.txt: a page the site forbids automated readers to fetch is never read. The role
//      stays a lead (title, company, link and the model's quote) for the user to open.
//   2. The page is read through Tavily (this server never fetches a model-supplied page URL
//      itself) and must show the title and the company and no closed notice. Only then does the
//      role become a checked job whose description is the page's own text.
export const AGENT_PAGE_LIMIT = 20;
const MAX_DESCRIPTION = 20000;
const ROBOTS_BYTES = 200000;
const AGENT = 'CareerFlowScout';

const squash = (s) =>
  String(s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const words = (s) =>
  squash(s)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9&+ -]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
const field = (v, max = 300) => squash(typeof v === 'string' ? v : '').slice(0, max);

const CLOSED =
  /no longer (available|advertised|accepting|active)|(vacancy|job|ad|advert|position) has (now )?(expired|closed)|position has been filled|applications (have |are )?(now )?closed|this job (is|has) closed|job not found|could not be found/i;

// Only a public https page on a named host is considered. Hosts that look internal are refused
// before any request, so a model-supplied link cannot point the server at a private address.
export function publicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)
  )
    return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gh_src|ref$|origin$|tracking)/i.test(key)) url.searchParams.delete(key);
  return url;
}

// The model sometimes reports a role with the board's search results page instead of the job
// itself. Such a page lists many roles, so it is never read as the posting; the role stays a
// lead and the reason tells the user to look for it by title on that page.
export function searchResultsLink(url) {
  const path = url.pathname.toLowerCase();
  return /(^|\.)indeed\./.test(url.hostname)
    ? !/^\/(m\/)?viewjob$/.test(path)
    : /(^|\.)seek\./.test(url.hostname)
      ? !/^\/job\/\d+\/?$/.test(path)
      : /(^|\.)linkedin\./.test(url.hostname)
        ? !/^\/jobs\/view\//.test(path)
        : /\/(search|jobs)\/?$|-jobs(\/|$|\.html)|\/jobs\/search/.test(path);
}

/** Longest-match robots.txt decision for the wildcard group (and our own agent's group). */
export function robotsAllow(robotsText, url) {
  const groups = [];
  let current = null;
  for (const raw of String(robotsText).split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current)
      current.rules.push({ allow: key === 'allow', path: value });
  }
  const own = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && AGENT.toLowerCase().includes(a)),
  );
  const rules = (own.length ? own : groups.filter((g) => g.agents.includes('*'))).flatMap(
    (g) => g.rules,
  );
  const path = url.pathname + url.search;
  let best = { length: -1, allow: true };
  for (const rule of rules) {
    if (!rule.path) continue;
    const pattern = new RegExp(
      '^' +
        rule.path
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$'),
    );
    if (!pattern.test(path)) continue;
    // Equal length: allow wins, as in RFC 9309.
    if (rule.path.length > best.length || (rule.path.length === best.length && rule.allow))
      best = { length: rule.path.length, allow: rule.allow };
  }
  return best.allow;
}

async function readRobots(repo, origin, cache, signal) {
  if (cache.has(origin)) return cache.get(origin);
  let text = '';
  try {
    const response = await repo.fetcher(origin + '/robots.txt', {
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
      headers: { 'User-Agent': AGENT, Accept: 'text/plain' },
    });
    // A missing robots.txt allows everything; a server error is treated as "do not read".
    text = response.ok
      ? (await response.text()).slice(0, ROBOTS_BYTES)
      : response.status >= 500
        ? 'User-agent: *\nDisallow: /'
        : '';
  } catch {
    signal?.throwIfAborted();
    text = 'User-agent: *\nDisallow: /';
  }
  cache.set(origin, text);
  return text;
}

export async function discoverAgent(repo, criteria, { signal, searchAgent } = {}) {
  if (typeof searchAgent !== 'function')
    throw new JobSourceError(
      'CONFIG_REQUIRED',
      'Model web search is unavailable in this mode; it needs the native OpenAI settings.',
      422,
    );
  const country = countrySpec(criteria.country || 'au');
  const keyword = criteria.keyword || 'graduate analyst';
  const location = [criteria.location, criteria.region].filter(Boolean).join(', ');
  const found = await searchAgent({
    keyword,
    location,
    countryName: country.name,
    countryCode: country.code,
  });
  signal?.throwIfAborted();

  const rejected = [];
  const reject = (url, reason) => rejected.push({ url: String(url).slice(0, 500), reason });
  const claims = [];
  const seen = new Set();
  for (const raw of found.jobs || []) {
    const title = field(raw.title);
    const company = field(raw.company);
    const url = publicUrl(raw.url);
    if (!title || !url) {
      reject(raw.url || '(no link)', 'No usable public link');
      continue;
    }
    const key = url.href;
    const identity = (title + '|' + company).toLowerCase();
    if (seen.has(key) || seen.has(identity)) continue;
    seen.add(key);
    seen.add(identity);
    claims.push({
      title,
      company,
      location: field(raw.location),
      quote: field(raw.quote, 500),
      url,
    });
  }

  const robots = new Map();
  const readable = [];
  const leads = [];
  for (const claim of claims) {
    if (searchResultsLink(claim.url)) {
      leads.push({
        ...claim,
        leadReason: 'The link is a search results page; find the role there by its title',
      });
      continue;
    }
    const text = await readRobots(repo, claim.url.origin, robots, signal);
    if (robotsAllow(text, claim.url)) readable.push(claim);
    else leads.push({ ...claim, leadReason: 'The site does not allow automated reading' });
  }

  // Tavily reads the pages; at most AGENT_PAGE_LIMIT per search.
  const pages = new Map();
  const toRead = readable.slice(0, AGENT_PAGE_LIMIT);
  for (const claim of readable.slice(AGENT_PAGE_LIMIT))
    leads.push({ ...claim, leadReason: 'Over the page-reading limit for one search' });
  const access = tavilyAccess();
  if (toRead.length && access.configured) {
    try {
      const data = await tavilyRequest(
        repo,
        access,
        { urls: [...new Set(toRead.map((c) => c.url.href))], extract_depth: 'advanced' },
        signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
        signal,
        12000000,
        'extract',
      );
      for (const r of data.results) pages.set(r.url, squash(r.raw_content));
    } catch (e) {
      signal?.throwIfAborted();
      if (!(e instanceof JobSourceError)) throw e;
    }
  }

  const jobs = [];
  for (const claim of toRead) {
    const text = pages.get(claim.url.href) || '';
    const low = text.toLowerCase();
    const titleWords = words(claim.title).slice(0, 4);
    const companyWord = words(claim.company)[0];
    if (!text) {
      leads.push({ ...claim, leadReason: 'The page could not be read' });
      continue;
    }
    if (CLOSED.test(text)) {
      reject(claim.url.href, 'Page says the role is closed or gone');
      continue;
    }
    if (!titleWords.length || !titleWords.every((w) => low.includes(w))) {
      reject(claim.url.href, 'Title is not on the page');
      continue;
    }
    if (companyWord && !low.includes(companyWord)) {
      reject(claim.url.href, 'Company is not on the page');
      continue;
    }
    jobs.push(toJob(repo, claim, { description: text.slice(0, MAX_DESCRIPTION), checked: true }));
  }
  const leadJobs = leads.map((lead) =>
    toJob(repo, lead, { description: lead.quote, checked: false, leadReason: lead.leadReason }),
  );
  return {
    jobs: [...jobs, ...leadJobs],
    count: jobs.length + leadJobs.length,
    sourceTotal: (found.jobs || []).length,
    status: jobs.length || leadJobs.length ? 'retrieved' : 'no_results',
    geography: {
      country: country.code,
      countryName: country.name,
      region: criteria.region || '',
      city: criteria.location || '',
    },
    discovery: {
      provider: 'agent',
      model: found.model,
      searches: found.searches,
      pagesOpenedByModel: found.pagesOpened,
      reported: (found.jobs || []).length,
      checked: jobs.length,
      leads: leadJobs.length,
      rejected,
    },
    limitations: [
      'A model searched the web and reported these roles; each was then checked on the server.',
      'Checked roles: the page was read and shows the title and company with no closed notice. The vacancy is still not confirmed by the employer.',
      'Leads: sites such as SEEK, LinkedIn and Indeed do not allow automated reading, so these roles were not checked. Open the link to confirm before applying.',
      'Coverage is one search session, not the whole market.',
      'No application was submitted.',
    ],
  };
}

function toJob(repo, claim, { description, checked, leadReason = '' }) {
  const id = createHash('sha256').update(claim.url.href).digest('hex').slice(0, 16);
  const job = repo.normalize(
    {
      id,
      title: claim.title,
      company: claim.company,
      location: claim.location,
      employmentType: '',
      description,
      url: claim.url.href,
    },
    {
      provider: 'agent',
      board: claim.url.hostname,
      listingId: id,
      url: claim.url.href,
      discoveredBy: 'model-web-search',
      applicationChannel: 'employer_or_board_page',
      verified: false,
      pageChecked: checked,
      ...(checked ? {} : { lead: true, leadReason }),
      coverage: checked
        ? 'Found by a model web search; the page was read and checked on the server'
        : 'Found by a model web search; the page was not read, so this is an unchecked lead',
    },
  );
  job.availability = {
    status: 'seen_on_web_at_retrieval',
    checkedAt: new Date().toISOString(),
    method: checked ? 'model-web-search-page-checked' : 'model-web-search-lead',
  };
  return job;
}
