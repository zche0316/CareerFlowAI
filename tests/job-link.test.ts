import { expect, it } from 'vitest';
import { resolveJobLink, supportedJobURL } from '../packages/recruitment/src/job-link.js';
import { JobRepository } from '../packages/recruitment/src/repository.js';
const url = 'https://www.linkedin.com/jobs/view/business-analyst-1234567890';
const structured = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Business Analyst',
  hiringOrganization: { name: 'Example' },
  jobLocation: { address: { addressLocality: 'Sydney', addressCountry: 'Australia' } },
  description: '<p>Analyse SQL reporting requirements and document the agreed process.</p>',
};
it('reads a LinkedIn public structured listing without fetching arbitrary destinations or inventing availability', async () => {
  const calls: string[] = [];
  const repo = new JobRepository({
    fetcher: async (u: any) => {
      calls.push(String(u));
      return new Response(
        `<html><script type="application/ld+json">${JSON.stringify(structured)}</script></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      );
    },
  });
  const job = await resolveJobLink(url + '?tracking=x', { repo });
  expect(calls).toEqual([url]);
  expect(job).toMatchObject({
    title: 'Business Analyst',
    company: 'Example',
    location: 'Sydney, Australia',
    salary: null,
    source: {
      name: 'LinkedIn',
      liveVacancy: false,
      externalListing: true,
      fetchedVia: 'public-page',
    },
  });
  expect(job.description).toContain('SQL reporting requirements');
});
it('rejects private, lookalike and credentialed links and blocks unsafe redirects before fetching them', async () => {
  for (const link of [
    'http://www.linkedin.com/jobs/view/123',
    'https://127.0.0.1/job/1',
    'https://www.linkedin.com.evil.test/jobs/view/123',
    'https://user:pass@www.linkedin.com/jobs/view/123',
  ])
    expect(() => supportedJobURL(link)).toThrow();
  let calls = 0;
  const repo = new JobRepository({
    fetcher: async () => {
      calls++;
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    },
  });
  await expect(resolveJobLink(url, { repo })).rejects.toThrow();
  expect(calls).toBe(1);
});
it('reports blocked and expired public listings without a guessed job', async () => {
  const blocked = new JobRepository({ fetcher: async () => new Response('', { status: 403 }) });
  await expect(resolveJobLink(url, { repo: blocked })).rejects.toThrow('HTTP 403');
  const expired = new JobRepository({
    fetcher: async () =>
      new Response(
        `<script type="application/ld+json">${JSON.stringify({ ...structured, validThrough: '2020-01-01' })}</script>`,
        { headers: { 'Content-Type': 'text/html' } },
      ),
  });
  await expect(resolveJobLink(url, { repo: expired })).rejects.toThrow('expired');
});
it('grounds model parsing in the retrieved page and rejects invented company facts', async () => {
  const repo = new JobRepository({
    fetcher: async () =>
      new Response(
        'Business Analyst Example Sydney Requirements: document SQL reporting requirements.',
        { headers: { 'Content-Type': 'text/html' } },
      ),
  });
  const parsed = {
    title: 'Business Analyst',
    company: 'Example',
    location: 'Sydney',
    description: 'Requirements: document SQL reporting requirements.',
  };
  expect((await resolveJobLink(url, { repo, parseText: async () => parsed })).title).toBe(
    'Business Analyst',
  );
  await expect(
    resolveJobLink(url, { repo, parseText: async () => ({ ...parsed, company: 'Invented' }) }),
  ).rejects.toThrow('grounded');
});

it('resolves a known corporate career URL through its official board identity', async () => {
  const link = 'https://www.akunacapital.com/careers/job/123/?gh_jid=123';
  const repo = new JobRepository({
    fetcher: async (u: any) => {
      expect(String(u)).toBe('https://boards-api.greenhouse.io/v1/boards/akunacapital/jobs/123');
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 123,
            title: 'Analyst',
            content: 'Work with SQL reporting and analysis.',
            location: { name: 'Sydney' },
            absolute_url: link,
          }),
      } as Response;
    },
  });
  const job = await resolveJobLink(link, { repo });
  expect(job.company).toBe('Akuna Capital');
  expect(job.source.liveVacancy).toBe(true);
});
