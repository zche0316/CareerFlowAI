import { expect, it } from 'vitest';
import { githubProposal, mergeProposal, type Fetcher } from '../apps/api/src/profile-sources.js';
import { capabilityLevels } from '../packages/contracts/src/capability.js';
import { profileSchema } from '../packages/contracts/src/index.js';
import { demoProfile } from '../scripts/demo-profile.mjs';

// Serves canned JSON for exact URLs; anything else is a 404, as the real APIs would return.
export const fakeFetch =
  (routes: Record<string, unknown>): Fetcher =>
  async (url) =>
    url in routes
      ? new Response(JSON.stringify(routes[url]), { status: 200 })
      : new Response('{}', { status: 404 });

const gh = 'https://api.github.com';
const recent = new Date(Date.now() - 20 * 86400000).toISOString();
const githubRoutes = {
  [`${gh}/users/jordan`]: { login: 'jordan', html_url: 'https://github.com/jordan' },
  [`${gh}/users/jordan/repos?per_page=100&sort=pushed`]: [
    {
      name: 'transit-delays',
      full_name: 'jordan/transit-delays',
      fork: false,
      archived: false,
      description: 'Train delay analysis',
      stargazers_count: 7,
      size: 900,
      created_at: '2024-06-01T00:00:00Z',
      pushed_at: recent,
      html_url: 'https://github.com/jordan/transit-delays',
      languages_url: `${gh}/repos/jordan/transit-delays/languages`,
    },
    {
      name: 'dotfiles',
      full_name: 'jordan/dotfiles',
      fork: true,
      archived: false,
      languages_url: '',
    },
    {
      name: 'churn',
      full_name: 'jordan/churn',
      fork: false,
      archived: false,
      description: '',
      stargazers_count: 0,
      size: 120,
      created_at: '2024-08-01T00:00:00Z',
      pushed_at: '2024-10-01T00:00:00Z',
      html_url: 'https://github.com/jordan/churn',
      languages_url: `${gh}/repos/jordan/churn/languages`,
    },
  ],
  [`${gh}/repos/jordan/transit-delays/languages`]: { Python: 9000, R: 2000 },
  [`${gh}/repos/jordan/transit-delays/contents`]: [{ name: 'tests' }, { name: '.github' }],
  [`${gh}/repos/jordan/churn/languages`]: { Python: 3000 },
  [`${gh}/repos/jordan/churn/contents`]: [{ name: 'README.md' }],
};

it('turns public GitHub repositories into projects and verified evidence', async () => {
  const p = await githubProposal('jordan', fakeFetch(githubRoutes));
  expect(p.projects.map((r) => [r.id, r.current, r.technologies])).toEqual([
    ['gh-transit-delays', true, ['Python', 'R']],
    ['gh-churn', false, ['Python']],
  ]);
  const python = p.verifiedEvidence.find((e) => e.skill === 'Python')!;
  expect(python).toMatchObject({ source: 'github', verified: true, supports: 3 });
  expect(p.verifiedEvidence.find((e) => e.skill === 'R')).toMatchObject({ supports: 3 }); // 900 KB
  expect(p.verifiedEvidence.map((e) => e.skill)).toEqual(
    expect.arrayContaining(['Testing', 'CI/CD']),
  );
  await expect(githubProposal('nobody', fakeFetch({}))).rejects.toMatchObject({
    code: 'SOURCE_NOT_FOUND',
  });
});

it('merges a proposal into a valid profile that raises verified capability levels', async () => {
  const p = await githubProposal('jordan', fakeFetch(githubRoutes));
  const merged = mergeProposal(demoProfile, p);
  expect(profileSchema.safeParse(merged).success).toBe(true);
  // Merging the same source twice adds nothing new.
  const again = mergeProposal(merged, p);
  expect(again.projects.length).toBe(merged.projects.length);
  expect(again.verifiedEvidence.length).toBe(merged.verifiedEvidence.length);
  const levels = capabilityLevels(merged, merged.verifiedEvidence, [], new Date());
  expect(levels.find((s) => s.skill === 'Python')).toMatchObject({ confidence: 'verified' });
});
