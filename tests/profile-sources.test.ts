import { expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  certificateProposal,
  codeforcesProposal,
  githubProposal,
  leetCodeProposal,
  stackOverflowProposal,
  linkedInProposal,
  mergeProposal,
  parseCsv,
  readUpload,
  websiteProposal,
  type Fetcher,
} from '../apps/api/src/profile-sources.js';
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

it('verifies Open Badges certificates and keeps other links unverified', async () => {
  const badge = 'https://badges.example/b/1';
  const p = await certificateProposal(
    [badge, 'https://example.com/cert/2'],
    fakeFetch({
      [badge]: {
        '@context': 'https://w3id.org/openbadges/v2',
        type: 'Assertion',
        issuedOn: '2026-03-02T00:00:00Z',
        badge: 'https://badges.example/class/aws',
      },
      'https://badges.example/class/aws': {
        name: 'AWS Certified Solutions Architect – Professional',
        issuer: 'https://badges.example/issuer',
      },
      'https://badges.example/issuer': { name: 'Amazon Web Services Training and Certification' },
    }),
  );
  expect(p.educations).toHaveLength(1);
  expect(p.educations[0]).toMatchObject({
    title: 'AWS Certified Solutions Architect – Professional',
    endMonth: '2026-03',
  });
  expect(p.verifiedEvidence[0]).toMatchObject({ skill: 'AWS', verified: true, supports: 3 });
  expect(p.warnings[0]).toContain('https://example.com/cert/2');
});

it('reads the LinkedIn data export ZIP', () => {
  const csv = (rows: string[][]) =>
    rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const zip = zipSync({
    'Positions.csv': strToU8(
      csv([
        ['Company Name', 'Title', 'Description', 'Location', 'Started On', 'Finished On'],
        [
          'Northwind Logistics',
          'Data Analyst Intern',
          '- Wrote SQL reports\n- Built a "Power BI" dashboard',
          'Sydney',
          'Dec 2024',
          'Feb 2025',
        ],
      ]),
    ),
    'Skills.csv': strToU8(csv([['Name'], ['SQL'], ['Python']])),
    'Notes.txt': strToU8('ignored'),
  });
  const p = linkedInProposal(readUpload(Buffer.from(zip).toString('base64')));
  expect(p.workExperiences[0]).toMatchObject({
    organisation: 'Northwind Logistics',
    startMonth: '2024-12',
    endMonth: '2025-02',
    details: ['Wrote SQL reports', 'Built a "Power BI" dashboard'],
  });
  expect(p.skills).toEqual(['SQL', 'Python']);
  expect(p.verifiedEvidence).toEqual([]);
  expect(parseCsv('note line\n"A","B"\n"1","x, y"')).toEqual([{ A: '1', B: 'x, y' }]);
});

it('reads project sections from a personal site and respects robots.txt', async () => {
  const site = 'https://jordan.dev/projects';
  const html = `<html><nav><h2>Menu</h2><p>Home and contact links for the whole site</p></nav>
    <h1>Projects</h1>
    <h2>Transit delays</h2><p>Analysed train delays with Python and pandas, published charts.</p>
    <h3>Churn model</h3><p>Trained a churn classifier in Python with a SQL feature store.</p></html>`;
  const p = await websiteProposal(site, fakeFetch({}) as any).catch((e) => e);
  expect(p.code).toBe('SOURCE_UNAVAILABLE');
  const ok = await websiteProposal(site, async (u) =>
    u.endsWith('robots.txt') ? new Response('User-agent: *\nAllow: /') : new Response(html),
  );
  expect(ok.projects.map((r) => [r.title, r.technologies])).toEqual([
    ['Transit delays', ['Python', 'pandas']],
    ['Churn model', ['Python', 'SQL']],
  ]);
  await expect(
    websiteProposal(site, async (u) =>
      u.endsWith('robots.txt') ? new Response('User-agent: *\nDisallow: /') : new Response(html),
    ),
  ).rejects.toMatchObject({ code: 'ROBOTS_DISALLOWED' });
});

it('reads algorithm evidence from Codeforces and per-tag evidence from Stack Overflow', async () => {
  const cf = await codeforcesProposal(
    'jordan_e',
    fakeFetch({
      'https://codeforces.com/api/user.info?handles=jordan_e': {
        status: 'OK',
        result: [
          {
            handle: 'jordan_e',
            rating: 1420,
            maxRating: 1510,
            rank: 'specialist',
            maxRank: 'specialist',
          },
        ],
      },
      'https://codeforces.com/api/user.rating?handle=jordan_e': {
        status: 'OK',
        result: [{ ratingUpdateTimeSeconds: 1760000000 }, { ratingUpdateTimeSeconds: 1762000000 }],
      },
    }),
  );
  expect(cf.verifiedEvidence[0]).toMatchObject({
    skill: 'Algorithms',
    verified: true,
    supports: 3,
  });
  const so = await stackOverflowProposal(
    '42',
    fakeFetch({
      'https://api.stackexchange.com/2.3/users/42?site=stackoverflow': {
        items: [
          { display_name: 'Jordan', reputation: 2100, link: 'https://stackoverflow.com/users/42' },
        ],
      },
      'https://api.stackexchange.com/2.3/users/42/top-tags?site=stackoverflow&pagesize=8': {
        items: [
          { tag_name: 'postgresql', answer_count: 12, answer_score: 41 },
          { tag_name: 'pandas', answer_count: 3, answer_score: 5 },
          { tag_name: 'excel', answer_count: 0, answer_score: 0 },
        ],
      },
    }),
  );
  expect(so.verifiedEvidence.map((e) => [e.skill, e.supports])).toEqual([
    ['PostgreSQL', 3],
    ['pandas', 2],
  ]);
});

it('keeps LeetCode numbers self-reported when the profile cannot be read', async () => {
  const fromSite = await leetCodeProposal(
    { username: 'jordan' },
    async () =>
      new Response(
        JSON.stringify({
          data: {
            matchedUser: {
              submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: 320 }] },
            },
          },
        }),
      ),
  );
  expect(fromSite.verifiedEvidence[0]).toMatchObject({ verified: true, supports: 3 });
  const down = async () => new Response('blocked', { status: 403 });
  const manual = await leetCodeProposal({ username: 'jordan', solved: 80 }, down);
  expect(manual.verifiedEvidence[0]).toMatchObject({ verified: false, supports: 2 });
  await expect(leetCodeProposal({ username: 'jordan' }, down)).rejects.toMatchObject({
    code: 'SOURCE_UNAVAILABLE',
  });
});
