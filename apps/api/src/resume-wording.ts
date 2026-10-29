import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { digest, json } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { checkWording } from '../../../packages/contracts/src/career-evidence.js';
import { generate, configuredMode } from '../../../packages/agents/src/provider.js';
import { modelRoute } from '../../../packages/agents/src/router.js';
const owner = (userId: string, id: string) =>
  db.approvedResume.findFirst({ where: { id, userId } }).then(requireValue);

export function registerResumeWording(app: Express) {
  app.get('/api/resumes/:id/wording', async (req, res) => {
    const r = await owner(req.actor!.id, String(req.params.id));
    res.json(
      await db.resumeWording.findMany({
        where: { resumeId: r.id, userId: r.userId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
  app.post('/api/resumes/:id/wording', async (req, res) => {
    const input = z
      .object({ factId: z.string().min(1).max(180), consent: z.literal(true) })
      .parse(req.body);
    const r = await owner(req.actor!.id, String(req.params.id)),
      content = r.content as any;
    const claim = requireValue(content.claims.find((c: any) => c.factId === input.factId));
    if (claim.text.length > 8000)
      throw new AppError(422, 'WORDING_SIZE', 'Use a shorter approved claim for wording review.');
    const p = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${r.userId} FOR UPDATE`;
      if (
        (await tx.resumeWording.count({
          where: { userId: r.userId, createdAt: { gte: new Date(Date.now() - 3600000) } },
        })) >= 20
      )
        throw new AppError(429, 'WORDING_LIMIT', 'Up to twenty wording suggestions per hour.');
      return tx.resumeWording.create({
        data: {
          userId: r.userId,
          resumeId: r.id,
          factId: claim.factId,
          sourceHash: digest(content),
          before: claim.text,
          after: '',
          reason: 'Processing',
          status: 'PROCESSING',
          model: configuredMode() === 'fixture' ? 'fixture' : modelRoute('text').model,
        },
      });
    });
    try {
      const result = await generate(
        'wording',
        { goal: 'Conservative resume expression review', facts: [], sourceText: claim.text },
        z.object({ text: z.string().trim().min(1).max(8000), reason: z.string().max(1000) }),
        configuredMode(),
        { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
      );
      const invalid = checkWording(claim.factText || claim.text, result.text);
      res.status(201).json(
        await db.resumeWording.update({
          where: { id: p.id },
          data: {
            after: result.text,
            reason: invalid || result.reason,
            status: invalid ? 'BLOCKED' : result.text === claim.text ? 'NO_CHANGE' : 'PENDING',
          },
        }),
      );
    } catch {
      await db.resumeWording.update({
        where: { id: p.id },
        data: {
          status: 'FAILED',
          reason: 'Model processing failed. Original approved facts and documents are unchanged.',
        },
      });
      throw new AppError(
        503,
        'WORDING_UNAVAILABLE',
        'Could not generate wording. Your approved resume is unchanged. Retry explicitly.',
      );
    }
  });
  app.patch('/api/resume-wordings/:id', async (req, res) => {
    const input = z
      .object({
        decision: z.enum(['accept', 'reject']),
        reviewed: z.literal(true),
        after: z.string().trim().min(1).max(8000).optional(),
      })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        const p = requireValue(
          await tx.resumeWording.findFirst({
            where: { id: String(req.params.id), userId: req.actor!.id },
          }),
        );
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${p.userId} FOR UPDATE`;
        if (p.status !== 'PENDING')
          throw new AppError(
            409,
            'STALE_WORDING',
            'This suggestion is already decided or unavailable.',
          );
        const resume = requireValue(
          await tx.approvedResume.findFirst({ where: { id: p.resumeId, userId: p.userId } }),
        );
        if (digest(resume.content) !== p.sourceHash)
          throw new AppError(409, 'STALE_WORDING', 'Original approved content changed.');
        const after = input.after || p.after;
        const claim = (resume.content as any).claims.find((c: any) => c.factId === p.factId);
        const invalid = checkWording(claim.factText || p.before, after);
        if (input.decision === 'accept' && invalid)
          throw new AppError(422, 'UNSUPPORTED_WORDING', invalid);
        if (input.decision === 'accept')
          await tx.resumeWording.updateMany({
            where: { userId: p.userId, resumeId: p.resumeId, factId: p.factId, status: 'ACCEPTED' },
            data: { status: 'SUPERSEDED' },
          });
        const changed = await tx.resumeWording.updateMany({
          where: { id: p.id, status: 'PENDING' },
          data: { status: input.decision === 'accept' ? 'ACCEPTED' : 'REJECTED', after },
        });
        if (!changed.count)
          throw new AppError(409, 'STALE_WORDING', 'Suggestion changed; reload it.');
        return tx.resumeWording.findUniqueOrThrow({ where: { id: p.id } });
      }),
    );
  });
  app.post('/api/resumes/:id/wording/finalize', async (req, res) => {
    z.object({ reviewed: z.literal(true) }).parse(req.body);
    const original = await owner(req.actor!.id, String(req.params.id));
    res.status(201).json(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${original.userId} FOR UPDATE`;
        const accepted = await tx.resumeWording.findMany({
          where: {
            resumeId: original.id,
            userId: original.userId,
            status: 'ACCEPTED',
            sourceHash: digest(original.content),
          },
          orderBy: { id: 'asc' },
        });
        if (!accepted.length)
          throw new AppError(
            409,
            'NO_REVIEWED_WORDING',
            'Accept at least one wording suggestion first.',
          );
        const base = original.content as any;
        const content = {
          ...base,
          parentResumeId: original.id,
          wordingReview: accepted.map((p) => ({
            id: p.id,
            factId: p.factId,
            before: p.before,
            after: p.after,
            sourceHash: p.sourceHash,
          })),
          claims: base.claims.map((c: any) => {
            const p = accepted.find((p) => p.factId === c.factId);
            if (!p) return c;
            const invalid = checkWording(c.factText || c.text, p.after);
            if (invalid) throw new AppError(422, 'UNSUPPORTED_WORDING', invalid);
            return { ...c, factText: c.factText || c.text, text: p.after, wordingId: p.id };
          }),
        };
        const draftHash = digest(content);
        // A distinct immutable approved snapshot; never mutate the original facts or resume.
        return tx.approvedResume.upsert({
          where: { draftHash },
          update: {},
          create: {
            userId: original.userId,
            missionId: original.missionId,
            draftHash,
            content: json(content),
          },
        });
      }),
    );
  });
}
