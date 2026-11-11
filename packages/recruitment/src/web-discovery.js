import { createHash } from 'node:crypto';
import { JobSourceError } from './source-error.js';
import { countrySpec } from './geography.js';
import { boards, requireTavily, tavilyRequest } from './tavily.js';

// Each accepted page costs one model call, so a search reads at most this many pages.
export const WEB_PAGE_LIMIT = 8;
// Sites that need a login or forbid automated reading, plus the ATS hosts the Tavily source
// already confirms through official APIs (so the two sources do not return the same posting).
export const WEB_LOGIN_WALLED = [
  'seek.com.au',
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'facebook.com',
];
export const WEB_EXCLUDED_DOMAINS = [...WEB_LOGIN_WALLED, ...boards];
// Small employers post very short ads; below this a page is almost certainly a stub or error.
const MIN_TEXT = 150;
const MAX_TEXT = 60000;
const MAX_DESCRIPTION = 20000;

const squash = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
// Same whitespace-insensitive check as quoteInSource in packages/contracts/src/job-record.ts,
// repeated here so this plain-JS package keeps no import from the TypeScript contracts.
const quoteInSource = (source, quote) =>
  Boolean(squash(quote)) && squash(source).toLowerCase().includes(squash(quote).toLowerCase());

// Login-walled sites run regional domains (glassdoor.com.au, au.indeed.com), so match the name.
const walled = new RegExp(
  `(^|\\.)(${WEB_LOGIN_WALLED.map((d) => d.split('.')[0]).join('|')})\\.[a-z.]+$`,
  'i',
);
const excludedHost = (host) =>
  walled.test(host) || WEB_EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));

const count = (text, pattern) => (text.match(pattern) || []).length;
// Article furniture: bylines, read times, "related" blocks and share/subscribe prompts.
const ARTICLE_SIGNS = [
  /\bby (a|our) [a-z ]{0,30}(writer|reporter|editor|correspondent)\b/i,
  /\b\d+[- ]minute read\b/i,
  /\brelated (articles|coverage|stories|reading)\b/i,
  /\bread next\b/i,
  /\bshare this (article|story|post)\b/i,
  /\bsubscribe to our newsletter\b/i,
  /\b(this|our) guide\b/i,
];
const LISTING_HEADING =
  /\b(open roles|open positions|current (vacancies|openings)|search results|jobs found|\d+ (new )?([a-z-]+ ){0,3}(jobs|roles|vacancies))\b/i;
// "Apply now" is left out of the strong count: a single posting often repeats it in its header,
// body and footer. Per-role links like "View job" or "Read more" are what a list repeats.
const ROLE_LINKS = /\b(view job|view role|view details|see job|read more|learn more)\b/gi;
const CLOSED =
  /\b(job|role|position|vacancy|advert(isement)?) (is )?no longer (available|open|accepting)|\bhas (now )?(closed|been filled)\b|\bno longer accepting (applications|new)\b|\bapplications (for this (job|role) )?(have |are )?(now )?closed\b/i;

// Cheap checks before any model call. They stop only pages that are clearly not one open
// posting; anything uncertain goes to the model, which reads a page for a single call and is
// what decides. A wrong stop here loses a real vacancy, so these lean towards letting pages in.
function screen(url, text) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return 'Not a public HTTPS page';
  if (excludedHost(url.hostname)) return 'Excluded site';
  if (!text) return 'Search returned no page text';
  if (text.length < MIN_TEXT) return 'Too little page text';
  if (text.length > MAX_TEXT) return 'Page text too long for one posting';
  // A bare /jobs or /search path is a list; /careers is often a small employer's only vacancy.
  if (/^\/?$|\/(jobs|search|job-search)\/?$/i.test(url.pathname))
    return 'Looks like a listing or home page';
  if (CLOSED.test(text)) return 'Posting has closed';
  const roleLinks = count(text, ROLE_LINKS);
  if (
    roleLinks >= 5 ||
    count(text, /\bapply now\b/gi) >= 8 ||
    (LISTING_HEADING.test(text) && roleLinks + count(text, /\bapply now\b/gi) >= 3)
  )
    return 'Looks like a listing page';
  if (ARTICLE_SIGNS.filter((sign) => sign.test(text)).length >= 2) return 'Looks like an article';
  if (
    !/\b(responsibilities|requirements|qualifications|about the (role|job)|the (role|job)|what you('|’)ll do|you('|’)ll (bring|need)|you bring|we('|’)re hiring|we are hiring|we('|’)re (looking for|after)|apply|full[- ]time|part[- ]time|casual|contract)\b/i.test(
      text,
    )
  )
    return 'Does not look like a job posting';
  return null;
}

const field = (v, max = 300) => squash(typeof v === 'string' ? v : '').slice(0, max);
// A value counts only if its quote is on the page and the value sits inside that quote.
const verified = (text, value, quote) =>
  Boolean(value) &&
  quoteInSource(text, quote) &&
  squash(quote).toLowerCase().includes(value.toLowerCase());

export async function discoverWeb(repo, criteria, { signal, extractPage } = {}) {
  const access = requireTavily();
  if (typeof extractPage !== 'function')
    throw new JobSourceError(
      'CONFIG_REQUIRED',
      'Web page search needs a model reader; it is unavailable in this mode.',
      422,
    );
  const country = countrySpec(criteria.country || 'au');
  const keyword = criteria.keyword || 'graduate analyst';
  const query = [keyword, 'job', criteria.location, criteria.region, country.name]
    .filter(Boolean)
    .join(' ')
    .slice(0, 399);
  const resultLimit = access.mode === 'keyless' ? 5 : 10;
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
    : AbortSignal.timeout(25000);
  const data = await tavilyRequest(
    repo,
    access,
    {
      query,
      topic: 'general',
      search_depth: 'basic',
      max_results: resultLimit,
      exclude_domains: WEB_EXCLUDED_DOMAINS,
      include_answer: false,
      // Tavily returns the page text, so this server never fetches a search-supplied URL itself.
      include_raw_content: true,
      include_usage: true,
      auto_parameters: false,
    },
    deadline,
    signal,
    6000000,
  );
  signal?.throwIfAborted();
  const results = data.results.slice(0, resultLimit);
  const rejected = [];
  const reject = (url, reason) => rejected.push({ url: String(url).slice(0, 500), reason });
  const candidates = [],
    seen = new Set();
  for (const result of results) {
    let url;
    try {
      url = new URL(result.url);
    } catch {
      continue;
    }
    url.search = '';
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const text = squash(typeof result.raw_content === 'string' ? result.raw_content : '');
    const reason = screen(url, text);
    if (reason) reject(url.href, reason);
    else if (candidates.length >= WEB_PAGE_LIMIT) reject(url.href, 'Over the page limit');
    else candidates.push({ url: url.href, host: url.hostname, text });
  }
  const read = async (page) => {
    let out;
    try {
      out = await extractPage({ url: page.url, text: page.text });
    } catch {
      signal?.throwIfAborted();
      return { page, reason: 'Could not read this page' };
    }
    if (!out?.isJobPosting) return { page, reason: 'Not a single open job posting' };
    const title = field(out.title),
      company = field(out.company),
      location = field(out.location);
    if (!verified(page.text, title, out.titleQuote))
      return { page, reason: 'Title is not quoted from the page' };
    if (!verified(page.text, company, out.companyQuote))
      return { page, reason: 'Company is not quoted from the page' };
    const id = createHash('sha256').update(page.url).digest('hex').slice(0, 16);
    const job = repo.normalize(
      {
        id,
        title,
        company,
        location: verified(page.text, location, out.locationQuote) ? location : 'Not supplied',
        employmentType: field(out.employmentType, 80),
        // The description is the page's own text, never model-written.
        description: page.text.slice(0, MAX_DESCRIPTION),
        url: page.url,
      },
      {
        provider: 'web',
        board: page.host,
        listingId: id,
        url: page.url,
        discoveredBy: 'tavily',
        applicationChannel: 'employer_or_board_page',
        verified: false,
        coverage: 'Public web page found by search; vacancy not confirmed by an employer API',
      },
    );
    return { page, job };
  };
  const outcomes = [];
  for (let start = 0; start < candidates.length; start += 2)
    outcomes.push(...(await Promise.all(candidates.slice(start, start + 2).map(read))));
  signal?.throwIfAborted();
  const jobs = outcomes.flatMap((o) => (o.job ? [o.job] : []));
  for (const o of outcomes) if (o.reason) reject(o.page.url, o.reason);
  return {
    jobs,
    count: jobs.length,
    sourceTotal: results.length,
    status: jobs.length ? 'retrieved' : 'no_results',
    geography: {
      country: country.code,
      countryName: country.name,
      region: criteria.region || '',
      city: criteria.location || '',
    },
    discovery: {
      provider: 'web',
      accessMode: access.mode,
      query,
      pagesFound: results.length,
      pagesRead: candidates.length,
      accepted: jobs.length,
      rejected: rejected.slice(0, 20),
      credits: typeof data.usage?.credits === 'number' ? data.usage.credits : null,
    },
    limitations: [
      `Web pages come from one web search; at most ${WEB_PAGE_LIMIT} pages are read per search. This is not full market coverage.`,
      'Sites that need a login or forbid automated reading (SEEK, LinkedIn, Indeed, Glassdoor, Facebook) are excluded.',
      'Vacancy status is unverified: a web page can stay online after a role closes.',
      'Title, company and location come from the page with quoted evidence; the description is the page text itself.',
      'Pages are not filtered by location; check the stated location before applying.',
      'No application was submitted.',
    ],
  };
}
