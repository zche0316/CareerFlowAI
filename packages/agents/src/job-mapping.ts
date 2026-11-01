import { z } from 'zod';
import type { Fact } from '../../contracts/src/index.js';
import { locationAssessment } from '../../matching/requirements.js';
import { generate, type Mode, type ProviderHooks } from './provider.js';

const requirement = z.object({
  term: z.string().min(1).max(140),
  category: z.enum(['skill', 'experience', 'education', 'responsibility', 'seniority']),
  level: z.enum(['required', 'preferred']),
  excerpt: z.string().min(1).max(500),
  status: z.enum(['evidenced', 'partial', 'not_evidenced']),
  evidence: z.array(z.object({ factId: z.string(), quote: z.string().min(1).max(350) })).max(4),
  reason: z.string().min(1).max(350),
});
export const jobMappingSchema = z.object({
  items: z.array(requirement).max(16),
  experienceYears: z.number().min(0).max(60).nullable(),
  experienceExcerpt: z.string().max(500),
});
export type JobMapping = z.infer<typeof jobMappingSchema>;
const normal = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function validateJobMapping(value: unknown, job: any, facts: Fact[]): JobMapping {
  const mapping = jobMappingSchema.parse(value);
  const known = new Map(facts.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (const item of mapping.items) {
    if (!normal(job.description).includes(normal(item.excerpt)))
      throw Error('Job requirement has no exact source excerpt.');
    const key = normal(item.term);
    if (seen.has(key)) throw Error('Duplicate job requirement.');
    seen.add(key);
    if (item.status !== 'not_evidenced' && !item.evidence.length)
      throw Error('Evidenced requirements need approved fact citations.');
    if (item.status === 'not_evidenced' && item.evidence.length)
      throw Error('Missing evidence cannot also be claimed as supporting evidence.');
    for (const citation of item.evidence) {
      const fact = known.get(citation.factId);
      if (
        !fact ||
        !['skill', 'experience', 'education'].includes(fact.kind) ||
        !normal(fact.text).includes(normal(citation.quote))
      )
        throw Error('Unknown or unsupported candidate evidence.');
      if (
        item.status === 'evidenced' &&
        item.category !== 'education' &&
        !['skill', 'experience'].includes(fact.kind)
      )
        throw Error('Goals, preferences and coursework cannot establish professional proficiency.');
    }
  }
  if (
    mapping.experienceYears !== null &&
    (!mapping.experienceExcerpt ||
      !normal(job.description).includes(normal(mapping.experienceExcerpt)) ||
      !new RegExp(`\\b${mapping.experienceYears}\\b`).test(mapping.experienceExcerpt))
  )
    throw Error(
      'Numeric experience requirement must quote the explicit number, never infer it from seniority.',
    );
  return mapping;
}

export async function mapJobRequirements(
  job: any,
  facts: Fact[],
  mode: Mode,
  hooks: ProviderHooks,
  signal?: AbortSignal,
) {
  const schema = jobMappingSchema.superRefine((value, ctx) => {
    try {
      validateJobMapping(value, job, facts);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
    }
  });
  const value = await generate(
    'matching',
    {
      goal: 'Extract employer requirements and map each one to supplied approved facts. Do not calculate a score.',
      facts: facts
        .filter((f) => ['skill', 'experience', 'education'].includes(f.kind))
        .map(({ id, kind, text }) => ({ id, kind, text })),
      job,
    },
    schema,
    mode,
    hooks,
    signal,
  );
  return validateJobMapping(value, job, facts);
}

// Unknown categories are unscored, not half-credit. Weights are policy, not a skill vocabulary.
export function scoreJobMapping(job: any, mapping: JobMapping, facts: Fact[], profile: any) {
  validateJobMapping(mapping, job, facts);
  const weights = { skill: 0.5, preferred: 0.1, experience: 0.2, education: 0.1, preference: 0.1 };
  const credit = (item: JobMapping['items'][number]) =>
    item.status === 'evidenced' ? 1 : item.status === 'partial' ? 0.5 : 0;
  const required = mapping.items.filter((i) => i.level === 'required');
  const preferred = mapping.items.filter((i) => i.level === 'preferred');
  const average = (items: JobMapping['items']) =>
    items.length ? items.reduce((s, i) => s + credit(i), 0) / items.length : null;
  const location = locationAssessment(profile.location, job.location);
  const components: Record<string, number | null> = {
    skill: average(
      required.filter((i) => ['skill', 'responsibility', 'seniority'].includes(i.category)),
    ),
    preferred: average(preferred),
    experience: average(required.filter((i) => i.category === 'experience')),
    education: average(required.filter((i) => i.category === 'education')),
    preference: location.status === 'unknown' ? null : location.status === 'met' ? 1 : 0,
  };
  const coverage = Object.entries(weights).reduce(
    (s, [k, w]) => s + (components[k] === null ? 0 : w),
    0,
  );
  const points = Object.entries(weights).reduce((s, [k, w]) => s + w * (components[k] || 0), 0);
  const requiredMatches = required.filter((i) => i.status === 'evidenced');
  return {
    job,
    mapping,
    scoringVersion: 'llm-evidence-v1',
    scoringWeights: weights,
    components,
    score: mapping.items.length && coverage ? Math.round((100 * points) / coverage) : 0,
    coverage: Math.round(100 * coverage),
    confidence: mapping.items.length && coverage >= 0.7 ? 'medium' : 'low',
    requirements: {
      required: required.map((i) => i.term),
      preferred: preferred.map((i) => i.term),
      mentioned: [],
      experienceYears: mapping.experienceYears,
      qualification: required.find((i) => i.category === 'education')?.term || 'unspecified',
      confidence: mapping.items.length ? 'medium' : 'low',
      evidence: job.description,
      inferred: false,
      skillEvidence: mapping.items.map((i) => ({
        kind: i.level,
        skills: [i.term],
        text: i.excerpt,
      })),
    },
    matches: requiredMatches.map((i) => i.term),
    preferredMatches: preferred.filter((i) => i.status === 'evidenced').map((i) => i.term),
    gaps: required
      .filter((i) => i.status !== 'evidenced')
      .map(
        (i) =>
          `${i.term}: ${i.status === 'partial' ? 'partial evidence' : 'no approved evidence'} — ${i.reason}`,
      ),
    preferredGaps: preferred.filter((i) => i.status !== 'evidenced').map((i) => i.term),
    assessment: {
      location,
      education: {
        status:
          components.education === null
            ? 'unknown'
            : components.education === 1
              ? 'met'
              : 'not_met',
        reason: 'Mapped against approved evidence; see requirement citations.',
      },
      experience:
        components.experience === null
          ? 'unknown'
          : components.experience === 1
            ? 'met'
            : 'not_met',
    },
    explanation: mapping.items.length
      ? `${requiredMatches.length}/${required.length} employer requirements fully evidenced; ${required.filter((i) => i.status === 'partial').length} partly evidenced. Score covers ${Math.round(coverage * 100)}% of weighted categories; unknown categories earn no credit and are excluded from the denominator.`
      : 'No reliable employer requirements extracted. This listing needs manual review; the score is not evidence of suitability.',
    limitations: [
      'LLM evidence mapping is advisory, not independent verification or a hiring probability.',
      'Up to 16 consolidated requirements per listing; inspect the full source for omitted detail.',
      'Unknown categories are excluded; compare coverage as well as score.',
      'Partial evidence is transferable or limited evidence, not confirmed proficiency.',
    ],
  };
}
