import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { json } from './domain.js';
import { configuredMode, generate } from '../../../packages/agents/src/provider.js';
import { resolveJobLink } from '../../../packages/recruitment/src/job-link.js';
import { matchingProfileView } from '../../../packages/contracts/src/career-evidence.js';
import { compare } from '../../../packages/matching/domain.js';

const extractedJob = z.object({
  title: z.string().max(300),
  company: z.string().max(300),
  location: z.string().max(300),
  description: z.string().max(16000),
});
export function registerJobLink(app: Express) {
  app.post('/api/missions/:id/job-link', async (req, res) => {
    const { url } = z.object({ url: z.string().trim().url().max(2000) }).parse(req.body);
    const id = String(req.params.id),
      userId = req.actor!.id;
    const original = requireValue(
      await db.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    const check = (m: any) => {
      if (!['AWAITING_JOB', 'NO_MATCHES'].includes(m.status) || m.data.selectedJob)
        throw new AppError(
          409,
          'JOB_LINK_NOT_EXPECTED',
          'Start a new journey to change an existing target.',
        );
      if (m.profile.version !== m.user.profileVersion)
        throw new AppError(
          409,
          'STALE_PROFILE',
          'Start a new journey with your latest approved profile.',
        );
      if ((m.data.matches || []).filter((r: any) => r.job.source?.importedFromURL).length >= 10)
        throw new AppError(
          429,
          'JOB_LINK_LIMIT',
          'This journey already has ten imported listings. Start a new journey for more.',
        );
    };
    check(original);
    const locked = async <T>(fn: (m: any, tx: any) => Promise<T>) =>
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
        const m = requireValue(
          await tx.mission.findFirst({
            where: { id, userId },
            include: { profile: true, user: true },
          }),
        );
        check(m);
        return fn(m, tx);
      });
    let job: any;
    try {
      job = await resolveJobLink(url, {
        parseText: async (sourceText: string) => {
          if (
            !/\b(responsibilities|qualifications|requirements|about the role|job description)\b/i.test(
              sourceText,
            )
          )
            throw new Error(
              'No readable job description was found. Try the employer’s original listing.',
            );
          return generate(
            'job-link',
            {
              goal: 'Read the public job listing without inventing details',
              facts: [],
              sourceText,
            },
            extractedJob,
            configuredMode(),
            {
              onCall: async () => {
                await locked(async (m, tx) => {
                  if ((m.data.apiCalls || 0) >= 12)
                    throw new AppError(
                      429,
                      'BUDGET_EXCEEDED',
                      'This journey reached its model-call limit. Start a new journey.',
                    );
                  await tx.mission.update({
                    where: { id },
                    data: { data: json({ ...m.data, apiCalls: (m.data.apiCalls || 0) + 1 }) },
                  });
                });
              },
              onTool: async () => {},
              onUsage: async () => {},
            },
          );
        },
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      const message = (e as Error).message;
      throw new AppError(
        422,
        'JOB_LINK_UNREADABLE',
        /^(Paste |Use |This |The link |No |Job page |The job details)/.test(message)
          ? message
          : 'Could not read this public job page. Try the employer’s original listing.',
      );
    }
    const result = await locked(async (m, tx) => {
      const previous = m.data.matches || [];
      const corpus = [job, ...previous.map((r: any) => r.job)].map(
        (j: any) => j.title + ' ' + j.description,
      );
      const match = compare(matchingProfileView(m.profile.data), job, corpus);
      const matches = [
        match,
        ...previous.filter(
          (r: any) => r.job.id !== job.id && r.job.applicationUrl !== job.applicationUrl,
        ),
      ];
      await tx.mission.update({
        where: { id },
        data: {
          status: 'AWAITING_JOB',
          error: null,
          data: json({ ...m.data, matches }),
          events: json([
            ...(m.events || []),
            {
              at: new Date().toISOString(),
              agent: 'Job Matcher',
              action: 'job_link_read',
              detail: 'Read a user-supplied listing URL. Waiting for target selection.',
            },
          ]),
        },
      });
      return { jobId: job.id };
    });
    res.json(result);
  });
}
