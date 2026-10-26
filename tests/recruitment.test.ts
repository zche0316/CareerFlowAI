import { expect, it } from 'vitest';
import { JobRepository } from '../packages/recruitment/src/repository.js';
const query = {
  provider: 'greenhouse',
  board: 'example',
  country: 'au',
  region: '',
  location: '',
  keyword: '',
};
const response = (data: unknown) =>
  ({ ok: true, text: async () => JSON.stringify(data) }) as Response;
it('fetches real board data and excludes explicit foreign countries and uncertain remote locations', async () => {
  let requested = '';
  const repo = new JobRepository({
    fetcher: async (url: any) => {
      requested = String(url);
      return response({
        jobs: [
          ['1', 'Sydney, Australia'],
          ['2', 'London, United Kingdom'],
          ['3', 'Remote'],
        ].map(([id, location]) => ({
          id,
          title: 'Engineer',
          content: '<p>Python and SQL</p>',
          location: { name: location },
          absolute_url: `https://boards.greenhouse.io/example/jobs/${id}`,
        })),
      });
    },
  });
  const result = await repo.search(query);
  expect(requested).toBe('https://boards-api.greenhouse.io/v1/boards/example/jobs?content=true');
  expect(result.jobs).toHaveLength(1);
  expect(result.jobs[0].source.liveVacancy).toBe(true);
  expect(result.jobs[0].description).toBe('Python and SQL');
});
it('rejects a region outside the selected country before any API request', async () => {
  const repo = new JobRepository({
    fetcher: async () => {
      throw Error('must not fetch');
    },
  });
  await expect(repo.search({ ...query, region: 'California' })).rejects.toThrow(/Region/);
});
it('surfaces source errors without substituting offline sample jobs', async () => {
  const repo = new JobRepository({
    fetcher: async () => {
      throw Error('network');
    },
  });
  await expect(repo.search(query)).rejects.toThrow(/unavailable/);
});
it('requires separate Adzuna credentials', async () => {
  const repo = new JobRepository({ adzunaId: '', adzunaKey: '' });
  await expect(repo.search({ ...query, provider: 'adzuna' })).rejects.toThrow(/ADZUNA/);
});
it('routes country-wide searches to the selected country and region', async () => {
  let requested = '';
  const repo = new JobRepository({
    adzunaId: 'test-id',
    adzunaKey: 'test-key',
    fetcher: async (url: any) => {
      requested = String(url);
      return response({ results: [] });
    },
  });
  await repo.search({
    ...query,
    provider: 'adzuna',
    country: 'us',
    region: 'California',
    location: 'San Francisco',
  });
  const u = new URL(requested);
  expect(u.pathname).toBe('/v1/api/jobs/us/search/1');
  expect(u.searchParams.get('where')).toBe('San Francisco, California');
});

it('imports only allowlisted listing URLs without fetching or claiming verification', async () => {
  const repo = new JobRepository({
    fetcher: async () => {
      throw Error('must not fetch');
    },
  });
  const listing = {
    url: 'https://www.seek.com.au/job/123456?tracking=x',
    title: 'Analyst',
    company: 'Example',
    location: 'Sydney, Australia',
    description: 'Python and SQL are useful for this role.',
  };
  const r = await repo.search({ ...query, provider: 'manual', listing });
  expect(r.jobs[0].applicationUrl).toBe('https://www.seek.com.au/job/123456');
  expect(r.jobs[0].source.externalListing).toBe(true);
  expect(r.jobs[0].source.liveVacancy).toBe(false);
  await expect(
    repo.search({
      ...query,
      provider: 'manual',
      listing: { ...listing, url: 'https://example.test/job/123' },
    }),
  ).rejects.toThrow(/SEEK/);
});

it('queries multiple employers concurrently, discloses partial failures and keeps real source identities', async () => {
  const repo = new JobRepository({
    fetcher: async (url: any) => {
      const u = String(url);
      if (u.includes('/vgw/')) throw Error('outage');
      const board = u.match(/boards\/([^/]+)/)?.[1];
      return response({
        jobs: [
          {
            id: 42,
            title: 'Engineer',
            content: 'SQL and Python engineering role',
            location: { name: 'Sydney, Australia' },
            absolute_url:
              board === 'mongodb'
                ? 'https://www.mongodb.com/careers/job/?gh_jid=42'
                : `https://job-boards.greenhouse.io/${board}/jobs/42`,
          },
        ],
      });
    },
  });
  const r = await repo.search({ ...query, provider: 'employers' });
  expect(r.jobs).toHaveLength(3);
  expect(r.sources?.find((s: any) => s.board === 'vgw')?.status).toBe('unavailable');
  expect(r.jobs.every((j: any) => j.source.listingId === '42')).toBe(true);
  expect(r.jobs.find((j: any) => j.company === 'MongoDB')?.applicationUrl).toContain('mongodb.com');
  expect(r.limitations.join(' ')).toContain('VGW');
});
it('fails clearly when all employer APIs fail rather than returning fixture jobs', async () => {
  const repo = new JobRepository({
    fetcher: async () => {
      throw Error('offline');
    },
  });
  await expect(repo.search({ ...query, provider: 'employers' })).rejects.toThrow(
    /All official employer sources/,
  );
});
it('checks current official vacancy identity and rejects closed or redirected listings', async () => {
  const job = {
    source: { provider: 'greenhouse', board: 'spaceship', listingId: '123' },
    applicationUrl: 'https://job-boards.greenhouse.io/spaceship/jobs/123',
  };
  const open = new JobRepository({
    fetcher: async () => response({ id: 123, absolute_url: job.applicationUrl }),
  });
  expect((await open.revalidate(job)).status).toBe('published_at_check');
  const closed = new JobRepository({
    fetcher: async () => ({ ok: false, status: 404 }) as Response,
  });
  expect((await closed.revalidate(job)).status).toBe('closed_or_removed');
  const changed = new JobRepository({
    fetcher: async () => response({ id: 123, absolute_url: 'https://example.test/fake' }),
  });
  await expect(changed.revalidate(job)).rejects.toThrow(/changed/);
});
it('does not classify a failed recheck or a manual import as a confirmed live vacancy', async () => {
  const repo = new JobRepository({
    fetcher: async () => {
      throw Error('outage');
    },
  });
  await expect(
    repo.revalidate({ source: { provider: 'greenhouse', board: 'spaceship', listingId: '123' } }),
  ).rejects.toThrow(/unavailable/);
  expect((await repo.revalidate({ source: { provider: 'manual' } })).status).toBe('unverified');
});

it('normalizes and deduplicates Adzuna results, preserving missing and estimated salary information', async () => {
  const { JobRepository } = await import('../packages/recruitment/src/repository.js');
  const row = {
    id: '1',
    title: 'Data Analyst',
    description: 'SQL reporting and Python analysis',
    company: { display_name: 'Employer' },
    location: { display_name: 'Sydney, NSW' },
    redirect_url: 'http://www.adzuna.com.au/jobs/land/ad/1',
    salary_min: 70000,
    salary_is_predicted: '0',
  };
  const repo = new JobRepository({
    adzunaId: 'test-id',
    adzunaKey: 'test-key',
    fetcher: async () =>
      response({
        count: 100,
        results: [
          row,
          row,
          {
            ...row,
            id: '2',
            redirect_url: 'https://www.adzuna.com.au/jobs/land/ad/2',
            salary_min: undefined,
            salary_max: undefined,
          },
          {
            ...row,
            id: '3',
            redirect_url: 'https://www.adzuna.com.au/jobs/land/ad/3',
            salary_is_predicted: '1',
          },
        ],
      }),
  });
  const r = await repo.search({ ...query, provider: 'adzuna', country: 'au' });
  expect(r.jobs).toHaveLength(3);
  expect(r.duplicateCount).toBe(1);
  expect(r.sourceTotal).toBe(100);
  expect(r.jobs[0].salary?.basis).not.toBe('Provider estimate');
  expect(r.jobs[1].salary).toBeNull();
  expect(r.jobs[2].salary?.basis).toBe('Provider estimate');
  expect(r.jobs[0].availability.method).toBe('aggregator-search-api');
  expect(r.jobs[0].source.fetchedAt).toBeTruthy();
  expect(r.jobs[0].applicationUrl).toBe('https://www.adzuna.com.au/jobs/land/ad/1');
});
it('preserves empty Adzuna searches as no results, never sample data', async () => {
  const repo = new JobRepository({
    adzunaId: 'id',
    adzunaKey: 'key',
    fetcher: async () => response({ count: 0, results: [] }),
  });
  const r = await repo.search({ ...query, provider: 'adzuna' });
  expect(r.status).toBe('no_results');
  expect(r.jobs).toEqual([]);
});
it('discloses rate limits and Retry-After without exposing provider credentials', async () => {
  const repo = new JobRepository({
    adzunaId: 'secret-id',
    adzunaKey: 'secret-key',
    fetcher: async () =>
      ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '30' }) }) as Response,
  });
  try {
    await repo.search({ ...query, provider: 'adzuna' });
    throw Error('Expected failure');
  } catch (e) {
    const error = e as any;
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfter).toBe(30);
    expect(error.message).toContain('30 seconds');
    expect(error.message).not.toContain('secret');
  }
});
it('distinguishes rejected credentials and a timed-out source', async () => {
  const rejected = new JobRepository({
    fetcher: async () => ({ ok: false, status: 401 }) as Response,
  });
  await expect(rejected.search(query)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  const timeout = new JobRepository({
    fetcher: async () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
  });
  await expect(timeout.search(query)).rejects.toMatchObject({ code: 'TIMEOUT' });
});
it('reads recruitment defaults and exports only credential availability', async () => {
  const { recruitmentSettings } = await import('../packages/recruitment/src/repository.js');
  const settings = recruitmentSettings({
    JOB_SOURCE: 'adzuna',
    ADZUNA_COUNTRY: 'au',
    ADZUNA_APP_ID: 'secret-id',
    ADZUNA_APP_KEY: 'secret-key',
  });
  expect(settings.defaults).toEqual({ provider: 'adzuna', country: 'au' });
  expect(settings.adzunaConfigured).toBe(true);
  expect(JSON.stringify(settings)).not.toContain('secret');
});
