import { resumeBullet } from './resume-layout.js';

export type ResumeChange = {
  factId: string;
  before: string;
  after: string;
  beforeClaim?: any;
  beforeIndex: number;
};
// Compare the text the reader actually sees: removing "I" is already done by
// the resume renderer and must not be reported as a visible wording change.
export const visibleResumeText = (claim: { kind?: string; text: string }) =>
  claim.kind === 'experience' ? resumeBullet(claim.text) : claim.text.trim();

export function pendingResumeChanges(draft: { claims: any[] }, saved?: ResumeChange[]) {
  if (saved) return saved;
  // Earlier drafts retained their source wording but not a review list. Recover
  // only verifiable differences, never invent an earlier draft or model output.
  return resumeChanges(
    draft.claims.map((c) => (c.factText ? { ...c, text: c.factText } : c)),
    draft.claims,
  );
}

export function resumeChanges(previous: any[], next: any[], pending: ResumeChange[] = []) {
  const changes = new Map(pending.map((change) => [change.factId, change]));
  for (const id of new Set([...previous.map((c) => c.factId), ...next.map((c) => c.factId)])) {
    const old = previous.find((c) => c.factId === id),
      after = next.find((c) => c.factId === id);
    const baseline = changes.get(id);
    const beforeClaim = baseline ? baseline.beforeClaim : old;
    const before = beforeClaim ? visibleResumeText(beforeClaim) : '';
    const text = after ? visibleResumeText(after) : '';
    if (before === text) changes.delete(id);
    else
      changes.set(id, {
        factId: id,
        before,
        after: text,
        beforeIndex: baseline?.beforeIndex ?? previous.findIndex((c) => c.factId === id),
        ...(beforeClaim ? { beforeClaim } : {}),
      });
  }
  return [...changes.values()];
}
