import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { digest, json, ownedMission } from './domain.js';
import { AppError, requireValue } from './errors.js';
import {
  officialApplicationFields,
  fieldGaps,
} from '../../../packages/recruitment/src/application-fields.js';
export function registerApplicationReadiness(app: Express) {
  app.get('/api/missions/:id/application-readiness', async (req, res) => {
    const m = await ownedMission(req.actor!.id, String(req.params.id));
    const job = requireValue((m.data as any).selectedJob?.job);
    const user = await db.user.findUniqueOrThrow({ where: { id: m.userId } });
    if (user.profileVersion !== m.profile.version)
      throw new AppError(
        409,
        'STALE_PROFILE',
        'Start a mission using your current approved profile.',
      );
    const resume = await db.approvedResume.findFirst({
      where: { id: (m.data as any).approvedResumeId || '', userId: m.userId },
    });
    let source;
    try {
      source = await officialApplicationFields(job, m.profile.data, !!resume);
    } catch {
      source = {
        fields: [],
        schemaKnown: false,
        sourceUrl: null,
        notice:
          'Official application field retrieval failed. Previous saved answers remain intact. Retry explicitly or check the official application page.',
      };
    }
    const hash = digest({ job: job.id, profile: m.profile.id, fields: source.fields });
    res.json(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${m.id} FOR UPDATE`;
        const fresh = requireValue(
          await tx.mission.findFirst({
            where: { id: m.id, userId: m.userId },
            include: { user: true },
          }),
        );
        if (
          fresh.user.profileVersion !== m.profile.version ||
          (fresh.data as any).selectedJob?.job.id !== job.id
        )
          throw new AppError(409, 'STALE_APPLICATION', 'Application context changed.');
        const d = fresh.data as any,
          previous = d.applicationReadiness;
        const answers = previous?.hash === hash ? previous.answers : {};
        const result = {
          ...source,
          hash,
          answers,
          checkedAt: new Date().toISOString(),
          fields: fieldGaps(source.fields, answers),
          scope: 'preparation-only; no submission or employer eligibility decision',
        };
        if (source.fields.length)
          await tx.mission.update({
            where: { id: m.id },
            data: {
              data: json({ ...d, applicationReadiness: { ...result, fields: source.fields } }),
            },
          });
        return result;
      }),
    );
  });
  app.post('/api/missions/:id/application-readiness', async (req, res) => {
    const input = z
      .object({
        hash: z.string(),
        answers: z.record(z.string().max(180), z.string().max(2000)),
        reviewed: z.literal(true),
      })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        const id = String(req.params.id),
          userId = req.actor!.id;
        await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
        const m = requireValue(
          await tx.mission.findFirst({
            where: { id, userId },
            include: { user: true, profile: true },
          }),
        );
        const d = m.data as any,
          saved = d.applicationReadiness;
        if (m.user.profileVersion !== m.profile.version || !saved || saved.hash !== input.hash)
          throw new AppError(
            409,
            'STALE_APPLICATION',
            'Reload current application questions before saving.',
          );
        const allowed = new Set(saved.fields.map((f: any) => f.id));
        if (Object.keys(input.answers).some((k) => !allowed.has(k)))
          throw new AppError(
            422,
            'INVALID_APPLICATION_FIELD',
            'Answer only the current displayed fields.',
          );
        const fields = fieldGaps(saved.fields, input.answers);
        const result = {
          ...saved,
          answers: input.answers,
          fields,
          missingCount: fields.filter((f) => f.missing).length,
        };
        await tx.mission.update({
          where: { id },
          data: { data: json({ ...d, applicationReadiness: { ...result, fields: saved.fields } }) },
        });
        return result;
      }),
    );
  });
}
