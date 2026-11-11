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
    expect(buildJobRecord(job('Great role.', { location: 'Remote' })).arrangement).toEqual({
      value: 'remote',
      quote: 'Remote',
    });
    const flattened = buildJobRecord(
      job(
        'This is a hybrid role covering deal strategy and deal operations. Harvey does not currently offer visa sponsorship for this role WHAT WE OFFER - Structured hybrid working arrangement: 3 days in our Sydney office - Health Coverage: fully covered',
        { location: 'Sydney' },
      ),
    );
    expect(flattened.workRights).toEqual({
      value: 'no_sponsorship',
      quote: 'Harvey does not currently offer visa sponsorship for this role',
    });
    expect(flattened.arrangement).toEqual({
      value: 'hybrid',
      quote: 'Structured hybrid working arrangement: 3 days in our Sydney office',
    });
    const k = buildJobRecord(job('Base salary £40k to £50k.'));
    expect(k.salary).toMatchObject({ min: 40000, max: 50000, currency: 'GBP' });
  });

  it('does not flip negated statements or read incidental words as requirements', () => {
    const r = (description: string, extra: Record<string, unknown> = {}) =>
      buildJobRecord(job(description, { location: 'Sydney NSW', ...extra }));
    expect(r('Sponsorship is not available for this role.').workRights?.value).toBe(
      'no_sponsorship',
    );
    expect(
      r('This is not a remote role; you will be based in our office.').arrangement?.value,
    ).toBe('on-site');
    expect(r('Our corporate citizenship program funds volunteering days.').workRights).toBeNull();
    expect(r('Engage citizens and community groups on the plan.').workRights).toBeNull();
    expect(
      r('You must be an Australian citizen and able to obtain a Baseline security clearance.')
        .workRights?.value,
    ).toBe('clearance');
    expect(r('Hybrid – 1 day per week on site in Bristol.').arrangement?.value).toBe('hybrid');
    expect(buildJobRecord(job('Great role.', { title: 'Office Manager' })).seniority).toBeNull();
    expect(
      buildJobRecord(job('Great role.', { title: 'Engineering Manager' })).seniority?.value,
    ).toBe('lead');
  });

  it('reads common salary shapes and the local currency', () => {
    const s = (description: string, location = 'Sydney NSW') =>
      buildJobRecord(job(description, { location })).salary;
    expect(s('Salary $95,000 + super.')).toMatchObject({ min: 95000, max: 95000 });
    expect(s('Up to $150,000 including superannuation.')).toMatchObject({ min: null, max: 150000 });
    expect(s('Salary from $65,000 plus super.')).toMatchObject({ min: 65000, max: null });
    expect(s('Package: 140-155k + super.')).toMatchObject({ min: 140000, max: 155000 });
    expect(s('salary 130000 to 145000 plus super')).toMatchObject({ min: 130000, max: 145000 });
    expect(s('Pay: 32.50 per hour.')).toMatchObject({ min: 32.5, period: 'hour' });
    expect(s('$95K to $105K depending on experience.')).toMatchObject({ min: 95000, max: 105000 });
    expect(s('SGD 4,500 - 5,500 per month.', 'Singapore')).toMatchObject({
      min: 4500,
      currency: 'SGD',
      period: 'month',
      annualMin: 54000,
    });
    expect(s('Salary range: $110K-$130K.', 'Arlington, VA')).toMatchObject({ currency: 'USD' });
    expect(s('Compensation: $185,000 - $215,000 USD base.')).toMatchObject({ currency: 'USD' });
    // Bonuses and counts are still not salary.
    expect(s('Bonus of $500 for referrals.')).toBeNull();
    expect(s('Base $110,000 + super, OTE $160,000.')).toMatchObject({ min: 110000, max: 110000 });
  });

  it('marks only web pages as unverified vacancies', () => {
    const board = buildJobRecord(job('Great role.', { source: { provider: 'greenhouse' } }));
    expect(board).toMatchObject({ source: 'greenhouse', verified: true });
    const web = buildJobRecord(
      job('Great role.', { source: { provider: 'web', verified: false, fictional: false } }),
    );
    expect(web).toMatchObject({ source: 'web', verified: false, fictional: false });
  });
});
