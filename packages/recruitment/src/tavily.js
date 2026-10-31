import { JobSourceError } from './source-error.js';
import { countrySpec, filterGeography } from './geography.js';

const boards = [
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.eu.lever.co',
  'jobs.ashbyhq.com',
];
const slug = /^[a-zA-Z0-9_-]{1,80}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function tavilyAccess(env = process.env) {
  const key = env.TAVILY_API_KEY?.trim();
  const mode = env.TAVILY_ACCESS_MODE || 'api_key';
  return { configured: mode === 'keyless' || (mode === 'api_key' && Boolean(key)), mode, key };
}

// Parse public posting identities, never fetch a search-supplied arbitrary URL.
export function postingIdentity(raw) {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      !boards.includes(u.hostname)
    )
      return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (
      ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) &&
      parts.length === 3 &&
      slug.test(parts[0]) &&
      parts[1] === 'jobs' &&
      /^\d{1,30}$/.test(parts[2])
    )
      return { provider: 'greenhouse', board: parts[0], id: parts[2], host: u.hostname };
    if (
      ['jobs.lever.co', 'jobs.eu.lever.co', 'jobs.ashbyhq.com'].includes(u.hostname) &&
      parts.length === 2 &&
      slug.test(parts[0]) &&
      uuid.test(parts[1])
    )
      return {
        provider: u.hostname === 'jobs.ashbyhq.com' ? 'ashby' : 'lever',
        board: parts[0],
        id: parts[1],
        host: u.hostname,
      };
  } catch {}
  return null;
}

export async function verifyPosting(repo, identity, signal, boardCache = new Map()) {
  const { provider, board, id, host } = identity;
  if (!slug.test(board) || !boards.includes(host))
    throw new JobSourceError('INVALID_SOURCE', 'Invalid public posting identity.', 422);
  let entry, api, url, location, description, title, employmentType;
  if (
    provider === 'greenhouse' &&
    /^\d{1,30}$/.test(id) &&
    ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(host)
  ) {
    api = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`;
    entry = await repo.json(api, signal);
    if (String(entry.id) !== id) throw new Error('Posting identity mismatch.');
    url = entry.absolute_url;
    location = entry.location?.name;
    description = entry.content;
    title = entry.title;
  } else if (
    provider === 'lever' &&
    uuid.test(id) &&
    ['jobs.lever.co', 'jobs.eu.lever.co'].includes(host)
  ) {
    api = `https://${host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${board}/${id}`;
    entry = await repo.json(api, signal);
    if (String(entry.id) !== id) throw new Error('Posting identity mismatch.');
    url = entry.hostedUrl;
    location = entry.categories?.location;
    description = entry.descriptionPlain || entry.description;
    title = entry.text;
    employmentType = entry.categories?.commitment;
  } else if (provider === 'ashby' && uuid.test(id) && host === 'jobs.ashbyhq.com') {
    api = `https://api.ashbyhq.com/posting-api/job-board/${board}`;
    if (!boardCache.has(api)) boardCache.set(api, repo.json(api, signal));
    const data = await boardCache.get(api);
    entry = data.jobs?.find((j) => j.isListed === true && postingIdentity(j.jobUrl)?.id === id);
    if (!entry) throw new JobSourceError('HTTP_ERROR', 'Job API HTTP 404', 404);
    url = entry.jobUrl;
    location = entry.location;
    description = entry.descriptionPlain || entry.descriptionHtml;
    title = entry.title;
    employmentType = entry.employmentType;
  } else throw new JobSourceError('INVALID_SOURCE', 'Unsupported public posting identity.', 422);
  const canonical = postingIdentity(url);
  if (
    !canonical ||
    canonical.provider !== provider ||
    canonical.board !== board ||
    canonical.id !== id ||
    (provider !== 'greenhouse' && canonical.host !== host) ||
    !title ||
    !description ||
    !location
  )
    throw new JobSourceError(
      'INVALID_RESPONSE',
      'Official posting did not confirm its identity and required fields.',
    );
  // Clear tracking/query data; official API identity is the only accepted destination.
  const target = new URL(url);
  target.search = '';
  target.hash = '';
  return repo.normalize(
    { id, title, company: board, location, description, employmentType, url: target.href },
    {
      provider,
      board,
      listingId: id,
      host: canonical.host,
      url: api,
      discoveredBy: 'tavily',
      coverage:
        'Search-discovered posting confirmed through its public ATS API; company label uses board identifier',
    },
  );
}

export async function discoverTavily(repo, criteria, signal) {
  const access = tavilyAccess();
  if (!['api_key', 'keyless'].includes(access.mode) || !access.configured)
    throw new JobSourceError(
      'CONFIG_REQUIRED',
      'Configure TAVILY_API_KEY or explicitly select TAVILY_ACCESS_MODE=keyless on the server.',
      422,
    );
  const country = countrySpec(criteria.country || 'au');
  const keyword = criteria.keyword || 'graduate analyst business operations software data';
  const alternatives = {
    'business analyst':
      '("business analyst" OR "business intelligence analyst" OR "business systems analyst")',
    'data analyst': '("data analyst" OR "analytics analyst" OR "reporting analyst")',
    'software engineer': '("software engineer" OR "software developer" OR "graduate developer")',
  };
  const queryFor = (role) =>
    [role, 'jobs', criteria.location, criteria.region, country.name]
      .filter(Boolean)
      .join(' ')
      .slice(0, 399);
  const queries = [queryFor(keyword)];
  if (access.mode === 'api_key' && alternatives[keyword.toLowerCase()])
    queries.push(queryFor(alternatives[keyword.toLowerCase()]));
  const resultLimit = access.mode === 'keyless' ? 5 : 10;
  const query = queries[0];
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
    : AbortSignal.timeout(25000);
  const search = async (query) => {
    let response;
    try {
      response = await repo.fetcher('https://api.tavily.com/search', {
        method: 'POST',
        redirect: 'error',
        signal: deadline,
        headers: {
          'Content-Type': 'application/json',
          ...(access.mode === 'keyless'
            ? { 'X-Tavily-Access-Mode': 'keyless' }
            : { Authorization: `Bearer ${access.key}` }),
        },
        body: JSON.stringify({
          query,
          topic: 'general',
          search_depth: 'basic',
          max_results: resultLimit,
          include_domains: boards,
          include_answer: false,
          include_raw_content: false,
          include_usage: true,
          auto_parameters: false,
        }),
      });
    } catch {
      signal?.throwIfAborted();
      throw new JobSourceError(
        'UNAVAILABLE',
        'Tavily search unavailable or timed out. Retry; no sample data was substituted.',
      );
    }
    if (!response.ok)
      throw new JobSourceError(
        response.status === 429
          ? 'RATE_LIMITED'
          : [401, 403].includes(response.status)
            ? 'AUTH_REQUIRED'
            : 'HTTP_ERROR',
        `Tavily search rejected the request (HTTP ${response.status}). Check access/credits and retry. No credential-mode fallback was attempted.`,
        response.status,
      );
    const raw = await response.text();
    if (raw.length > 2000000)
      throw new JobSourceError('INVALID_RESPONSE', 'Tavily response was too large.');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new JobSourceError('INVALID_RESPONSE', 'Tavily returned invalid JSON.');
    }
    if (!Array.isArray(data.results))
      throw new JobSourceError('INVALID_RESPONSE', 'Tavily returned no valid result list.');
    return { ...data, results: data.results.slice(0, resultLimit) };
  };
  const outcomes = await Promise.allSettled(queries.map(search));
  signal?.throwIfAborted();
  const batches = outcomes.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!batches.length) throw outcomes[0].reason;
  const data = { results: batches.flatMap((r) => r.results) };
  const candidates = [],
    seen = new Set();
  for (const result of data.results.slice(0, 20)) {
    const identity = postingIdentity(result.url);
    if (!identity) continue;
    const key = [identity.host, identity.board, identity.id].join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ identity, citation: result.url.split('?')[0].split('#')[0] });
  }
  const cache = new Map();
  const checks = [];
  for (let start = 0; start < candidates.length; start += 4) {
    checks.push(
      ...(await Promise.allSettled(
        candidates.slice(start, start + 4).map(async (c) => {
          const job = await verifyPosting(repo, c.identity, deadline, cache);
          job.source.discoveryURL = c.citation;
          return job;
        }),
      )),
    );
  }
  signal?.throwIfAborted();
  if (
    candidates.length &&
    checks.every((c) => c.status === 'rejected' && ![404, 410].includes(c.reason?.status))
  )
    throw new JobSourceError(
      'VERIFICATION_UNAVAILABLE',
      'Search found links, but none could be confirmed through an official API. Retry or choose another source.',
    );
  const verified = checks.filter((c) => c.status === 'fulfilled').map((c) => c.value);
  const jobs = verified.filter((j) =>
    filterGeography(j.location, country.code, criteria.region || '', criteria.location || ''),
  );
  return {
    jobs,
    count: jobs.length,
    sourceTotal: data.results.length,
    status: jobs.length ? 'retrieved' : 'no_results',
    geography: {
      country: country.code,
      countryName: country.name,
      region: criteria.region || '',
      city: criteria.location || '',
    },
    discovery: {
      provider: 'tavily',
      accessMode: access.mode,
      query,
      searchDepth: 'basic',
      queries,
      queryCount: queries.length,
      failedQueries: outcomes.filter((r) => r.status === 'rejected').length,
      resultLimit: queries.length * resultLimit,
      discovered: data.results.length,
      supportedCandidates: candidates.length,
      verified: verified.length,
      excluded: data.results.length - jobs.length,
      credits: batches.every((r) => typeof r.usage?.credits === 'number')
        ? batches.reduce((sum, r) => sum + r.usage.credits, 0)
        : null,
    },
    sources: candidates.map((c, i) => ({
      provider: c.identity.provider,
      board: c.identity.board,
      listingId: c.identity.id,
      status:
        checks[i].status === 'fulfilled'
          ? 'verified'
          : [404, 410].includes(checks[i].reason?.status)
            ? 'closed_or_removed'
            : 'unavailable',
    })),
    limitations: [
      ...(outcomes.some((r) => r.status === 'rejected')
        ? ['One discovery query failed; successful query results were retained.']
        : []),
      `Tavily uses ${queries.length} bounded search query/queries and at most ${queries.length * resultLimit} indexed links; this is not exhaustive market coverage.`,
      'Only Greenhouse, Lever and Ashby posting URLs confirmed by their public APIs become job matches.',
      'Search snippets are not used as job descriptions. Unconfirmed links and unclear country eligibility are excluded.',
      'Salary remains unknown unless separately confirmed. Company labels use the public board identifier.',
      'No application was submitted.',
    ],
  };
}
