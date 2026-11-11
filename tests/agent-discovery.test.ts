import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobRepository } from '../packages/recruitment/src/repository.js';
import {
  discoverAgent,
  publicUrl,
  robotsAllow,
} from '../packages/recruitment/src/agent-discovery.js';
import { buildJobRecord } from '../packages/contracts/src/job-record.js';
import { jobSearchSchema } from '../packages/contracts/src/index.js';
import { searchJobsWithModel } from '../packages/agents/src/job-search-agent.js';

const seekRobots = 'User-agent: *\nDisallow: */job/\nDisallow: *?\nAllow: *?keywords\n';
const employerPage = (title: string, company: string) =>
  `${company} Careers ${title} Sydney NSW Full-time About the role You will build reports. Apply now.`;

beforeEach(() => {
  vi.stubEnv('TAVILY_ACCESS_MODE', 'api_key');
  vi.stubEnv('TAVILY_API_KEY', 'test-only-key');
});
afterEach(() => vi.unstubAllEnvs());

it('reads robots.txt rules with longest match and the wildcard group', () => {
  expect(robotsAllow(seekRobots, new URL('https://au.seek.com/job/95737299'))).toBe(false);
  expect(robotsAllow(seekRobots, new URL('https://au.seek.com/graduates'))).toBe(true);
  expect(robotsAllow('User-agent: *\nDisallow: /', new URL('https://x.example/a'))).toBe(false);
  expect(robotsAllow('', new URL('https://x.example/a'))).toBe(true);
  expect(
    robotsAllow(
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/jobs',
      new URL('https://x.example/private/jobs/1'),
    ),
  ).toBe(true);
});

it('accepts only public https links and drops tracking parameters', () => {
  expect(publicUrl('https://jobs.example.com/a?utm_source=x&id=3')?.href).toBe(
    'https://jobs.example.com/a?id=3',
  );
  for (const bad of [
    'http://jobs.example.com/a',
    'https://127.0.0.1/a',
    'https://localhost/a',
    'https://intranet/a',
    'https://jobs.example.com:8443/a',
    'https://router.home/a',
    'not a url',
  ])
    expect(publicUrl(bad)).toBeNull();
});

it('checks each reported role and keeps unreadable ones as leads', async () => {
  const calls: string[] = [];
  const repo = new JobRepository({
    fetcher: (async (url: any, options: any) => {
      const u = String(url);
      calls.push(u);
      if (u === 'https://au.seek.com/robots.txt') return new Response(seekRobots, { status: 200 });
      if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (u === 'https://api.tavily.com/extract') {
        const body = JSON.parse(options.body);
        expect(body.urls).not.toContain('https://au.seek.com/job/1');
        return new Response(
          JSON.stringify({
            results: [
              {
                url: 'https://careers.acme.example/jobs/1',
                raw_content: employerPage('Graduate Data Analyst', 'Acme'),
              },
              {
                url: 'https://careers.acme.example/jobs/2',
                raw_content: 'Acme Careers. This job is no longer available.',
              },
              {
                url: 'https://careers.beta.example/jobs/3',
                raw_content: employerPage('Senior Engineer', 'Beta'),
              },
            ],
            failed_results: [{ url: 'https://careers.gamma.example/jobs/4' }],
          }),
          { status: 200 },
        );
      }
      throw Error('unexpected request ' + u);
    }) as typeof fetch,
  });
  const searchAgent = vi.fn(async () => ({
    model: 'test-model',
    searches: 7,
    pagesOpened: 5,
    jobs: [
      {
        title: 'Graduate Data Analyst',
        company: 'Acme',
        location: 'Sydney',
        url: 'https://careers.acme.example/jobs/1?utm_source=x',
        source: 'job page',
        quote: 'Graduate Data Analyst',
      },
      {
        title: 'Graduate Data Analyst',
        company: 'Acme',
        location: 'Sydney',
        url: 'https://careers.acme.example/jobs/1',
        source: 'job page',
        quote: '',
      },
      {
        title: 'Junior Analyst',
        company: 'Acme',
        location: 'Sydney',
        url: 'https://careers.acme.example/jobs/2',
        source: 'job page',
        quote: '',
      },
      {
        title: 'Graduate Data Analyst',
        company: 'Beta',
        location: 'Sydney',
        url: 'https://careers.beta.example/jobs/3',
        source: 'job page',
        quote: '',
      },
      {
        title: 'Data Analyst',
        company: 'Gamma',
        location: 'Sydney',
        url: 'https://careers.gamma.example/jobs/4',
        source: 'job page',
        quote: '',
      },
      {
        title: 'Graduate Performance Analyst',
        company: 'Transit Systems',
        location: 'Hoxton Park',
        url: 'https://au.seek.com/job/1',
        source: 'job page',
        quote: 'Graduate Performance Analyst',
      },
      {
        title: 'Junior Data Analyst',
        company: 'Delta',
        location: 'Sydney',
        url: 'https://au.indeed.com/q-junior-data-analyst-l-sydney-nsw-jobs.html',
        source: 'list page',
        quote: 'Junior Data Analyst',
      },
      {
        title: 'Intranet role',
        company: 'X',
        location: '',
        url: 'https://localhost/job',
        source: '',
        quote: '',
      },
    ],
  }));
  expect(jobSearchSchema.parse({ provider: 'agent' }).provider).toBe('agent');
  const result: any = await repo.search(
    {
      provider: 'agent',
      country: 'au',
      region: '',
      location: 'Sydney',
      keyword: 'graduate data analyst',
    },
    { searchAgent },
  );
  expect(searchAgent).toHaveBeenCalledWith({
    keyword: 'graduate data analyst',
    location: 'Sydney',
    countryName: 'Australia',
    countryCode: 'au',
  });
  // The localhost link is refused before any request is made.
  expect(calls.some((u) => u.includes('localhost'))).toBe(false);
  const checked = result.jobs.filter((j: any) => !j.source.lead);
  const leads = result.jobs.filter((j: any) => j.source.lead);
  expect(checked.map((j: any) => j.title)).toEqual(['Graduate Data Analyst']);
  expect(checked[0].description).toContain('About the role');
  expect(checked[0].source).toMatchObject({
    provider: 'agent',
    pageChecked: true,
    verified: false,
  });
  expect(leads.map((j: any) => [j.title, j.source.leadReason])).toEqual([
    ['Graduate Performance Analyst', 'The site does not allow automated reading'],
    ['Junior Data Analyst', 'The link is a search results page; find the role there by its title'],
    ['Data Analyst', 'The page could not be read'],
  ]);
  // A lead's description is only the model's quote, never page text.
  expect(leads[0].description).toBe('Graduate Performance Analyst');
  expect(result.discovery).toMatchObject({
    provider: 'agent',
    searches: 7,
    reported: 8,
    checked: 1,
    leads: 3,
  });
  expect(result.discovery.rejected.map((r: any) => r.reason)).toEqual([
    'No usable public link',
    'Page says the role is closed or gone',
    'Title is not on the page',
  ]);
  const record = buildJobRecord(leads[0]);
  expect(record).toMatchObject({ source: 'agent', verified: false, lead: true });
  expect(buildJobRecord(checked[0])).toMatchObject({ lead: false, leadReason: null });
});

it('needs a model search function and never runs in fixture mode', async () => {
  await expect(
    discoverAgent(new JobRepository(), { keyword: 'x', location: '', country: 'au' }),
  ).rejects.toMatchObject({ code: 'CONFIG_REQUIRED' });
  await expect(
    searchJobsWithModel(
      { keyword: 'x', location: '', countryName: 'Australia', countryCode: 'au' },
      'fixture',
      { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_REQUIRED' });
});
