import { describe, expect, it } from 'vitest';
import { experienceRank, formatTenure, workMonths } from '../apps/web/src/quest/experience-rank.js';

const now = new Date(2026, 10, 14); // November 2026

describe('experience rank', () => {
  it('counts overlapping jobs once and ignores courses and personal projects', () => {
    expect(
      workMonths(
        [
          { experienceType: 'work', startMonth: '2024-01', endMonth: '2024-12' },
          { experienceType: 'work', startMonth: '2024-07', endMonth: '2025-06' },
          { experienceType: 'course', startMonth: '2020-01', endMonth: '2023-12' },
          { experienceType: 'personal', startMonth: '2023-01', current: true },
        ],
        now,
      ),
    ).toBe(18);
  });

  it('counts a current job up to this month', () => {
    expect(workMonths([{ startMonth: '2026-01', current: true }], now)).toBe(11);
  });

  it('prefers the years stated in the approved profile', () => {
    const r = experienceRank(
      { experienceYears: 3, workExperiences: [{ startMonth: '2026-01', current: true }] },
      [],
      now,
    );
    expect(r.rank.name).toBe('Adventurer');
    expect(r.source).toBe('profile');
    expect(r.next?.name).toBe('Veteran');
    expect(r.toNext).toBe(2);
  });

  it('starts at Rookie with no work and compares against what listings ask', () => {
    const r = experienceRank({}, [
      { requirements: { experienceYears: 2 } },
      { requirements: { experienceYears: null } },
      { requirements: { experienceYears: 0 } },
    ]);
    expect(r.rank.name).toBe('Rookie');
    expect(r.source).toBe('none');
    expect(r.roles).toEqual({ stated: 2, above: 1 });
  });

  it('formats tenure in plain words', () => {
    expect(formatTenure(0)).toBe('No paid work yet');
    expect(formatTenure(8)).toBe('8 months');
    expect(formatTenure(27)).toBe('2 years 3 months');
  });
});
