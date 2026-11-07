import type { Fact } from '../../../contracts/src/index.js';
import type { GapReport, RequirementCoverage } from './types.js';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-term match so "R" does not match "React" and "SQL" does not match "PostgreSQL" text noise.
export function mentions(text: string, term: string) {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

const unique = <T>(items: T[]) => [...new Set(items)];

const FILLER = new Set(
  'and or the with for from into across of to in on a an at by as using use experience practical proven strong excellent good solid ability skills skill knowledge working work tools tool solutions'.split(
    ' ',
  ),
);

// Significant words of a requirement phrase, e.g. "Complex SQL querying" -> complex, sql, querying.
export function keyTerms(term: string) {
  return unique(
    (term.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) || [])
      .map((w) => w.replace(/^\.+|\.+$/g, ''))
      .filter((w) => w.length >= 2 && !FILLER.has(w)),
  );
}

// A requirement counts as mentioned when at least half of its significant words appear as whole words.
// Requirement phrases from the LLM mapping are rarely quoted verbatim in resume claims.
export function coversTerm(text: string, term: string) {
  const words = keyTerms(term);
  if (!words.length) return mentions(text, term);
  return words.filter((w) => mentions(text, w)).length * 2 >= words.length;
}

// Mirrors jobMappingSchema items (job-mapping.ts): approved-fact citations live in `evidence`.
type MappingItem = {
  term: string;
  level?: string;
  status?: string;
  evidence?: { factId: string; quote?: string }[];
};

// Gap Analyzer: turn the Job Matcher result into requirement -> approved-evidence links.
// Live missions reuse the source-quoted LLM mapping; fixture missions fall back to lexical terms.
export function analyseGaps(
  selected: any,
  facts: Pick<Fact, 'id' | 'text'>[],
  userNote = '',
): GapReport {
  const known = new Set(facts.map((f) => f.id));
  const items: MappingItem[] | undefined = selected?.mapping?.items;
  let source: GapReport['source'];
  let requirements: RequirementCoverage[];
  if (Array.isArray(items) && items.length) {
    source = 'llm-mapping';
    requirements = items.map((i) => {
      const factIds = unique((i.evidence || []).map((c) => c.factId).filter((id) => known.has(id)));
      const status =
        i.status === 'evidenced' || i.status === 'partial'
          ? factIds.length
            ? i.status
            : 'not_evidenced'
          : 'not_evidenced';
      return {
        term: i.term,
        level: i.level === 'preferred' ? 'preferred' : 'required',
        status,
        factIds,
      } as RequirementCoverage;
    });
  } else {
    source = 'lexical';
    const req = selected?.requirements || {};
    const terms: [string, 'required' | 'preferred'][] = [
      ...((req.required || []) as string[]).map((t) => [t, 'required'] as [string, 'required']),
      ...((req.preferred || []) as string[]).map((t) => [t, 'preferred'] as [string, 'preferred']),
    ];
    requirements = terms.map(([term, level]) => {
      const factIds = facts.filter((f) => mentions(f.text, term)).map((f) => f.id);
      return { term, level, status: factIds.length ? 'evidenced' : 'not_evidenced', factIds };
    });
  }
  const userFocus = requirements
    .filter((r) => userNote && mentions(userNote, r.term))
    .map((r) => r.term);
  const rank = (r: RequirementCoverage) =>
    (userFocus.includes(r.term) ? 4 : 0) +
    (r.level === 'required' ? 2 : 0) +
    (r.status === 'evidenced' ? 1 : 0);
  requirements = requirements
    .map((r, index) => ({ r, index }))
    .sort((a, b) => rank(b.r) - rank(a.r) || a.index - b.index)
    .map(({ r }) => r);
  return {
    version: 'resume-gap-v1',
    source,
    requirements,
    priorityFactIds: unique(
      requirements.filter((r) => r.status !== 'not_evidenced').flatMap((r) => r.factIds),
    ),
    gaps: requirements.filter((r) => r.status === 'not_evidenced').map((r) => r.term),
    userFocus,
  };
}
