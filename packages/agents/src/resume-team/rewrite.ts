import { checkWording } from '../../../contracts/src/career-evidence.js';
import type { Fact } from '../../../contracts/src/index.js';

export type DraftClaim = {
  factId: string;
  text: string;
  factText?: string;
  kind?: string;
  recordId?: string;
  recordHeaderId?: string;
  [key: string]: unknown;
};

export type RewriteProposal = { factId: string; text: string; reason: string };

// Only personal contribution statements are reworded. Headers, skills and education stay verbatim.
export const isRewritable = (c: DraftClaim) =>
  c.kind === 'experience' && Boolean(c.recordHeaderId || !c.recordId);

// Rewriter output is a proposal. Each wording must pass the same deterministic guard as manual
// edits (checkWording): same numbers, qualifiers and source terms. Blocked wording keeps the fact.
export function applyRewrites(
  claims: DraftClaim[],
  proposals: RewriteProposal[],
  facts: Pick<Fact, 'id' | 'text'>[],
) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const proposed = new Map(proposals.map((p) => [p.factId, p]));
  let accepted = 0;
  const blocked: { factId: string; reason: string }[] = [];
  const next = claims.map((claim): DraftClaim => {
    const proposal = proposed.get(claim.factId);
    const fact = byId.get(claim.factId);
    if (!proposal || !fact || !isRewritable(claim)) return claim;
    const text = proposal.text.trim();
    if (text === fact.text) {
      const { factText: _, ...verbatim } = claim;
      return { ...verbatim, text: fact.text };
    }
    const reason = checkWording(fact.text, text);
    if (reason) {
      blocked.push({ factId: claim.factId, reason });
      return claim;
    }
    accepted += 1;
    return { ...claim, factText: fact.text, text, rewriteReason: proposal.reason.slice(0, 300) };
  });
  return { claims: next, accepted, blocked };
}
