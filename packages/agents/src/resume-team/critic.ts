import { checkResumeWording } from '../../../contracts/src/resume-grounding.js';
import type { Fact } from '../../../contracts/src/index.js';
import { coversTerm } from './gap-analysis.js';
import type { DraftClaim } from './rewrite.js';
import type { Critique, CritiqueIssue, GapReport } from './types.js';

const MAX_MISSING_EVIDENCE_ISSUES = 3;
const ratio = (n: number, d: number) => (d ? Math.round((100 * n) / d) / 100 : null);

// Critic (rules): deterministic checks that never depend on a model being honest.
// 1. Grounding: every claim is an approved fact.
// 2. Wording: rewritten text still passes the evidence wording guard.
// 3. Coverage: a supported job requirement is not left out when approved evidence exists.
// Rules cannot repair a draft when no job requirement has approved evidence, so the critic still
// hands it to the user, but this must be shown as a warning rather than a clean pass.
export const lacksJobEvidence = (c: Pick<Critique, 'metrics'>) =>
  (c.metrics.totalRequirements ?? 0) > 0 && c.metrics.supportedRequirements === 0;

export function reviewDraft(input: {
  round: number;
  claims: DraftClaim[];
  facts: Pick<Fact, 'id' | 'text'>[];
  gaps: GapReport | null;
  eligibleFactIds: Set<string>;
  rewrites?: { accepted: number; blocked: unknown[] } | null;
}): Critique {
  const byId = new Map(input.facts.map((f) => [f.id, f]));
  const issues: CritiqueIssue[] = [];
  for (const claim of input.claims) {
    const fact = byId.get(claim.factId);
    if (!fact) {
      issues.push({
        target: 'selector',
        code: 'UNGROUNDED',
        factId: claim.factId,
        message: `${claim.factId} is not an approved fact in this profile version.`,
      });
      continue;
    }
    if (claim.text === fact.text) continue;
    const drift =
      claim.factText !== undefined && claim.factText !== fact.text
        ? 'The recorded source text does not match the approved fact.'
        : checkResumeWording(fact.text, claim.text);
    if (drift)
      issues.push({
        target: 'rewriter',
        code: 'WORDING_DRIFT',
        factId: claim.factId,
        message: drift,
      });
  }

  const selected = new Set(input.claims.map((c) => c.factId));
  const supported = (input.gaps?.requirements || []).filter(
    (r) => r.status !== 'not_evidenced' && r.factIds.length,
  );
  let missing = 0;
  for (const r of supported) {
    if (r.factIds.some((id) => selected.has(id))) continue;
    const candidate = r.factIds.find((id) => input.eligibleFactIds.has(id));
    if (!candidate || missing >= MAX_MISSING_EVIDENCE_ISSUES) continue;
    missing += 1;
    issues.push({
      target: 'selector',
      code: 'MISSING_EVIDENCE',
      factId: candidate,
      message: `"${r.term}" (${r.level}) has approved evidence ${candidate} that the draft omits.`,
    });
  }

  const draftText = input.claims.map((c) => c.text).join('\n');
  const allTerms = (input.gaps?.requirements || []).map((r) => r.term);
  return {
    round: input.round,
    pass: issues.length === 0,
    reviewer: 'rules',
    issues,
    metrics: {
      requirementCoverage: ratio(
        supported.filter((r) => r.factIds.some((id) => selected.has(id))).length,
        supported.length,
      ),
      supportedRequirements: supported.length,
      totalRequirements: allTerms.length,
      keywordCoverage: ratio(
        allTerms.filter((t) => coversTerm(draftText, t)).length,
        allTerms.length,
      ),
      rewrittenClaims: input.rewrites?.accepted ?? 0,
      blockedRewrites: input.rewrites?.blocked.length ?? 0,
    },
  };
}
