import { expect, it } from 'vitest';
import { suggestJobSearch } from '../packages/contracts/src/job-search.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
it('suggests editable role/location criteria without returning identity or career evidence', () => {
  const p = {
    ...sampleProfile,
    name: 'Private Name',
    experience: 'Private work history',
    goals: 'Find a data analyst role in Australia',
    location: 'Australia',
  };
  const query = suggestJobSearch(p);
  expect(query).toEqual({ keyword: 'data analyst', location: '' });
  expect(Object.keys(query).sort()).toEqual(['keyword', 'location']);
  expect(JSON.stringify(query)).not.toContain('Private');
});
it('keeps an explicit city and uses supported interests when role inference is uncertain', () => {
  const q = suggestJobSearch({
    ...sampleProfile,
    goals: 'Find a role',
    interests: ['reporting'],
    location: 'Sydney',
  });
  expect(q).toEqual({ keyword: 'reporting', location: 'Sydney' });
});
