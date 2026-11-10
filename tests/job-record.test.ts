import { describe, expect, it } from 'vitest';
import { buildJobRecord, quoteInSource } from '../packages/contracts/src/job-record.js';

const job = (description: string, extra: Record<string, unknown> = {}) => ({
  id: 'j1',
  title: 'Graduate Data Analyst',
  company: 'Example',
  location: 'Sydney NSW (Hybrid)',
  description,
  ...extra,
});

describe('job record', () => {
  it('extracts work rights, arrangement, seniority and salary with literal quotes', () => {
    const description =
      'Join our analytics team. You must be an Australian citizen or permanent resident. ' +
      'Salary: $80,000 - $95,000 per annum plus super. We work from the office three days a week.';
    const r = buildJobRecord(job(description));
    expect(r.workRights).toEqual({
      value: 'citizen_or_pr',
      quote: 'You must be an Australian citizen or permanent resident.',
    });
    expect(r.arrangement).toEqual({ value: 'hybrid', quote: 'Sydney NSW (Hybrid)' });
    expect(r.seniority).toEqual({ value: 'graduate', quote: 'Graduate Data Analyst' });
    expect(r.salary).toMatchObject({
      min: 80000,
      max: 95000,
      currency: 'AUD',
      period: 'year',
      annualMin: 80000,
      basis: 'listing text',
    });
    for (const quote of [r.workRights!.quote, r.salary!.quote!])
      expect(quoteInSource(description, quote)).toBe(true);
  });

  it('leaves fields empty when the listing does not state them', () => {
    const r = buildJobRecord({
      id: 'j2',
      title: 'Data Analyst',
      company: 'Example',
      location: 'Sydney',
      description: 'Build SQL reports for 3 teams. Bonus of $500 for referrals.',
    });
    expect(r.workRights).toBeNull();
    expect(r.arrangement).toBeNull();
    expect(r.seniority).toBeNull();
    expect(r.salary).toBeNull();
  });

  it('prefers the provider salary field and annualises hourly and k figures', () => {
    const provider = buildJobRecord(
      job('Great role.', { salary: { min: 70000, max: null, currency: 'AUD', period: 'year' } }),
    );
    expect(provider.salary).toMatchObject({ min: 70000, basis: 'provider field', quote: null });
    const hourly = buildJobRecord(job('Pay is $45 per hour. We do not offer visa sponsorship.'));
    expect(hourly.salary).toMatchObject({ min: 45, period: 'hour', annualMin: 88920 });
    expect(hourly.workRights?.value).toBe('no_sponsorship');
    const k = buildJobRecord(job('Base salary £40k to £50k.'));
    expect(k.salary).toMatchObject({ min: 40000, max: 50000, currency: 'GBP' });
  });
});
