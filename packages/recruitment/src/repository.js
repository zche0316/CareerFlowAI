import { JobSourceError } from './source-error.js';
export { JobSourceError } from './source-error.js';
import { discoverTavily, postingIdentity, tavilyAccess, verifyPosting } from './tavily.js';
import { countries, countrySpec, filterGeography } from './geography.js';
export const employerBoards = [
  { board: 'spaceship', company: 'Spaceship', hosts: [] },
  { board: 'vgw', company: 'VGW', hosts: [] },
  { board: 'gofundme', company: 'GoFundMe', hosts: [] },
  { board: 'mongodb', company: 'MongoDB', hosts: ['www.mongodb.com', 'mongodb.com'] },
];
export function recruitmentSettings(env = process.env) {
  const provider = ['employers', 'greenhouse', 'tavily', 'adzuna', 'fixtures'].includes(
    env.JOB_SOURCE,
  )
    ? env.JOB_SOURCE
    : 'employers';
  const country = countries.some((c) => c.code === env.ADZUNA_COUNTRY) ? env.ADZUNA_COUNTRY : 'au';
  return {
    defaults: { provider, country },
    adzunaConfigured: Boolean(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY),
    tavilyConfigured: tavilyAccess(env).configured,
    tavilyAccessMode: tavilyAccess(env).mode,
  };
}
export function uniqueJobs(jobs) {
  const ids = new Set(),
    urls = new Set();
  return jobs.filter((job) => {
    const u = new URL(job.applicationUrl);
    for (const key of [...u.searchParams.keys()])
      if (key.startsWith('utm_')) u.searchParams.delete(key);
    const url = u.href;
    if (ids.has(job.id) || urls.has(url)) return false;
    ids.add(job.id);
    urls.add(url);
    return true;
  });
}
const clean = (v) =>
  String(v || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export function manualListing(listing) {
  if (!listing) throw Error('Paste the listing URL, title, company, location and description.');
  const u = new URL(listing.url);
  let platform;
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    throw Error('Use an official HTTPS listing URL.');
  if (
    ['seek.com.au', 'www.seek.com.au'].includes(u.hostname) &&
    /^\/job\/\d+\/?$/.test(u.pathname)
  ) {
    platform = 'SEEK';
    u.search = '';
  } else if (
    ['au.indeed.com', 'www.indeed.com', 'indeed.com'].includes(u.hostname) &&
    u.pathname === '/viewjob' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(u.searchParams.get('jk') || '')
  ) {
    platform = 'Indeed';
    const key = u.searchParams.get('jk');
    u.search = '';
    u.searchParams.set('jk', key);
  } else throw Error('Use a SEEK /job/ID or Indeed /viewjob?jk=ID listing.');
  u.hash = '';
  return {
    id: 'manual-' + encodeURIComponent(u.href),
    title: clean(listing.title),
    company: clean(listing.company),
    location: clean(listing.location),
    employmentType: 'Not supplied',
    description: clean(listing.description),
    salary: null,
    growth: null,
    applicationUrl: u.href,
    source: {
      name: platform,
      version: 'user-provided',
      externalListing: true,
      liveVacancy: false,
      fictional: false,
      fetchedAt: new Date().toISOString(),
      coverage: 'User-pasted listing; not retrieved or verified by API',
    },
  };
}
function publicURL(raw, hosts) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export class JobRepository {
  constructor({
    fetcher = fetch,
    adzunaId = process.env.ADZUNA_APP_ID,
    adzunaKey = process.env.ADZUNA_APP_KEY,
  } = {}) {
    this.fetcher = fetcher;
    this.adzunaId = adzunaId;
    this.adzunaKey = adzunaKey;
  }
  capabilities() {
    return {
      greenhouse: { search: true, credentialsRequired: false },
      tavily: { search: tavilyAccess().configured, accessMode: tavilyAccess().mode },
      adzuna: {
        search: Boolean(this.adzunaId && this.adzunaKey),
        countries: countries.map((c) => c.code),
      },
      seek: {
        import: false,
        searchAPI: false,
        submitAPI: false,
        reason: 'Partner authorization required; personal login is not an API credential.',
      },
      indeed: {
        import: false,
        searchAPI: false,
        submitAPI: false,
        reason: 'Partner integration required; personal login is not an API credential.',
      },
    };
  }
  async json(url, signal) {
    try {
      const r = await this.fetcher(url, {
        headers: { Accept: 'application/json' },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
          : AbortSignal.timeout(12000),
        redirect: 'error',
      });
      if (!r.ok) {
        if (r.status === 429) {
          const header = r.headers?.get('retry-after');
          const seconds =
            header && /^\d+$/.test(header)
              ? Number(header)
              : header
                ? Math.ceil((Date.parse(header) - Date.now()) / 1000)
                : null;
          const wait = Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 3600)) : null;
          throw new JobSourceError(
            'RATE_LIMITED',
            'Job source rate limit reached.' +
              (wait ? ' Retry after ' + wait + ' seconds.' : ' Wait before retrying.'),
            429,
            wait,
          );
        }
        if (r.status === 401 || r.status === 403)
          throw new JobSourceError(
            'AUTH_REQUIRED',
            'Job source rejected its credentials. Check the server-side Adzuna app ID and key.',
            r.status,
          );
        throw new JobSourceError('HTTP_ERROR', 'Job API HTTP ' + r.status, r.status);
      }
      const raw = await r.text();
      if (raw.length > 12000000) throw Error('Job API response too large.');
      return JSON.parse(raw);
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      if (e instanceof JobSourceError) throw e;
      throw new JobSourceError(
        e?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNAVAILABLE',
        'Job API unavailable or timed out. Retry without changing approved data.',
      );
    }
  }
  normalize(j, source) {
    return {
      id: source.provider + '-' + source.board + '-' + String(j.id),
      title: clean(j.title),
      company: clean(j.company) || (source.provider === 'adzuna' ? 'Not supplied' : source.board),
      location: clean(j.location) || 'Not supplied',
      employmentType: clean(j.employmentType) || 'Unspecified',
      description: clean(j.description).slice(0, 50000),
      salary: j.salary || null,
      growth: null,
      source: {
        name: source.provider,
        version: 'live-snapshot',
        liveVacancy: true,
        ...source,
        fetchedAt: new Date().toISOString(),
        fictional: false,
      },
      applicationUrl: j.url,
      availability: {
        status: source.provider === 'adzuna' ? 'listed_at_retrieval' : 'published_at_retrieval',
        checkedAt: new Date().toISOString(),
        method: source.provider === 'adzuna' ? 'aggregator-search-api' : 'official-job-board-api',
      },
      liveListing: true,
    };
  }
  async revalidate(job, { signal } = {}) {
    if (['lever', 'ashby'].includes(job?.source?.provider)) {
      const identity = postingIdentity(job.applicationUrl);
      if (
        !identity ||
        identity.provider !== job.source.provider ||
        identity.board !== job.source.board ||
        identity.id !== job.source.listingId
      )
        throw Error('Job source identity is invalid.');
      try {
        const fresh = await verifyPosting(this, identity, signal);
        if (fresh.applicationUrl !== job.applicationUrl)
          throw Error('Posting destination changed.');
        return {
          status: 'published_at_check',
          checkedAt: new Date().toISOString(),
          method: 'official-job-board-api',
        };
      } catch (e) {
        if (/HTTP (404|410)/.test(e.message))
          return {
            status: 'closed_or_removed',
            checkedAt: new Date().toISOString(),
            method: 'official-job-board-api',
          };
        throw e;
      }
    }
    if (job?.source?.provider !== 'greenhouse')
      return {
        status: 'unverified',
        checkedAt: new Date().toISOString(),
        reason: 'This source does not provide a direct vacancy recheck here.',
      };
    const { board, listingId } = job.source;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(board) || !/^\d{1,30}$/.test(listingId || ''))
      throw Error('Job source identity is invalid. Run matching again.');
    const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${listingId}`;
    try {
      const d = await this.json(url, signal);
      if (String(d.id) !== listingId) throw Error('Vacancy identity changed. Run matching again.');
      const destination = publicURL(d.absolute_url, [
        'greenhouse.io',
        ...(employerBoards.find((s) => s.board === board)?.hosts || []),
      ]);
      if (destination !== job.applicationUrl)
        throw Error('Official job details changed. Run matching again.');
      return {
        status: 'published_at_check',
        checkedAt: new Date().toISOString(),
        method: 'official-job-board-api',
      };
    } catch (e) {
      if (/HTTP (404|410)/.test(e.message))
        return {
          status: 'closed_or_removed',
          checkedAt: new Date().toISOString(),
          method: 'official-job-board-api',
        };
      throw e;
    }
  }
  async search(b, { signal } = {}) {
    if (
      typeof b.keyword !== 'string' ||
      b.keyword.length > 150 ||
      typeof b.location !== 'string' ||
      b.location.length > 150
    )
      throw Error('Keyword and location must be under 150 characters.');
    const country = b.country || 'au';
    const geo = countrySpec(country);
    const region = b.region || '';
    if (
      typeof region !== 'string' ||
      region.length > 150 ||
      (region && !geo.regions.some((r) => r[0] === region))
    )
      throw Error('Region does not belong to selected country.');
    if (b.provider === 'manual')
      return {
        jobs: [manualListing(b.listing)],
        geography: { country, region },
        limitations: ['User-provided content; availability and accuracy have not been verified.'],
      };
    if (b.provider === 'tavily') return discoverTavily(this, b, signal);
    if (b.provider === 'employers') {
      const outcomes = await Promise.allSettled(
        employerBoards.map((source) =>
          this.search({ ...b, provider: 'greenhouse', board: source.board }, { signal }),
        ),
      );
      signal?.throwIfAborted();
      const sources = outcomes.map((r, i) => ({
        provider: 'greenhouse',
        board: employerBoards[i].board,
        company: employerBoards[i].company,
        status: r.status === 'fulfilled' ? 'retrieved' : 'unavailable',
        count: r.status === 'fulfilled' ? r.value.jobs.length : 0,
      }));
      if (outcomes.every((r) => r.status === 'rejected'))
        throw Error(
          'All official employer sources are unavailable. Retry; no demo jobs were substituted.',
        );
      const unique = new Map();
      for (const result of outcomes)
        if (result.status === 'fulfilled')
          for (const job of result.value.jobs) unique.set(job.applicationUrl, job);
      const jobs = [...unique.values()].slice(0, 100);
      return {
        jobs,
        count: jobs.length,
        sources,
        status: jobs.length ? 'retrieved' : 'no_results',
        geography: { country, countryName: geo.name, region, city: b.location },
        limitations: [
          'Selected employer boards only, not every Australian employer.',
          'Live published snapshot; availability and job details can change.',
          ...sources
            .filter((s) => s.status === 'unavailable')
            .map((s) => s.company + ' source unavailable; excluded from results.'),
        ],
      };
    }
    let jobs = [];
    let sourceTotal = null;
    if (b.provider === 'greenhouse') {
      if (typeof b.board !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(b.board))
        throw Error('Enter the company Greenhouse board token.');
      const url = 'https://boards-api.greenhouse.io/v1/boards/' + b.board + '/jobs?content=true';
      const d = await this.json(url, signal);
      if (!Array.isArray(d.jobs)) throw Error('Invalid job repository response.');
      jobs = d.jobs.slice(0, 2000).flatMap((j) => {
        const apply = publicURL(j.absolute_url, [
          'greenhouse.io',
          ...(employerBoards.find((s) => s.board === b.board)?.hosts || []),
        ]);
        if (!apply || !j.id || !j.title || !j.content) return [];
        return [
          this.normalize(
            {
              id: j.id,
              title: j.title,
              company: employerBoards.find((s) => s.board === b.board)?.company || b.board,
              location: j.location?.name,
              description: j.content,
              url: apply,
            },
            {
              provider: 'greenhouse',
              listingId: String(j.id),
              board: b.board,
              url: 'https://boards-api.greenhouse.io/v1/boards/' + b.board + '/jobs/' + j.id,
              coverage: 'Company board only; published snapshot',
            },
          ),
        ];
      });
      jobs = jobs.filter(
        (j) =>
          (j.title + ' ' + j.description).toLowerCase().includes(b.keyword.toLowerCase()) &&
          (b.country
            ? filterGeography(j.location, country, region, b.location)
            : j.location.toLowerCase().includes(b.location.toLowerCase())),
      );
    } else if (b.provider === 'adzuna') {
      if (!this.adzunaId || !this.adzunaKey)
        throw new JobSourceError(
          'CONFIG_REQUIRED',
          'Job source requires ADZUNA_APP_ID and ADZUNA_APP_KEY on the server.',
          422,
        );
      const url = new URL('https://api.adzuna.com/v1/api/jobs/' + country + '/search/1');
      for (const [k, v] of Object.entries({
        app_id: this.adzunaId,
        app_key: this.adzunaKey,
        what: b.keyword,
        where: [b.location, region].filter(Boolean).join(', '),
        results_per_page: '30',
        'content-type': 'application/json',
      }))
        url.searchParams.set(k, v);
      const d = await this.json(url.href, signal);
      if (!Array.isArray(d.results))
        throw new JobSourceError(
          'INVALID_RESPONSE',
          'Job source returned an invalid search response.',
        );
      sourceTotal = typeof d.count === 'number' ? d.count : null;
      jobs = d.results.flatMap((j) => {
        const apply = publicURL(String(j.redirect_url || '').replace(/^http:\/\//, 'https://'), [
          'adzuna.com.au',
          'adzuna.co.uk',
          'adzuna.co.nz',
          'adzuna.ca',
          'adzuna.sg',
          'adzuna.de',
          'adzuna.fr',
          'adzuna.com',
        ]);
        if (!apply || !j.id || !j.title || !j.description) return [];
        return [
          this.normalize(
            {
              id: j.id,
              title: j.title,
              company: j.company?.display_name,
              location: j.location?.display_name,
              description: j.description,
              url: apply,
              employmentType:
                j.contract_time === 'full_time'
                  ? 'Full-time'
                  : j.contract_time === 'part_time'
                    ? 'Part-time'
                    : null,
              salary:
                j.salary_min || j.salary_max
                  ? {
                      min: j.salary_min ?? null,
                      max: j.salary_max ?? null,
                      currency: geo.currency,
                      period: 'year',
                      basis:
                        Number(j.salary_is_predicted) === 1
                          ? 'Provider estimate'
                          : 'Provider listing; verify currency and period on source',
                    }
                  : null,
            },
            {
              provider: 'adzuna',
              listingId: String(j.id),
              postedAt:
                j.created && !Number.isNaN(Date.parse(j.created))
                  ? new Date(j.created).toISOString()
                  : null,
              applicationChannel: 'aggregator_redirect',
              board: country,
              url: apply,
              coverage: geo.name + ' search API; descriptions may be snippets',
            },
          ),
        ];
      });
    } else
      throw Error(
        'SEEK/Indeed direct search API is not configured. Import an official listing or choose an available public API.',
      );
    const beforeDedup = jobs.length;
    jobs = uniqueJobs(jobs).slice(0, 100);
    signal?.throwIfAborted();

    return {
      jobs,
      count: jobs.length,
      sourceTotal,
      duplicateCount: beforeDedup - jobs.length,
      geography: {
        country,
        countryName: geo.name,
        region,
        city: b.location,
        countryFilter: b.country ? 'selected-country' : 'legacy source scope',
      },
      status: jobs.length ? 'retrieved' : 'no_results',
      limitations: [
        'Imported records are dated snapshots, not a guarantee the position remains open.',
        'No application was submitted.',
        ...(b.provider === 'adzuna'
          ? [
              'Adzuna returns description snippets and at most the first 30 results here.',
              'Adzuna redirect links are recruitment channels, not independently verified employer destinations.',
              'Estimated salaries are provider estimates, not confirmed employer offers.',
            ]
          : []),
      ],
    };
  }
}
