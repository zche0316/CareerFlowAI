// Experience rank on the Character page. XP measures what you did in CareerFlow; the rank measures
// real working experience, the number employers screen on. It comes from approved data only: the
// years you stated in your approved profile, or else the dates on your work records.

export const RANKS = [
  { id: 'rookie', name: 'Rookie', market: 'Graduate and intern roles', minYears: 0 },
  { id: 'apprentice', name: 'Apprentice', market: 'Junior roles', minYears: 1 },
  { id: 'adventurer', name: 'Adventurer', market: 'Mid-level roles', minYears: 3 },
  { id: 'veteran', name: 'Veteran', market: 'Senior roles', minYears: 5 },
  { id: 'legend', name: 'Legend', market: 'Lead and principal roles', minYears: 8 },
] as const;

type WorkRecord = {
  experienceType?: string;
  startMonth?: string | null;
  endMonth?: string | null;
  current?: boolean;
};

const monthIndex = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + (mo - 1);
};

/** Months of work across records, counting overlapping jobs once. Courses and personal projects do not count. */
export function workMonths(records: WorkRecord[], now = new Date()) {
  const today = now.getFullYear() * 12 + now.getMonth();
  const spans = records
    .filter((r) => !r.experienceType || ['work', 'volunteer'].includes(r.experienceType))
    .filter((r) => r.startMonth && /^\d{4}-\d{2}$/.test(r.startMonth))
    .map((r) => {
      const start = monthIndex(r.startMonth!);
      const end = r.current || !r.endMonth ? today : monthIndex(r.endMonth);
      return [start, Math.min(end, today) + 1] as const;
    })
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = -Infinity;
  for (const [a, b] of spans) {
    const from = Math.max(a, cursor);
    if (b > from) total += b - from;
    cursor = Math.max(cursor, b);
  }
  return total;
}

export function experienceRank(profileData: any, matches: any[] = [], now = new Date()) {
  const stated = Number(profileData?.experienceYears);
  const months = workMonths(profileData?.workExperiences || [], now);
  const fromProfile = Number.isFinite(stated) && stated > 0;
  const years = fromProfile ? stated : Math.floor(months / 6) / 2;
  let index = 0;
  RANKS.forEach((r, i) => {
    if (years >= r.minYears) index = i;
  });
  const next = RANKS[index + 1] || null;
  // How many ranked roles state more years than you have, read from the listings themselves.
  const asking = matches
    .map((m) => m?.requirements?.experienceYears)
    .filter((y): y is number => typeof y === 'number');
  return {
    rank: RANKS[index],
    index,
    years,
    months: fromProfile ? Math.round(stated * 12) : months,
    source: fromProfile ? ('profile' as const) : months ? ('records' as const) : ('none' as const),
    next,
    toNext: next ? Math.max(0, next.minYears - years) : 0,
    roles: { stated: asking.length, above: asking.filter((y) => y > years).length },
  };
}

/** "2 years 3 months", "8 months", "No work yet". */
export function formatTenure(months: number) {
  if (!months) return 'No paid work yet';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} year${y === 1 ? '' : 's'}`, m && `${m} month${m === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' ');
}
