// A normalised job record. Every extracted field carries the sentence it came from, and a field
// whose quote cannot be found in the listing is left empty rather than guessed. Rule-based, so it
// costs no model call and runs the same way in fixture and live mode. Browser-safe (no Node APIs).

export type Quoted<T> = { value: T; quote: string };

export type WorkRights =
  'citizen_or_pr' | 'clearance' | 'no_sponsorship' | 'sponsorship_available' | 'right_to_work';

export type JobRecord = {
  jobId: string;
  title: string;
  company: string;
  location: string;
  employmentType: string | null;
  url: string | null;
  source: string;
  // False for a page found by web search: nothing confirmed the vacancy through an employer API.
  verified: boolean;
  fictional: boolean;
  postedAt: string | null;
  workRights: Quoted<WorkRights> | null;
  arrangement: Quoted<'remote' | 'hybrid' | 'on-site'> | null;
  seniority: Quoted<'intern' | 'graduate' | 'junior' | 'senior' | 'lead'> | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: 'year' | 'day' | 'hour';
    // Converted with stated assumptions (38 h/week, 230 working days).
    annualMin: number | null;
    annualMax: number | null;
    basis: 'listing text' | 'provider field';
    quote: string | null;
  } | null;
};

export const workRightsLabels: Record<WorkRights, string> = {
  citizen_or_pr: 'Citizen or PR required',
  clearance: 'Security clearance',
  no_sponsorship: 'No visa sponsorship',
  sponsorship_available: 'Sponsorship available',
  right_to_work: 'Right to work required',
};

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** True when the quote appears in the source text, ignoring whitespace differences. */
export const quoteInSource = (source: string, quote: string) =>
  Boolean(quote) && squash(source).toLowerCase().includes(squash(quote).toLowerCase());

const sentences = (text: string) =>
  squash(text)
    // Listings often arrive as flattened HTML: also break on dash bullets and ALL-CAPS headings.
    .split(
      /(?<=[.!?;])\s+|\s+[•·▪*]\s+|(?<!\d)\s+[-–—]\s+(?=[A-Za-z])|\s+(?=(?:[A-Z][A-Z&']+\s+){1,5}[A-Z][A-Z&']+\b)/,
    )
    .map((s) => s.trim())
    .filter(Boolean);

// A long sentence is cut, never reworded, so the quote stays verifiable.
const cut = (s: string) => (s.length > 260 ? s.slice(0, 260) : s);

function first<T>(parts: string[], rules: [RegExp, T][]): Quoted<T> | null {
  for (const [pattern, value] of rules) {
    const hit = parts.find((s) => pattern.test(s));
    if (hit) return { value, quote: cut(hit) };
  }
  return null;
}

// Order matters: the most restrictive statement wins when a listing says several things.
const rightsRules: [RegExp, WorkRights][] = [
  [/\b(citizen(s|ship)?|permanent residen(t|ts|cy))\b/i, 'citizen_or_pr'],
  [/\b(security clearance|baseline clearance|nv1|nv2|agsva)\b/i, 'clearance'],
  [
    /\b(no|not|unable to|cannot|can't|do not|does not|don't|won't|will not)\b[^.]{0,60}\bsponsor/i,
    'no_sponsorship',
  ],
  [
    /\bsponsorship (is )?(available|offered|provided)\b|\bwe (can|will) sponsor\b/i,
    'sponsorship_available',
  ],
  [
    /\b(right to work|work(ing)? rights|work authori[sz]ation|eligible to work|legally (entitled|authori[sz]ed) to work)\b/i,
    'right_to_work',
  ],
];

const arrangementRules: [RegExp, 'remote' | 'hybrid' | 'on-site'][] = [
  // "Hybrid role covering strategy and operations" is not a working arrangement.
  [
    /\bhybrid\b[^.]{0,25}\b(work|working|arrangement|model|schedule|policy|office)\b|\b(work|working)\b[^.]{0,25}\bhybrid\b/i,
    'hybrid',
  ],
  [
    /\b(fully remote|remote[- ]first|work(ing)? remotely|remote (role|position|work)|100% remote)\b/i,
    'remote',
  ],
  [/\b(on[- ]site|in[- ]office|office[- ]based)\b/i, 'on-site'],
];

const seniorityRules: [RegExp, 'intern' | 'graduate' | 'junior' | 'senior' | 'lead'][] = [
  [/\b(intern|internship|vacationer)\b/i, 'intern'],
  [/\b(graduate|new grad|early careers?)\b/i, 'graduate'],
  [/\b(junior|entry[- ]level|associate)\b/i, 'junior'],
  [/\b(lead|principal|head of|staff|manager)\b/i, 'lead'],
  [/\b(senior|sr\.?)\b/i, 'senior'],
];

const currencies: Record<string, string> = {
  A$: 'AUD',
  NZ$: 'NZD',
  US$: 'USD',
  S$: 'SGD',
  C$: 'CAD',
  '£': 'GBP',
  '€': 'EUR',
};
const unit = '(A\\$|NZ\\$|US\\$|S\\$|C\\$|AUD|NZD|USD|SGD|CAD|GBP|EUR|\\$|£|€)';
const amount = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?(k)?';
const money = new RegExp(`${unit}\\s?${amount}(?:\\s?(?:-|–|—|to)\\s?${unit}?\\s?${amount})?`, 'i');

const annual = (n: number | null, period: 'year' | 'day' | 'hour') =>
  n === null ? null : Math.round(period === 'year' ? n : period === 'day' ? n * 230 : n * 38 * 52);

function salaryFromText(parts: string[], fallback: string): JobRecord['salary'] {
  for (const s of parts) {
    if (
      !/\b(salary|remuneration|package|per (annum|year|hour|day)|p\.?a\.?|hourly|daily|base)\b|\/\s?(hr|hour|day|year)/i.test(
        s,
      )
    )
      continue;
    const m = s.match(money);
    if (!m) continue;
    const k = Boolean(m[3] || m[6]);
    const num = (raw?: string) =>
      raw
        ? Number(raw.replace(/,/g, '')) * (k && Number(raw.replace(/,/g, '')) < 1000 ? 1000 : 1)
        : null;
    const min = num(m[2]);
    const max = num(m[5]);
    if (min === null) continue;
    const period: 'year' | 'day' | 'hour' =
      /\b(per|an)\s(hour|hr)\b|\/\s?(hr|hour)\b|\bhourly\b/i.test(s)
        ? 'hour'
        : /\b(per|a)\sday\b|\/\s?day\b|\bdaily\b/i.test(s)
          ? 'day'
          : 'year';
    // A yearly figure under 1,000 is almost certainly something else (a bonus, a count).
    if (period === 'year' && min < 1000) continue;
    const code = m[1].toUpperCase();
    return {
      min,
      max,
      currency: currencies[code] || (/^[A-Z]{3}$/.test(code) ? code : fallback),
      period,
      annualMin: annual(min, period),
      annualMax: annual(max, period),
      basis: 'listing text',
      quote: cut(s),
    };
  }
  return null;
}

export function buildJobRecord(job: any, fallbackCurrency = 'AUD'): JobRecord {
  const description = String(job.description || '');
  const title = String(job.title || '');
  const location = String(job.location || '');
  const parts = sentences(description);
  const provider =
    job.salary && (job.salary.min != null || job.salary.max != null) ? job.salary : null;
  const period: 'year' | 'day' | 'hour' =
    provider?.period === 'hour' || provider?.period === 'day' ? provider.period : 'year';
  const record: JobRecord = {
    jobId: String(job.id),
    title,
    company: String(job.company || ''),
    location,
    employmentType:
      job.employmentType && job.employmentType !== 'Unspecified' ? job.employmentType : null,
    url: job.applicationUrl || (/^https?:/.test(job.url || '') ? job.url : null),
    source: job.source?.provider || job.source?.name || 'unknown',
    verified: job.source?.provider !== 'web' && job.source?.verified !== false,
    fictional:
      Boolean(job.source?.fictional) ||
      job.source?.type === 'disclosed-fixture' ||
      job.source?.liveVacancy === false,
    postedAt: job.source?.postedAt || null,
    workRights: first(parts, rightsRules),
    // A location field that just says "Remote" or "Hybrid" is itself the statement.
    arrangement:
      first(
        [location],
        [
          [/\bhybrid\b/i, 'hybrid'],
          [/\bremote\b/i, 'remote'],
        ],
      ) || first(parts, arrangementRules),
    // Seniority comes from the title only; body text mentions other people's seniority too often.
    seniority: first([title], seniorityRules),
    salary: provider
      ? {
          min: provider.min ?? null,
          max: provider.max ?? null,
          currency: provider.currency || fallbackCurrency,
          period,
          annualMin: annual(provider.min ?? null, period),
          annualMax: annual(provider.max ?? null, period),
          basis: 'provider field',
          quote: null,
        }
      : salaryFromText(parts, fallbackCurrency),
  };
  // Final check: drop any field whose quote is not literally in the listing, title or location.
  const source = `${title}\n${location}\n${description}`;
  for (const key of ['workRights', 'arrangement', 'seniority'] as const)
    if (record[key] && !quoteInSource(source, record[key]!.quote)) record[key] = null;
  if (record.salary?.quote && !quoteInSource(source, record.salary.quote)) record.salary = null;
  return record;
}
