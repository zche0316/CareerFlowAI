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
  // True when the role came from a model's web search and its page could not be read (for
  // example the site forbids automated reading). Only the title, company, link and the model's
  // quote are known; the user opens the link to check it.
  lead: boolean;
  leadReason: string | null;
  fictional: boolean;
  postedAt: string | null;
  workRights: Quoted<WorkRights> | null;
  arrangement: Quoted<'remote' | 'hybrid' | 'on-site'> | null;
  seniority: Quoted<'intern' | 'graduate' | 'junior' | 'senior' | 'lead'> | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: 'year' | 'month' | 'day' | 'hour';
    // Converted with stated assumptions (38 h/week, 230 working days, 12 months).
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

// Order matters: the most restrictive statement wins when a listing says several things. A
// clearance implies citizenship, so it is reported first when both are stated.
const rightsRules: [RegExp, WorkRights][] = [
  [
    /\b(security|baseline|sc|dv|ts\/sci|top secret|nv1|nv2) clearance\b|\b(nv1|nv2|agsva)\b|\bclearance (is )?required\b/i,
    'clearance',
  ],
  // "Citizenship" alone is not a requirement ("corporate citizenship program", "engage
  // citizens"): it needs a nationality, a residency pairing or must/only/required wording.
  [
    /\b(australian|new zealand|nz|u\.?s\.?|american|british|uk|singapore(an)?|canadian) (citizen(s|ship)?)\b|\bpermanent residen(t|ts|cy)\b|\bcitizen(s|ship)?\b[^.]{0,40}\b(required|only)\b|\b(must|need to|required to) (be|hold|have)\b[^.]{0,25}\bcitizen/i,
    'citizen_or_pr',
  ],
  [
    /\b(no|not|unable to|cannot|can't|do not|does not|don't|won't|will not)\b[^.]{0,60}\bsponsor|\bwithout (visa )?sponsorship\b|\bsponsorship\b[^.]{0,20}\b(is )?not (available|offered|provided)\b/i,
    'no_sponsorship',
  ],
  [
    /\bsponsorship\b[^.]{0,20}\b(is )?(available|offered|provided)\b|\bwe (can|will) sponsor\b|\bwe sponsor\b/i,
    'sponsorship_available',
  ],
  [
    /\b(right to work|work(ing)? rights|work authori[sz]ation|eligible to work|legally (entitled|authori[sz]ed) to work)\b/i,
    'right_to_work',
  ],
];

const arrangementRules: [RegExp, 'remote' | 'hybrid' | 'on-site'][] = [
  // A negated remote statement is checked first so "not a remote role" never reads as remote.
  [
    /\bnot (a |an )?(fully )?remote\b|\bno remote\b|\bcannot be (performed|done|worked) remotely\b/i,
    'on-site',
  ],
  // "Hybrid role covering strategy and operations" is not a working arrangement; a label
  // ("Hybrid: Tuesdays to Thursdays") or "the role is hybrid" is.
  [
    /\bhybrid\b[^.]{0,25}\b(work|working|arrangement|model|schedule|policy|office)\b|\b(work|working)\b[^.]{0,25}\bhybrid\b|^hybrid\s*[:–—,-]|\b(role|position|job) is hybrid\b|\b(team|we) works? hybrid\b/i,
    'hybrid',
  ],
  // Office days mixed with home days.
  [
    /\b(office|on[- ]?site)\b[^.]{0,60}\b(from[- ]home|at home|home working|wfh)\b|\b(from[- ]home|wfh)\b[^.]{0,60}\b(office|on[- ]?site)\b|\bmix of (office|on[- ]?site) and (home|remote)\b|\bwork(ing)?[- ]from[- ]home (up to|options|days?|part of the week)\b|\bdays? (a week |per week )?(from|at) home\b|\b(wfh|work from home) (mondays|tuesdays|wednesdays|thursdays|fridays)\b|\bremote[- ]friendly\b[^.]{0,60}\boffice\b/i,
    'hybrid',
  ],
  [
    /\b(fully remote|remote[- ]first|work(ing)? remotely|remote (role|position|work)|100% remote)\b|\bremote (with|across|within|anywhere|in australia)\b|^remote\b(?! sensing)|\b(a|this is a) work from home (role|position|job)\b|\bremote working is available anywhere\b/i,
    'remote',
  ],
  [
    /\b(on[- ]?site|in[- ]office|office[- ]based)\b|\bbased (full[- ]time )?(at|in|from) (our|the)\b[^.]{0,30}\b(office|plant|site|facility|warehouse|clinic|store|hospital)\b|\b(office|plant|site|facility|warehouse) monday to friday\b|\bfly[- ]in[- ]fly[- ]out\b|\bfifo\b/i,
    'on-site',
  ],
];

type Seniority = 'intern' | 'graduate' | 'junior' | 'senior' | 'lead';
const seniorityRules: [RegExp, Seniority][] = [
  [/\b(intern|internship|vacationer)\b/i, 'intern'],
  [/\b(graduate|new grad|early careers?)\b/i, 'graduate'],
  [/\b(junior|entry[- ]level|associate)\b/i, 'junior'],
  // "Manager" alone is a job family (office, account, product manager), not a leadership level.
  [
    /\b(lead|principal|head of|staff (engineer|scientist|designer)|(engineering|team|people|delivery) manager|team leader)\b/i,
    'lead',
  ],
  [/\b(senior|sr\.?)\b/i, 'senior'],
];
// The body mentions other people's seniority ("mentor three junior engineers"), so it counts
// only when it describes this role itself.
const bodySeniorityRules: [RegExp, Seniority][] = [
  [/\b(an?|this|our)( [a-z0-9-]+){0,2} (paid )?internship\b/i, 'intern'],
  [/\b(our|this|the)( [a-z0-9-]+){0,2} graduate (program|programme|role|position)\b/i, 'graduate'],
  [/\b(this|the) (is an? )?(entry[- ]level|junior) (role|position)\b/i, 'junior'],
  [/\bthis is an? senior (role|position)\b/i, 'senior'],
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
const range = (u: string) =>
  `${u}\\s?${amount}(?:\\s?(?:-|–|—|to)\\s?${u ? `${u}?` : ''}\\s?${amount})?`;
const money = new RegExp(range(unit), 'gi');
// Figures without a currency sign ("130000 to 145000", "140-155k", "32.50 per hour"). Only read
// when a salary word is present, and only when the figure is clearly pay (see salaryFromText).
const bare = new RegExp(`(?<![\\d.,$£€])${range('')}`, 'gi');
const CODE = /\b(AUD|NZD|USD|SGD|CAD|GBP|EUR)\b/;

type Period = 'year' | 'month' | 'day' | 'hour';
const annual = (n: number | null, period: Period) =>
  n === null
    ? null
    : Math.round(
        period === 'year'
          ? n
          : period === 'month'
            ? n * 12
            : period === 'day'
              ? n * 230
              : n * 38 * 52,
      );

const SALARY_WORDS =
  /\b(salary|remuneration|package|compensation|pay|rate|wage|base|super(annuation)?|per (annum|year|hour|day|month)|p\.?a\.?|hourly|daily|monthly|up to)\b|\/\s?(hr|hour|day|year|month)\b/i;

const periodOf = (s: string): Period =>
  /\b(per|an)\s(hour|hr)\b|\/\s?(hr|hour)\b|\bhourly\b/i.test(s)
    ? 'hour'
    : /\b(per|a)\sday\b|\/\s?day\b|\bdaily\b/i.test(s)
      ? 'day'
      : /\b(per|a)\smonth\b|\/\s?(mo|month)\b|\bmonthly\b/i.test(s)
        ? 'month'
        : 'year';

// A bare "$" means the local dollar, so the listing location decides it when the ad does not.
const US_STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WV|WI|WY|DC';
export function locationCurrency(location: string): string | null {
  if (
    new RegExp(`\\b(united states|usa|u\\.s\\.a?\\.?)\\b|,\\s?(${US_STATES})\\b`, 'i').test(
      location,
    )
  )
    return 'USD';
  if (/\b(new zealand|auckland|wellington|christchurch)\b/i.test(location)) return 'NZD';
  if (/\bsingapore\b/i.test(location)) return 'SGD';
  if (/\b(canada|toronto|vancouver|montreal|calgary|ottawa)\b/i.test(location)) return 'CAD';
  if (/\b(united kingdom|uk|england|scotland|wales|london)\b/i.test(location)) return 'GBP';
  return null;
}

function salaryFromText(parts: string[], fallback: string): JobRecord['salary'] {
  for (const s of parts) {
    const worded = SALARY_WORDS.test(s);
    const period = periodOf(s);
    const candidates = [
      // Group positions: [min, min k, max, max k]; a signed range also captures a second sign.
      ...[...s.matchAll(money)].map((m) => ({ m, sign: m[1], at: [2, 3, 5, 6] })),
      ...(worded ? [...s.matchAll(bare)].map((m) => ({ m, sign: '', at: [1, 2, 3, 4] })) : []),
    ].sort((a, b) => a.m.index! - b.m.index!);
    for (const { m, sign, at } of candidates) {
      const k = Boolean(m[at[1]] || m[at[3]]);
      const value = (raw?: string) => {
        if (!raw) return null;
        const n = Number(raw.replace(/,/g, ''));
        return k && n < 1000 ? n * 1000 : n;
      };
      let min = value(m[at[0]]);
      let max = value(m[at[2]]);
      if (min === null) continue;
      if (!sign) {
        // Without a sign the figure must look like pay: a "k", a five-figure amount or a rate.
        if (!(k || min >= 10000 || period !== 'year')) continue;
      } else if (!worded && !(max !== null && (k || (min >= 10000 && max <= 1000000)))) continue;
      // A yearly figure under 1,000 is almost certainly something else (a bonus, a count).
      if (period === 'year' && min < 1000) continue;
      if (max === null) {
        // "Up to $150,000" is a ceiling; any other single figure is the stated pay.
        const before = s.slice(0, m.index);
        if (/\bup to\s*$/i.test(before)) [min, max] = [null, min];
        else if (!/\b(from|at least|minimum( of)?)\s*$/i.test(before)) max = min;
      }
      const code = sign.toUpperCase();
      return {
        min,
        max,
        currency:
          currencies[code] || (/^[A-Z]{3}$/.test(code) ? code : s.match(CODE)?.[1] || fallback),
        period,
        annualMin: annual(min, period),
        annualMax: annual(max, period),
        basis: 'listing text',
        quote: cut(s),
      };
    }
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
  const period: Period = ['hour', 'day', 'month'].includes(provider?.period)
    ? provider.period
    : 'year';
  const currency = locationCurrency(location) || fallbackCurrency;
  const record: JobRecord = {
    jobId: String(job.id),
    title,
    company: String(job.company || ''),
    location,
    employmentType:
      job.employmentType && job.employmentType !== 'Unspecified' ? job.employmentType : null,
    url: job.applicationUrl || (/^https?:/.test(job.url || '') ? job.url : null),
    source: job.source?.provider || job.source?.name || 'unknown',
    verified: !['web', 'agent'].includes(job.source?.provider) && job.source?.verified !== false,
    lead: job.source?.lead === true,
    leadReason: job.source?.lead === true ? String(job.source.leadReason || '') || null : null,
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
    // The title decides; the body only fills a gap with a statement about this role.
    seniority: first([title], seniorityRules) || first(parts, bodySeniorityRules),
    salary: provider
      ? {
          min: provider.min ?? null,
          max: provider.max ?? null,
          currency: provider.currency || currency,
          period,
          annualMin: annual(provider.min ?? null, period),
          annualMax: annual(provider.max ?? null, period),
          basis: 'provider field',
          quote: null,
        }
      : salaryFromText(parts, currency),
  };
  // Final check: drop any field whose quote is not literally in the listing, title or location.
  const source = `${title}\n${location}\n${description}`;
  for (const key of ['workRights', 'arrangement', 'seniority'] as const)
    if (record[key] && !quoteInSource(source, record[key]!.quote)) record[key] = null;
  if (record.salary?.quote && !quoteInSource(source, record.salary.quote)) record.salary = null;
  return record;
}
