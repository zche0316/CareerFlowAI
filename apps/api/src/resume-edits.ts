import { z } from 'zod';
import type { Fact } from '../../../packages/contracts/src/index.js';
import { checkWording } from '../../../packages/contracts/src/career-evidence.js';
import { AppError } from './errors.js';
import { includeRecordHeaders, validateResumeClaims } from './domain.js';

// Omitted items are unchanged, never implicitly deleted by a partial AI response.
export const resumeEditSchema = z.object({
  message: z.string().max(1200).default(''),
  claims: z
    .array(
      z.object({
        factId: z.string().min(1),
        text: z.string().trim().min(1).max(8000),
        reason: z.string().max(1000).default('Requested wording change.'),
      }),
    )
    .max(20)
    .default([]),
  removedFactIds: z.array(z.string().min(1)).max(20).default([]),
});

export function applyResumeEdits(
  previous: any[],
  patch: z.infer<typeof resumeEditSchema>,
  facts: Fact[],
) {
  const removed = new Set(patch.removedFactIds);
  if (
    removed.size !== patch.removedFactIds.length ||
    patch.removedFactIds.some((id) => !previous.some((c) => c.factId === id)) ||
    patch.claims.some((c) => removed.has(c.factId))
  )
    throw new AppError(
      502,
      'RESUME_EDIT_INVALID_RESPONSE',
      'The AI returned conflicting edits. Your draft is unchanged. Please try again.',
    );

  const grounded = validateResumeClaims(patch.claims, facts);
  const updates = new Map(
    grounded.map((claim) => {
      const proposal = patch.claims.find((p) => p.factId === claim.factId)!;
      const invalid = checkWording(claim.text, proposal.text);
      if (invalid)
        throw new AppError(
          422,
          'UNSUPPORTED_WORDING',
          `The suggested rewrite was not applied. ${invalid} Your draft is unchanged.`,
        );
      return [claim.factId, { ...claim, factText: claim.text, text: proposal.text }];
    }),
  );
  const merged = previous
    .filter((c) => !removed.has(c.factId))
    .map((c) => updates.get(c.factId) || c);
  for (const [id, claim] of updates) if (!previous.some((c) => c.factId === id)) merged.push(claim);
  if (!merged.length)
    throw new AppError(
      422,
      'EMPTY_RESUME',
      'Keep at least one resume item. Your draft is unchanged.',
    );
  const validated = validateResumeClaims(includeRecordHeaders(merged, facts), facts);
  return validated.map((c) => merged.find((p) => p.factId === c.factId) || c);
}
