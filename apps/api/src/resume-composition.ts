import type { Fact } from '../../../packages/contracts/src/index.js';
import { isResumeContribution } from '../../../packages/contracts/src/resume-layout.js';
import { includeRecordHeaders, deduplicateResumeClaims } from './domain.js';
export function composeSelection(
  selected: { factId: string; reason: string }[],
  facts: Fact[],
  jobText = '',
) {
  const result = selected.filter((c) => {
    const f = facts.find((f) => f.id === c.factId);
    return !f || f.kind !== 'experience' || !f.recordHeaderId || isResumeContribution(f);
  });
  // A selected experience header represents the record, not a standalone accomplishment.
  for (const c of [...result]) {
    const header = facts.find((f) => f.id === c.factId);
    if (!header || header.kind !== 'experience' || header.recordHeaderId || !header.recordId)
      continue;
    if (result.some((c) => facts.find((f) => f.id === c.factId)?.recordHeaderId === header.id))
      continue;
    const terms = new Set(jobText.toLowerCase().match(/[a-z]{3,}/g) || []);
    const candidates = facts.filter(
      (f) => f.recordHeaderId === header.id && isResumeContribution(f),
    );
    const score = (f: Fact) =>
      (f.text.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => terms.has(w)).length +
      (/\bI\b|Personal actions|responsib/i.test(f.text) ? 5 : 0) + (/Personal actions:|\bI (?:built|wrote|set|standardised|enhanced|implemented|designed|created)/i.test(f.text) ? 8 : 0) + (/\d|outcome|result|correctness|achiev/i.test(f.text) ? 6 : 0);
    candidates.sort((a, b) => score(b) - score(a));
    for (const f of candidates.slice(0, 2))
      result.push({
        factId: f.id,
        reason: 'Supporting personal contribution for this selected experience.',
      });
    if (!candidates.length) result.splice(result.indexOf(c), 1);
  }
  for (const f of facts.filter((f) => f.kind === 'education' && f.recordId && !f.recordHeaderId))
    if (!result.some((c) => c.factId === f.id))
      result.push({
        factId: f.id,
        reason: 'Approved education retained as baseline resume context.',
      });
  return includeRecordHeaders(deduplicateResumeClaims(result), facts);
}
