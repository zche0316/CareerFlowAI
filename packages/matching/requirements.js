import { countries } from '../recruitment/src/geography.js';

const normal = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const contains = (text, term) => (' ' + normal(text) + ' ').includes(' ' + normal(term) + ' ');
const optional = /\b(preferred|desirable|optional|nice[- ]to[- ]have|bonus|a plus|advantage)\b/i;
const mandatory = /\b(required|essential|must|minimum|at least|requirements|qualifications)\b/i;
const heading =
  /^(required skills|essential skills|requirements|what you bring|qualifications|preferred skills|preferred|desirable|nice[- ]to[- ]have|responsibilities|about us|benefits|our stack)\s*:?[ \t]*$/i;

// Keep a short source excerpt for each decision. Narrative mentions never become mandatory by default.
export function requirementClauses(description) {
  const text = String(description || '')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/(Required skills|Preferred skills|Qualification|Responsibilities)\s*:/gi, '\n$1:');
  let section = 'mentioned';
  return text.split(/(\n|[.;](?:\s|$)|\s+(?:but|however|whereas)\s+)/i).flatMap((raw) => {
    if (/^[.;]/.test(raw)) {
      section = 'mentioned';
      return [];
    }
    const line = raw.replace(/^\s*[-*•]+\s*/, '').trim();
    if (!line) return [];
    if (heading.test(line)) {
      section = optional.test(line)
        ? 'preferred'
        : mandatory.test(line) || /what you bring/i.test(line)
          ? 'required'
          : 'mentioned';
      return [];
    }
    const label = line.match(
      /^(required skills|essential skills|preferred skills|qualification|responsibilities)\s*:/i,
    )?.[1];
    if (label)
      section = /preferred/i.test(label)
        ? 'preferred'
        : /required|essential|qualification/i.test(label)
          ? 'required'
          : 'mentioned';
    const kind = optional.test(line)
      ? 'preferred'
      : /\b(not required|no .{0,30} required|not essential|not necessary|without .{0,30} experience)\b/i.test(
            line,
          )
        ? 'mentioned'
        : mandatory.test(line) || /^qualification$/i.test(label || '')
          ? 'required'
          : label || /^(we use|our (?:stack|team)|you will|responsibilities|benefits)\b/i.test(line)
            ? 'mentioned'
            : section;
    return [{ text: line, kind }];
  });
}

export function experienceRequirement(text) {
  const values = requirementClauses(text)
    .filter((c) => c.kind !== 'preferred')
    .flatMap(({ text }) => {
      if (
        /\b(no (?:prior |previous )?experience (?:is )?(?:required|necessary)|zero experience required)\b/i.test(
          text,
        )
      )
        return [0];
      if (/\b(not required|not essential)\b/i.test(text)) return [];
      return [
        ...text.matchAll(
          /(?:minimum\s+|at least\s+)?(\d+)(?:\s*[-–]\s*\d+|\+)?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|commercial\s+)?experience/gi,
        ),
      ].map((m) => Number(m[1]));
    });
  return values.length ? Math.max(...values) : null;
}

function degreeLevel(text) {
  if (/\b(ph\.?d\.?|doctorate|doctoral)\b/i.test(text)) return 4;
  if (/\bmaster(?:s|'s|’s)?\s+(?:degree|of)\b|\bm\.?sc\b/i.test(text)) return 3;
  if (/\bbachelor(?:s|'s|’s)?\s+(?:degree|of)\b|\bb\.?sc\b/i.test(text)) return 2;
  if (/\b(diploma|associate degree|associate of)\b/i.test(text)) return 1;
  return null;
}
const subjects = [
  ['computer science', 'computing'],
  ['information technology', 'it'],
  ['software engineering'],
  ['data science'],
  ['statistics'],
  ['mathematics', 'maths'],
  ['business', 'business administration'],
  ['finance'],
  ['economics'],
  ['electrical engineering'],
  ['mechanical engineering'],
  ['civil engineering'],
  ['psychology'],
  ['nursing'],
  ['arts'],
  ['law'],
];
const fields = (s) =>
  subjects.map((group, i) => (group.some((x) => contains(s, x)) ? i : -1)).filter((i) => i >= 0);

// Evaluate each education record separately: never combine one degree's level with another's subject.
export function educationAssessment(evidence, requirement) {
  if (!requirement || requirement === 'unspecified')
    return { status: 'unknown', reason: 'Qualification requirement unknown.' };
  const level = degreeLevel(requirement),
    wanted = fields(requirement);
  if (level === null)
    return { status: 'unknown', reason: 'Qualification wording needs manual review.' };
  const records = String(evidence || '')
    .split(/\n|;/)
    .filter((r) => r.trim() && !/\b(studying|expected|enrolled|pursuing|in progress)\b/i.test(r));
  const qualified = records.filter((r) => degreeLevel(r) !== null && degreeLevel(r) >= level);
  if (!records.some((r) => degreeLevel(r) !== null))
    return { status: 'unknown', reason: 'Completed degree evidence unavailable.' };
  if (!qualified.length)
    return /\bor equivalent|equivalent experience\b/i.test(requirement)
      ? {
          status: 'unknown',
          reason:
            'Degree level is below the requirement; alternative experience needs manual review.',
        }
      : { status: 'not_met', reason: 'Supplied completed degree is below the stated level.' };
  if (!wanted.length && /\b(?:in|of)\s+(?!degree\b)[a-z]/i.test(requirement))
    return {
      status: 'unknown',
      reason: 'Degree subject is outside the supported subject vocabulary.',
    };
  if (!wanted.length) return { status: 'met', reason: 'Completed degree meets the stated level.' };
  if (qualified.some((r) => fields(r).some((x) => wanted.includes(x))))
    return { status: 'met', reason: 'Completed degree meets the stated level and named subject.' };
  return {
    status: 'unknown',
    reason:
      'Named subject or equivalent experience needs manual review; degree level alone is insufficient.',
  };
}

function place(value) {
  const text = normal(value);
  const explicit = countries.filter((c) => [c.name, ...c.aliases].some((a) => contains(text, a)));
  let candidates = explicit.length
    ? explicit
    : countries.filter((c) =>
        c.regions.some((r) => r.some((v) => normal(v).length > 3 && contains(text, v))),
      );
  // A bare state code such as WA is ambiguous across countries; keep it unknown.
  if (!candidates.length)
    candidates = countries.filter((c) =>
      c.regions.some((r) => r.slice(0, 2).some((v) => normal(v) === text)),
    );
  if (candidates.length !== 1)
    return { text, country: null, regions: [], cities: [], broad: false };
  const country = candidates[0];
  const regions = country.regions.filter((r) => r.some((v) => contains(text, v)));
  const broad = [country.name, ...country.aliases].some((a) => normal(a) === text);
  // Only infer cities from the city positions in the maintained geography catalogue.
  const cities = regions
    .flatMap((r) =>
      r
        .slice(2)
        .filter((v) => !r.slice(0, 2).some((a) => normal(a) === normal(v)) && contains(text, v)),
    )
    .map(normal);
  return { text, country: country.code, regions: regions.map((r) => r[0]), cities, broad };
}

export function locationAssessment(preference, location) {
  const p = place(preference),
    j = place(location);
  if (!p.text || !j.text) return { status: 'unknown', reason: 'Location evidence unavailable.' };
  const remote = /\bremote\b/.test(j.text),
    wantsRemote = p.text === 'remote';
  if (remote && /\b(worldwide|anywhere|global)\b/.test(j.text))
    return { status: 'met', reason: 'Advertisement explicitly allows worldwide remote work.' };
  if (remote && !j.country)
    return {
      status: 'unknown',
      reason: 'Remote work region is unspecified or ambiguous; eligibility needs review.',
    };
  if (wantsRemote)
    return {
      status: remote ? 'unknown' : 'not_met',
      reason: remote
        ? 'Remote role has regional restrictions; user location needs confirmation.'
        : 'Advertisement does not state remote work.',
    };
  if (p.country && j.country && p.country !== j.country)
    return { status: 'not_met', reason: 'Job country differs from the preferred country.' };
  if (p.country && j.country) {
    if (p.broad)
      return {
        status: 'met',
        reason: 'Job is within the preferred country; eligibility is unverified.',
      };
    if (remote && !j.regions.length)
      return {
        status: 'met',
        reason: 'Remote role includes the preferred country; other eligibility is unverified.',
      };
    if (p.cities.length)
      return {
        status: p.cities.some((c) => j.cities.includes(c))
          ? 'met'
          : j.cities.length
            ? 'not_met'
            : 'unknown',
        reason: 'Compared named cities within the same country.',
      };
    if (p.regions.length)
      return {
        status: p.regions.some((r) => j.regions.includes(r))
          ? 'met'
          : j.regions.length
            ? 'not_met'
            : 'unknown',
        reason: 'Compared preferred state or region within the same country.',
      };
  }
  if (p.text === j.text && !/^[a-z]{1,3}$/.test(p.text))
    return { status: 'met', reason: 'Exact named location match; geographic coverage is limited.' };
  return {
    status: 'unknown',
    reason: 'Location is ambiguous or outside the supported geography catalogue.',
  };
}
