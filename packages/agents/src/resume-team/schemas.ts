import { z } from 'zod';

// Strict-compatible structured outputs (no optional keys) for the Responses API.
export const rewriteSchema = z.object({
  rewrites: z
    .array(
      z.object({
        factId: z.string().min(1).max(180),
        text: z.string().trim().min(1).max(2000),
        reason: z.string().trim().min(1).max(500),
      }),
    )
    .max(20),
});

export const critiqueSchema = z.object({
  issues: z
    .array(
      z.object({
        target: z.enum(['selector', 'rewriter']),
        factId: z.string().max(180).nullable(),
        message: z.string().trim().min(1).max(500),
      }),
    )
    .max(6),
});
