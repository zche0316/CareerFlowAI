// Capability model (CFS-111): one level per skill, from the approved profile and verified sources.
//
//   0 No evidence.
//   1 Aware: only listed, or studied in a course.
//   2 Used: applied in at least one project or role.
//   3 Proficient: several projects or a delivered outcome, or a public repository of meaningful size.
//   4 Advanced: sustained use for over a year, or external recognition.
//
// Confidence comes from the strongest source: verified external data, then a STAR story, then a
// project or role the user described, then a bare listing. Skills unused for three years show one
// level lower. There is no overall score and no hiring prediction.

export type Level = 0 | 1 | 2 | 3 | 4;
export type Confidence = 'verified' | 'story' | 'described' | 'listed';
export type Dimension = 'stack' | 'problem-solving' | 'practice' | 'domain' | 'communication';

export const levelNames = ['No evidence', 'Aware', 'Used', 'Proficient', 'Advanced'] as const;

/** Evidence from a source outside the profile text, such as GitHub or a verified certificate. */
export type ExternalEvidence = {
  skill: string;
  source: string; // github | certificate | codeforces | stackoverflow | leetcode | ...
  verified: boolean;
  /** Level this evidence supports on its own (e.g. a large repository supports 3). */
  supports: Level;
  detail: string;
  lastUsed?: string; // YYYY-MM
};

type ProfileRecord = {
  id: string;
  title: string;
  experienceType?: string;
  organisation?: string;
  startMonth?: string;
  endMonth?: string;
  current?: boolean;
  overview?: string;
  details?: string[];
  technologies?: string[];
  relevantCoursework?: string[];
  starStory?: { result?: string } | null;
};

export type CapabilityInput = {
  skills?: string[];
  workExperiences?: ProfileRecord[];
  projects?: ProfileRecord[];
  educations?: ProfileRecord[];
};

export type SkillEvidence = {
  kind: 'listed' | 'course' | 'record' | 'external';
  label: string;
  recordId?: string;
  source?: string;
  verified?: boolean;
};

export type SkillCapability = {
  skill: string;
  dimension: Dimension;
  level: Level;
  /** Level before the recency rule, for transparency. */
  rawLevel: Level;
  confidence: Confidence;
  lastUsed: string | null;
  stale: boolean;
  evidence: SkillEvidence[];
};

// Canonical names for common technical skills and the spellings employers and boards use.
const aliases: Record<string, string[]> = {
  JavaScript: ['javascript', 'js', 'es6'],
  TypeScript: ['typescript', 'ts'],
  Python: ['python'],
  Java: ['java'],
  'C#': ['c#', 'csharp', '.net', 'dotnet'],
  'C++': ['c++', 'cpp'],
  Go: ['golang', 'go lang'],
  Rust: ['rust'],
  SQL: ['sql', 't-sql', 'pl/sql'],
  PostgreSQL: ['postgresql', 'postgres', 'psql'],
  MySQL: ['mysql'],
  MongoDB: ['mongodb', 'mongo'],
  React: ['react', 'react.js', 'reactjs'],
  'Node.js': ['node.js', 'nodejs', 'node'],
  Docker: ['docker'],
  Kubernetes: ['kubernetes', 'k8s'],
  AWS: ['aws', 'amazon web services'],
  Azure: ['azure'],
  GCP: ['gcp', 'google cloud'],
  Git: ['git', 'github', 'gitlab'],
  pandas: ['pandas'],
  'scikit-learn': ['scikit-learn', 'sklearn'],
  'Power BI': ['power bi', 'powerbi'],
  Tableau: ['tableau'],
  Excel: ['excel', 'spreadsheets'],
  R: ['r'],
  dbt: ['dbt'],
  Spark: ['spark', 'pyspark'],
  Linux: ['linux', 'unix'],
  'Machine learning': ['machine learning', 'ml'],
  Statistics: ['statistics', 'statistical'],
  'Data visualisation': ['data visualisation', 'data visualization', 'dashboards', 'dashboard'],
  'Data cleaning': ['data cleaning', 'data wrangling'],
  Testing: ['testing', 'unit tests', 'unit testing', 'test automation'],
  'CI/CD': ['ci/cd', 'continuous integration', 'github actions'],
  Algorithms: ['algorithms', 'data structures', 'competitive programming'],
  'Stakeholder communication': [
    'stakeholder communication',
    'stakeholder',
    'presented',
    'presentation',
  ],
};
const dimensionOf: Record<string, Dimension> = {
  Algorithms: 'problem-solving',
  Statistics: 'problem-solving',
  Testing: 'practice',
  'CI/CD': 'practice',
  Git: 'practice',
  'Stakeholder communication': 'communication',
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const lookup = new Map<string, string>();
for (const [canonical, list] of Object.entries(aliases))
  for (const a of [canonical, ...list]) lookup.set(norm(a), canonical);

/** The canonical name for a skill term, or the trimmed term itself when it is not in the list. */
export function canonicalSkill(term: string) {
  return lookup.get(norm(term)) || term.trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether free text mentions a skill under any of its names (whole words only). */
export function mentionsSkill(text: string, skill: string) {
  const names = [skill, ...(aliases[skill] || [])].filter((n) => n.length > 1 || skill === 'R');
  return names.some((n) =>
    new RegExp(`(^|[^\\p{L}\\p{N}+#])${escape(n)}($|[^\\p{L}\\p{N}+#])`, 'iu').test(text),
  );
}

/** Known skills a free-text requirement names: "Data analysis using R or Stata" -> ["R"]. */
export function skillsIn(text: string) {
  return Object.keys(aliases).filter((skill) => mentionsSkill(text, skill));
}

const monthIndex = (m?: string | null) => {
  const x = /^(\d{4})-(\d{2})$/.exec(m || '');
  return x ? Number(x[1]) * 12 + Number(x[2]) - 1 : null;
};
const toMonth = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const hasOutcome = (r: ProfileRecord) =>
  Boolean(r.starStory?.result?.trim()) ||
  (r.details || []).some((d) =>
    /\b(used|adopted|delivered|launched|shipped|reduced|increased|improved|saved|won|grade|distinction|trial)\b/i.test(
      d,
    ),
  );

/**
 * Levels for every skill the profile or external evidence mentions. `storyRecordIds` lists records
 * that have a confirmed STAR story in career memory.
 */
export function capabilityLevels(
  profile: CapabilityInput,
  external: ExternalEvidence[] = [],
  storyRecordIds: string[] = [],
  now = new Date(),
): SkillCapability[] {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const records = [...(profile.workExperiences || []), ...(profile.projects || [])];
  const stories = new Set(storyRecordIds);
  const names = new Set<string>();
  for (const s of profile.skills || []) names.add(canonicalSkill(s));
  for (const r of records) for (const t of r.technologies || []) names.add(canonicalSkill(t));
  for (const e of external) names.add(canonicalSkill(e.skill));
  // Skills that appear only in record text or coursework are found through the alias list.
  const coursework = (profile.educations || []).flatMap((e) => e.relevantCoursework || []);
  for (const canonical of Object.keys(aliases))
    if (
      records.some((r) =>
        mentionsSkill([r.title, r.overview, ...(r.details || [])].join(' '), canonical),
      ) ||
      coursework.some((c) => mentionsSkill(c, canonical))
    )
      names.add(canonical);

  const out: SkillCapability[] = [];
  for (const skill of names) {
    const evidence: SkillEvidence[] = [];
    const listed = (profile.skills || []).some((s) => canonicalSkill(s) === skill);
    if (listed) evidence.push({ kind: 'listed', label: 'Listed in your skills' });
    const coursework = (profile.educations || []).filter((e) =>
      (e.relevantCoursework || []).some((c) => mentionsSkill(c, skill)),
    );
    for (const e of coursework)
      evidence.push({ kind: 'course', label: `Coursework: ${e.title}`, recordId: e.id });
    const used = records.filter(
      (r) =>
        (r.technologies || []).some((t) => canonicalSkill(t) === skill) ||
        mentionsSkill([r.title, r.overview, ...(r.details || [])].join(' '), skill),
    );
    for (const r of used)
      evidence.push({
        kind: 'record',
        label: [r.title, r.organisation].filter(Boolean).join(' · '),
        recordId: r.id,
      });
    const ext = external.filter((e) => canonicalSkill(e.skill) === skill);
    for (const e of ext)
      evidence.push({ kind: 'external', label: e.detail, source: e.source, verified: e.verified });
    if (!evidence.length) continue;

    // Months of use in roles (work), counted once per record.
    const workMonths = used
      .filter((r) => (r.experienceType || 'work') === 'work')
      .reduce((sum, r) => {
        const a = monthIndex(r.startMonth);
        const b = r.current ? nowIndex : monthIndex(r.endMonth);
        return a !== null && b !== null && b >= a ? sum + (b - a + 1) : sum;
      }, 0);
    let level: Level = listed || coursework.length ? 1 : 0;
    if (used.length) level = 2;
    if (used.length >= 2 || used.some(hasOutcome)) level = 3;
    if (workMonths > 12) level = 4;
    for (const e of ext) if (e.supports > level) level = e.supports;

    const ends = [
      ...used.map((r) => (r.current ? nowIndex : monthIndex(r.endMonth))),
      ...ext.map((e) => monthIndex(e.lastUsed)),
    ].filter((x): x is number => x !== null);
    const last = ends.length ? Math.max(...ends) : null;
    const stale = last !== null && nowIndex - last > 36;
    const confidence: Confidence = ext.some((e) => e.verified)
      ? 'verified'
      : used.some((r) => stories.has(r.id) || r.starStory?.result)
        ? 'story'
        : used.length || ext.length
          ? 'described'
          : 'listed';
    out.push({
      skill,
      dimension: dimensionOf[skill] || 'stack',
      rawLevel: level,
      level: (stale && level > 1 ? level - 1 : level) as Level,
      confidence,
      lastUsed: last === null ? null : toMonth(last),
      stale,
      evidence,
    });
  }
  return out.sort((a, b) => b.level - a.level || a.skill.localeCompare(b.skill));
}

/**
 * The level a job asks for, from the requirement wording: years of experience, "strong" or
 * "proficient" wording, or "familiarity" and "nice to have" wording. Required items default to 2
 * (used), preferred ones to 1 (aware).
 */
export function requiredLevel(level: 'required' | 'preferred', excerpt = ''): Level {
  const years = /(\d+)\s*\+?\s*(?:years|yrs)/i.exec(excerpt);
  if (years) return Number(years[1]) >= 3 ? 4 : 3;
  if (/\b(expert|advanced|deep|extensive|senior)\b/i.test(excerpt)) return 4;
  if (/\b(strong|proficien\w*|solid|demonstrated|proven|hands-on)\b/i.test(excerpt)) return 3;
  if (/\b(familiar\w*|exposure|nice to have|bonus|basic|awareness)\b/i.test(excerpt)) return 1;
  return level === 'required' ? 2 : 1;
}

export type LevelGap = {
  skill: string;
  term: string;
  need: Level;
  have: Level;
  confidence: Confidence | null;
  level: 'required' | 'preferred';
};

/** Gaps between what a role asks for and the candidate's levels, biggest required gaps first. */
export function levelGaps(
  items: { term: string; level: 'required' | 'preferred'; excerpt?: string; category?: string }[],
  capabilities: SkillCapability[],
): LevelGap[] {
  const bySkill = new Map(capabilities.map((c) => [c.skill, c]));
  const out: LevelGap[] = [];
  for (const item of items) {
    if (item.category && !['skill', 'experience'].includes(item.category)) continue;
    // A requirement counts here only for the skills it names; soft-skill phrases such as
    // "Creative problem-solving" are left to the Job Matcher's evidence mapping.
    const canonical = canonicalSkill(item.term);
    const named = bySkill.has(canonical) || aliases[canonical] ? [canonical] : skillsIn(item.term);
    const need = requiredLevel(item.level, item.excerpt);
    for (const skill of named) {
      const have = (bySkill.get(skill)?.level ?? 0) as Level;
      if (need > have && !out.some((g) => g.skill === skill))
        out.push({
          skill,
          term: item.term,
          need,
          have,
          confidence: bySkill.get(skill)?.confidence ?? null,
          level: item.level,
        });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.level === 'required') - Number(a.level === 'required') ||
      b.need - b.have - (a.need - a.have),
  );
}

/** Requirement items from a stored match: the model mapping when present, else the term lists. */
export function requirementItems(match: any) {
  const items = match?.mapping?.items;
  if (Array.isArray(items) && items.length)
    return items.map((i: any) => ({
      term: i.term,
      level: i.level,
      excerpt: i.excerpt,
      category: i.category,
    }));
  return [
    ...(match?.requirements?.required || []).map((term: string) => ({
      term,
      level: 'required' as const,
    })),
    ...(match?.requirements?.preferred || []).map((term: string) => ({
      term,
      level: 'preferred' as const,
    })),
  ];
}
