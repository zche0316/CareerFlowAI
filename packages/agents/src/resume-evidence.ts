/** Discard model-selected IDs outside the explicitly eligible approved set. */
export function filterResumeEvidence<T extends { factId: string }>(
  claims: T[],
  eligible: ReadonlySet<string>,
) {
  const accepted = claims.filter((claim) => eligible.has(claim.factId));
  return { accepted, rejectedCount: claims.length - accepted.length };
}
