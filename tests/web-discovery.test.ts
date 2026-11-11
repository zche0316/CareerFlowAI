import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobRepository } from '../packages/recruitment/src/repository.js';
import { WEB_EXCLUDED_DOMAINS, WEB_PAGE_LIMIT } from '../packages/recruitment/src/web-discovery.js';
import { jobSearchSchema } from '../packages/contracts/src/index.js';
import { buildJobRecord } from '../packages/contracts/src/job-record.js';
import { extractJobPage } from '../packages/agents/src/job-page.js';

const criteria = {
  provider: 'web',
  country: 'au',
  region: '',
  location: 'Sydney',
  keyword: 'data analyst',
};
const reply = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;
const filler =
  ' You will build dashboards, clean data and present findings to the operations team every week.'.repeat(
    8,
  );
const posting = (company = 'Acme Analytics') =>
  `Data Analyst - ${company}\nLocation: Sydney NSW\nAbout the role\nWe are hiring a Data Analyst at ${company}.${filler}\nRequirements\nSQL and Python. Apply via our site.`;
const page = (url: string, raw_content = posting()) => ({ url, content: 'snippet', raw_content });
const good = (text: string) => ({
  isJobPosting: true,
  title: 'Data Analyst',
  titleQuote: 'We are hiring a Data Analyst',
  company: 'Acme Analytics',
  companyQuote: 'Data Analyst at Acme Analytics',
  location: 'Sydney NSW',
  locationQuote: 'Location: Sydney NSW',
  employmentType: text.includes('Full-time') ? 'Full-time' : '',
});
const repoWith = (results: unknown[], calls: any[] = []) =>
  new JobRepository({
    fetcher: (async (url: any, options: any) => {
      calls.push({ url: String(url), options });
      return reply({ results, usage: { credits: 1 } });
    }) as typeof fetch,
  });

beforeEach(() => {
  vi.stubEnv('TAVILY_ACCESS_MODE', 'api_key');
  vi.stubEnv('TAVILY_API_KEY', 'test-only-key');
});
afterEach(() => vi.unstubAllEnvs());

it('turns a quoted page into a normalised web job whose description is the page text', async () => {
  expect(jobSearchSchema.parse(criteria).provider).toBe('web');
  const calls: any[] = [];
  const repo = repoWith(
    [page('https://careers.acme.example/roles/data-analyst?utm_source=x')],
    calls,
  );
  const extractPage = vi.fn(async (p: { url: string; text: string }) => good(p.text));
  const result: any = await repo.search(criteria, { extractPage });
  expect(result.jobs).toHaveLength(1);
  const job = result.jobs[0];
  expect(job).toMatchObject({
    title: 'Data Analyst',
    company: 'Acme Analytics',
    location: 'Sydney NSW',
    applicationUrl: 'https://careers.acme.example/roles/data-analyst',
  });
  expect(job.description).toBe(posting().replace(/\s+/g, ' ').trim());
  expect(job.source).toMatchObject({
    provider: 'web',
    board: 'careers.acme.example',
    verified: false,
    discoveredBy: 'tavily',
    applicationChannel: 'employer_or_board_page',
  });
  expect(job.availability).toMatchObject({
    status: 'seen_on_web_at_retrieval',
    method: 'web-search-page',
  });
  expect(extractPage.mock.calls[0][0].url).toBe('https://careers.acme.example/roles/data-analyst');
  expect(result.discovery).toMatchObject({ pagesFound: 1, pagesRead: 1, accepted: 1 });
  expect(result.limitations.join(' ')).toMatch(/unverified/i);
  expect(buildJobRecord(job)).toMatchObject({ source: 'web', verified: false, fictional: false });
  const body = JSON.parse(calls[0].options.body);
  expect(body).toMatchObject({ include_raw_content: true, exclude_domains: WEB_EXCLUDED_DOMAINS });
  expect(body.include_domains).toBeUndefined();
  for (const d of ['seek.com.au', 'linkedin.com', 'indeed.com', 'jobs.lever.co'])
    expect(body.exclude_domains).toContain(d);
  expect(calls).toHaveLength(1);
});

it('rejects a page whose title quote is not on the page and drops an unquoted location', async () => {
  const repo = repoWith([
    page('https://a.example/job/1'),
    page('https://b.example/job/2', posting('Beta Co')),
  ]);
  const result: any = await repo.search(criteria, {
    extractPage: async (p: { url: string; text: string }) =>
      p.url.includes('a.example')
        ? { ...good(p.text), title: 'Senior Data Analyst', titleQuote: 'Senior Data Analyst role' }
        : {
            ...good(p.text),
            company: 'Beta Co',
            companyQuote: 'Data Analyst at Beta Co',
            locationQuote: 'Based in Melbourne',
          },
  });
  expect(result.jobs.map((j: any) => j.company)).toEqual(['Beta Co']);
  expect(result.jobs[0].location).toBe('Not supplied');
  expect(result.discovery.rejected).toContainEqual({
    url: 'https://a.example/job/1',
    reason: 'Title is not quoted from the page',
  });
});

it('filters listing, short and excluded pages before any model call', async () => {
  const listing = 'Data Analyst Apply now. '.repeat(40) + ' Requirements vary.';
  const repo = repoWith([
    page('https://jobs.example/jobs/', posting()),
    page('https://board.example/role/9', listing),
    page('https://short.example/job/1', 'Data Analyst. Apply today.'),
    page('https://au.indeed.com/viewjob', posting()),
    page('http://plain.example/job/1', posting()),
    page('https://news.example/story/1', 'A long article about data. '.repeat(40)),
  ]);
  const extractPage = vi.fn(async (p: { url: string; text: string }) => good(p.text));
  const result: any = await repo.search(criteria, { extractPage });
  expect(extractPage).not.toHaveBeenCalled();
  expect(result.jobs).toEqual([]);
  expect(result.discovery.pagesRead).toBe(0);
  expect(result.discovery.rejected).toHaveLength(6);
});

it('stops articles and closed postings but lets a small employer careers page through', async () => {
  const article =
    'Career Advice How to become a data analyst By a staff writer 8 minute read. ' +
    'Typical responsibilities include building reports.'.repeat(12) +
    ' Related articles: interview tips.';
  const closed = posting() + ' This position has now closed and has been filled.';
  const repo = repoWith([
    page('https://advice.example/blog/data-analyst', article),
    page('https://acme.example/roles/old', closed),
    page('https://www.smallco.example/careers', posting()),
  ]);
  const extractPage = vi.fn(async (p: { url: string; text: string }) => good(p.text));
  const result: any = await repo.search(criteria, { extractPage });
  expect(extractPage).toHaveBeenCalledTimes(1);
  expect(extractPage.mock.calls[0][0].url).toBe('https://www.smallco.example/careers');
  expect(result.discovery.rejected).toEqual([
    { url: 'https://advice.example/blog/data-analyst', reason: 'Looks like an article' },
    { url: 'https://acme.example/roles/old', reason: 'Posting has closed' },
  ]);
});

it('reads at most the page limit and keeps search order', async () => {
  vi.stubEnv('TAVILY_ACCESS_MODE', 'api_key');
  const results = Array.from({ length: 10 }, (_, i) => page(`https://p${i}.example/job/${i}`));
  const extractPage = vi.fn(async (p: { url: string; text: string }) => good(p.text));
  const result: any = await repoWith(results).search(criteria, { extractPage });
  expect(extractPage).toHaveBeenCalledTimes(WEB_PAGE_LIMIT);
  expect(result.jobs).toHaveLength(WEB_PAGE_LIMIT);
  expect(result.jobs[0].applicationUrl).toBe('https://p0.example/job/0');
  expect(result.discovery).toMatchObject({ pagesFound: 10, pagesRead: WEB_PAGE_LIMIT });
});

it('records a failed page read as rejected without failing the search', async () => {
  const repo = repoWith([page('https://a.example/job/1'), page('https://b.example/job/2')]);
  const result: any = await repo.search(criteria, {
    extractPage: async (p: { url: string; text: string }) => {
      if (p.url.includes('a.example')) throw Error('model timeout');
      return good(p.text);
    },
  });
  expect(result.jobs).toHaveLength(1);
  expect(result.discovery.rejected).toContainEqual({
    url: 'https://a.example/job/1',
    reason: 'Could not read this page',
  });
});

it('needs Tavily and a page reader', async () => {
  vi.stubEnv('TAVILY_API_KEY', '');
  const repo = repoWith([]);
  await expect(repo.search(criteria, { extractPage: async () => good('') })).rejects.toMatchObject({
    code: 'CONFIG_REQUIRED',
  });
  vi.stubEnv('TAVILY_API_KEY', 'test-only-key');
  await expect(repo.search(criteria)).rejects.toMatchObject({ code: 'CONFIG_REQUIRED' });
});

it('includes web in automatic search only when a page reader is supplied', async () => {
  const repo = new JobRepository({ adzunaId: '', adzunaKey: '' });
  const original = repo.search.bind(repo);
  const called: string[] = [];
  const spy = vi
    .spyOn(repo, 'search')
    .mockImplementation(async (c: any, options?: any): Promise<any> => {
      if (c.provider === 'auto') return original(c, options);
      called.push(c.provider);
      if (c.provider === 'web')
        return {
          jobs: [{ id: 'w', applicationUrl: 'https://w.example/job/1' }],
          discovery: { provider: 'web', pagesFound: 3, pagesRead: 1, accepted: 1, rejected: [] },
          limitations: ['Vacancy status is unverified.'],
        };
      return { jobs: [], sources: [], limitations: [] };
    });
  try {
    await repo.search({ ...criteria, provider: 'auto' });
    expect(called).not.toContain('web');
    called.length = 0;
    const combined: any = await repo.search(
      { ...criteria, provider: 'auto' },
      { extractPage: async () => good('') },
    );
    expect(called).toEqual(['employers', 'tavily', 'web']);
    expect(combined.jobs).toHaveLength(1);
    expect(combined.webDiscovery).toMatchObject({ provider: 'web', accepted: 1 });
    expect(combined.sources).toContainEqual({ provider: 'web', status: 'retrieved', count: 1 });
    expect(combined.limitations).toContain('Vacancy status is unverified.');
  } finally {
    spy.mockRestore();
  }
});

it('fixture mode never accepts a web page', async () => {
  const hooks = { onCall: vi.fn(), onTool: async () => {}, onUsage: async () => {} };
  const out = await extractJobPage(
    { url: 'https://a.example/job/1', text: posting() },
    'fixture',
    hooks as any,
  );
  expect(out.isJobPosting).toBe(false);
  expect(hooks.onCall).not.toHaveBeenCalled();
});
