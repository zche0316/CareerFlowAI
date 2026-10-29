import { composeSelection } from './resume-composition.js';
import {
  resumeRecordIndex,
  resumeObjective,
} from '../../../packages/contracts/src/resume-layout.js';
import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { digest, json, includeRecordHeaders, validateResumeClaims } from './domain.js';
import type { Fact } from '../../../packages/contracts/src/index.js';
import { AppError, requireValue } from './errors.js';
export function registerApplicationVersions(app: Express) {
  app.post('/api/missions/:id/resume-selection', async (req, res) => {
    const input = z
      .object({
        draftHash: z.string(),
        orderedFactIds: z.array(z.string().min(1).max(220)).min(1).max(20),
      })
      .parse(req.body);
    if (new Set(input.orderedFactIds).size !== input.orderedFactIds.length)
      throw new AppError(422, 'DUPLICATE_FACT', 'Choose each source fact once.');
    res.json(
      await db.$transaction(async (tx) => {
        const id = String(req.params.id),
          userId = req.actor!.id;
        await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
        const m = requireValue(
          await tx.mission.findFirst({
            where: { id, userId },
            include: { profile: true, user: true },
          }),
        );
        const d = m.data as any;
        if (
          m.status !== 'AWAITING_APPROVAL' ||
          m.user.profileVersion !== m.profile.version ||
          d.resumeDraft?.hash !== input.draftHash
        )
          throw new AppError(409, 'STALE_APPROVAL', 'Review the current unapproved resume draft.');
        const facts = m.profile.facts as unknown as Fact[];
        const claims = validateResumeClaims(
          composeSelection(
            input.orderedFactIds.map((factId) => ({
              factId,
              reason: 'Explicit user selection for this target job.',
            })),
            facts,
            d.selectedJob?.job?.description || '',
          ),
          facts,
        );
        const { hash: _, ...old } = d.resumeDraft;
        const content = {
          ...old,
          records: resumeRecordIndex(m.profile.data),
          summary: resumeObjective(old.jobTitle, claims),
          claims,
          omittedFacts: facts.filter(
            (f) =>
              ['skill', 'education', 'experience'].includes(f.kind) &&
              !claims.some((c) => c.factId === f.id),
          ),
          selectionRevision: (old.selectionRevision || 0) + 1,
        };
        const resumeDraft = { ...content, hash: digest(content) };
        await tx.mission.update({
          where: { id },
          data: {
            data: json({ ...d, resumeDraft }),
            events: json([
              ...(m.events as any[]),
              {
                at: new Date().toISOString(),
                agent: 'Job Seeker',
                action: 'selection_changed',
                detail:
                  'Selected and ordered source statements; draft hash changed and requires fresh approval.',
              },
            ]),
          },
        });
        return { resumeDraft };
      }),
    );
  });
  app.post('/api/missions/:id/feedback-memory', async (req, res) => {
    z.object({ saveAsDraft: z.literal(true) }).parse(req.body);
    const m = requireValue(
      await db.mission.findFirst({ where: { id: String(req.params.id), userId: req.actor!.id } }),
    );
    const feedback = (m.data as any).feedback;
    if (!feedback)
      throw new AppError(
        409,
        'NO_FEEDBACK',
        'Complete or finish your interview early before saving feedback.',
      );
    const quote = [...feedback.strengths, ...feedback.improvements, ...feedback.nextSteps].join(
      '\n',
    );
    const previous = await db.careerMemory.findFirst({
      where: {
        userId: m.userId,
        missionId: m.id,
        kind: 'NOTE',
        source: { path: ['kind'], equals: 'interview' },
        status: { not: 'DELETED' },
      },
    });
    if (previous) return res.json(previous);
    res.status(201).json(
      await db.careerMemory.create({
        data: {
          userId: m.userId,
          missionId: m.id,
          kind: 'NOTE',
          title: 'Interview learning — review against real experience',
          text: 'Practice feedback only; not a verified qualification.\n' + quote,
          star: {},
          source: json({ kind: 'interview', id: m.id, quote }),
          status: 'DRAFT',
        },
      }),
    );
  });
}
