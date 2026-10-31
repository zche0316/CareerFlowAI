import {
  JobRepository,
  recruitmentSettings,
} from '../../../packages/recruitment/src/repository.js';
import { toolsDashboard, runTool, toolCommand, exportReminder } from './tools.js';
import { prepareApplication, recordApplication, applicationRecordSchema } from './recruitment.js';
import express from 'express';
import { resumeText, resumeDocx, resumePdf } from '../../../packages/documents/src/resume.js';
import { registerProfileImports } from './profile-import.js';
import { registerExperienceOrganisation } from './experience-organisation.js';
import { registerProfileConversations } from './profile-conversations.js';
import { registerCareerMemory } from './career-memory.js';
import { registerProfilePolish } from './profile-polish.js';
import { registerResumeWording } from './resume-wording.js';
import { registerResumeAgent } from './resume-agent.js';
import { registerApplicationReadiness } from './application-readiness.js';
import { registerJobFit } from './job-fit.js';
import { registerApplicationVersions } from './application-versions.js';
import { routerSettings } from '../../../packages/agents/src/router.js';
import { suggestJobSearch } from '../../../packages/contracts/src/job-search.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import {
  authenticate,
  needAuth,
  verifyWrite,
  passwordHash,
  verifyPassword,
  createSession,
} from './auth.js';
import {
  createDraft,
  approveProfile,
  ownedMission,
  queueDecision,
  saveInterviewAnswer,
  cancelMission,
  json,
  type MissionData,
  type Event,
} from './domain.js';
import { AppError, requireValue } from './errors.js';
import { enqueue, abortRun } from './queue.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { prepareProfileBuilderDraft } from './profile-builder.js';
import { decideNegotiationPractice, runNegotiationPractice } from './negotiation.js';
import {
  decisionSchema,
  jobSearchSchema,
  answerSchema,
  sampleProfile,
  AGENTS,
} from '../../../packages/contracts/src/index.js';

const credentials = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(100).optional(),
});

function requestId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : randomUUID();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/profiles/imports', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '150kb' }));
  app.use((req, res, next) => {
    const id = requestId(req.get('X-Request-ID'));
    res.locals.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(authenticate);
  app.use(verifyWrite);
  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', mode: configuredMode(), agents: AGENTS });
  });
  app.get('/api/session', (req, res) =>
    res.json({
      user: req.actor || null,
      csrf: req.session?.csrf || null,
      mode: configuredMode(),
      recruitment: recruitmentSettings(),
      router: routerSettings(),
      demoEnabled: process.env.ENABLE_DEMO_LOGIN === 'true',
    }),
  );

  // Bound repeated login attempts locally; a multi-instance deployment needs a shared limiter.
  const attempts = new Map<string, { count: number; until: number }>();
  app.use('/api/auth', (req, _res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const item = attempts.get(key);
    if (item && item.until > now && item.count >= 30)
      return next(new AppError(429, 'RATE_LIMIT', 'Too many sign-in attempts. Try again later.'));
    attempts.set(key, {
      count: item && item.until > now ? item.count + 1 : 1,
      until: item && item.until > now ? item.until : now + 60000,
    });
    if (attempts.size > 1000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    next();
  });
  app.post('/api/auth/register', async (req, res) => {
    const input = credentials.parse(req.body);
    const exists = await db.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError(409, 'EMAIL_EXISTS', 'This email is already registered.');
    const user = await db.user.create({
      data: {
        email: input.email,
        name: input.name || input.email.split('@')[0],
        passwordHash: passwordHash(input.password),
      },
    });
    const csrf = await createSession(user.id, res);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email }, csrf });
  });
  app.post('/api/auth/login', async (req, res) => {
    const input = credentials.parse(req.body);
    const u = await db.user.findUnique({ where: { email: input.email } });
    if (!u || !verifyPassword(input.password, u.passwordHash))
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const csrf = await createSession(u.id, res);
    res.json({ user: { id: u.id, name: u.name, email: u.email }, csrf });
  });
  app.post('/api/auth/demo', async (_req, res) => {
    if (process.env.ENABLE_DEMO_LOGIN !== 'true')
      throw new AppError(404, 'DEMO_DISABLED', 'Demo sign-in is disabled.');
    const email = 'demo@careerflow.local';
    const u = await db.user.upsert({
      where: { email },
      create: {
        email,
        name: 'Alex Morgan',
        passwordHash: passwordHash(randomBytes(32).toString('hex')),
      },
      update: {},
    });
    res.json({
      user: { id: u.id, name: u.name, email: u.email },
      csrf: await createSession(u.id, res),
    });
  });
  app.post('/api/logout', needAuth, async (req, res) => {
    await db.session.deleteMany({ where: { id: req.session!.id } });
    res.setHeader('Set-Cookie', 'cf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // Everything below this boundary requires a signed-in user and owner-scoped domain queries.
  app.use('/api', needAuth);
  app.get('/api/workspace', async (req, res) => {
    const userId = req.actor!.id;
    const [profile, missions, resumes] = await Promise.all([
      db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } }),
      db.mission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 40 }),
      db.approvedResume.findMany({ where: { userId }, orderBy: { approvedAt: 'desc' }, take: 20 }),
    ]);
    res.json({ profile, missions, resumes, sampleProfile, agents: AGENTS, mode: configuredMode() });
  });

  app.get('/api/tools/dashboard', async (req, res) =>
    res.json(await toolsDashboard(req.actor!.id)),
  );
  app.post('/api/missions/:id/tools', async (req, res) =>
    res.json(await runTool(req.actor!.id, String(req.params.id), toolCommand.parse(req.body))),
  );
  app.get('/api/missions/:id/reminders/:reminderId/calendar', async (req, res) =>
    res.json(
      await exportReminder(req.actor!.id, String(req.params.id), String(req.params.reminderId)),
    ),
  );

  // Profile editing and explicit approval are separate operations.
  app.post('/api/profiles/prepare', async (req, res) => {
    const { notes, currentProfile } = z
      .object({
        notes: z.string().trim().min(10).max(10000),
        currentProfile: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);
    const existingProfile = await db.profile.findFirst({
      where: { userId: req.actor!.id },
      orderBy: { version: 'desc' },
    });
    try {
      res.json(
        await prepareProfileBuilderDraft({
          notes,
          currentProfile,
          existingProfile: existingProfile?.data,
          mode: configuredMode(),
        }),
      );
    } catch (error) {
      console.error('Profile Builder failed:', error);
      throw new AppError(
        503,
        'PROFILE_BUILDER_UNAVAILABLE',
        'Profile Builder is unavailable. Your form and previously approved profile are unchanged; continue manually or retry.',
      );
    }
  });
  registerProfileImports(app);
  registerProfileConversations(app);
  registerExperienceOrganisation(app);
  registerCareerMemory(app);
  registerResumeWording(app);
  registerResumeAgent(app);
  registerProfilePolish(app);
  registerJobFit(app);
  registerApplicationReadiness(app);
  registerApplicationVersions(app);
  app.post('/api/profiles/drafts', async (req, res) =>
    res.status(201).json(await createDraft(req.actor!.id, req.body)),
  );
  app.post('/api/profiles/drafts/:id/approve', async (req, res) => {
    z.object({ reviewed: z.literal(true) }).parse(req.body);
    res.json(await approveProfile(req.actor!.id, String(req.params.id)));
  });
  app.delete('/api/profiles/drafts/:id', async (req, res) => {
    const r = await db.profileDraft.updateMany({
      where: { id: String(req.params.id), userId: req.actor!.id, status: 'DRAFT' },
      data: { status: 'DISCARDED' },
    });
    if (!r.count) throw new AppError(404, 'NOT_FOUND', 'Draft unavailable.');
    res.json({ ok: true });
  });

  // Capture the approved profile and advisory history before scheduling durable background work.
  app.post('/api/missions', async (req, res) => {
    const { goal, minScore, simulateSourceFailure, analysisFeedback, sourceMissionId, jobSearch } =
      z
        .object({
          goal: z.string().trim().min(5).max(2000),
          minScore: z.number().min(0).max(100).default(40),
          simulateSourceFailure: z.boolean().default(false),
          analysisFeedback: z.string().trim().max(2000).default(''),
          sourceMissionId: z.string().uuid().optional(),
          jobSearch: jobSearchSchema.default(
            jobSearchSchema.parse({
              provider: recruitmentSettings().defaults.provider,
              board: 'spaceship',
              country: recruitmentSettings().defaults.country,
              region: '',
              location: '',
              keyword: '',
            }),
          ),
        })
        .parse(req.body);
    const profile = await db.profile.findFirst({
      where: { userId: req.actor!.id },
      orderBy: { version: 'desc' },
    });
    if (!profile)
      throw new AppError(409, 'PROFILE_REQUIRED', 'Review and approve a career profile first.');
    if (sourceMissionId) {
      const source = await db.mission.findFirst({
        where: { id: sourceMissionId, userId: req.actor!.id },
      });
      if (!source) throw new AppError(404, 'NOT_FOUND', 'Source mission unavailable.');
      if (!(source.data as MissionData).analysis)
        throw new AppError(
          422,
          'ANALYSIS_REQUIRED',
          'Career guidance must be available before requesting a refinement.',
        );
      if (source.profileId !== profile.id)
        throw new AppError(
          409,
          'STALE_PROFILE',
          'The source mission used a different profile version. Start a new mission.',
        );
      if (analysisFeedback.length < 3)
        throw new AppError(
          422,
          'FEEDBACK_REQUIRED',
          'Describe what the Career Coach should revisit.',
        );
    }
    const suggestions = suggestJobSearch(profile.data as any);
    const search = {
      ...jobSearch,
      keyword: jobSearch.keyword || suggestions.keyword,
      location: jobSearch.location || (jobSearch.country === 'au' ? suggestions.location : ''),
    };
    const previous = await db.mission.findFirst({
      where: { userId: req.actor!.id, status: 'COMPLETE' },
      orderBy: { updatedAt: 'desc' },
    });
    const previousData = previous?.data as MissionData | undefined;
    const priorFeedback = previousData?.feedback
      ? {
          jobTitle: previousData.selectedJob?.job.title || 'Previous practice',
          improvements: previousData.feedback.improvements,
          nextSteps: previousData.feedback.nextSteps,
          recordedAt: previous!.updatedAt.toISOString(),
        }
      : null;
    const mission = await db.mission.create({
      data: {
        userId: req.actor!.id,
        profileId: profile.id,
        goal,
        mode: configuredMode(),
        data: json({
          revisions: 0,
          answers: [],
          apiCalls: 0,
          priorFeedback,
          minScore,
          jobSearch: search,
          agentAccess: 'all-approved-profile',
          simulateSourceFailure: process.env.ENABLE_DEMO_LOGIN === 'true' && simulateSourceFailure,
          analysisFeedback,
          ...(sourceMissionId ? { refinedFromMissionId: sourceMissionId } : {}),
        }),
        events: json([
          {
            at: new Date().toISOString(),
            agent: 'Orchestrator',
            action: 'queued',
            detail: sourceMissionId
              ? `Refinement mission queued from ${sourceMissionId} using approved profile v${profile.version}`
              : 'Mission queued using approved profile v' + profile.version,
          },
        ]),
      },
    });
    await enqueue(mission.id).catch(() => {});
    res.status(202).json(mission);
  });

  // Human actions update mission state before the queue resumes the saved graph.
  app.get('/api/missions/:id', async (req, res) =>
    res.json(await ownedMission(req.actor!.id, String(req.params.id))),
  );
  app.get('/api/missions/:id/application', async (req, res) =>
    res.json(await prepareApplication(req.actor!.id, String(req.params.id))),
  );
  app.post('/api/missions/:id/applications', async (req, res) =>
    res.json(
      await recordApplication(
        req.actor!.id,
        String(req.params.id),
        applicationRecordSchema.parse(req.body),
      ),
    ),
  );
  app.get('/api/missions/:id/jobs/:jobId/availability', async (req, res) => {
    const m = await ownedMission(req.actor!.id, String(req.params.id));
    const selected = (m.data as MissionData).matches?.find(
      (r: any) => r.job.id === String(req.params.jobId),
    );
    if (!selected) throw new AppError(404, 'NOT_FOUND', 'Job unavailable.');
    res.json(await new JobRepository().revalidate(selected.job));
  });
  app.post('/api/missions/:id/decisions', async (req, res) => {
    const decision = decisionSchema.parse(req.body);
    if (decision.kind === 'job') {
      const mission = await ownedMission(req.actor!.id, String(req.params.id));
      const data = mission.data as MissionData;
      const selected = data.matches?.find((r: any) => r.job.id === decision.jobId);
      if (['greenhouse', 'lever', 'ashby'].includes(selected?.job.source?.provider)) {
        let check;
        try {
          check = await new JobRepository().revalidate(selected.job);
        } catch {
          throw new AppError(
            503,
            'VACANCY_CHECK_UNAVAILABLE',
            'Cannot recheck this vacancy now. Retry selection later; nothing was selected.',
          );
        }
        if (check.status !== 'published_at_check')
          throw new AppError(
            409,
            'VACANCY_CLOSED',
            'This vacancy was removed from the official API. Choose another result or run a new search.',
          );
      }
    }

    const m = await queueDecision(req.actor!.id, String(req.params.id), decision);
    await enqueue(m.id).catch(() => {});
    res.status(202).json(m);
  });
  app.post('/api/missions/:id/negotiation', async (req, res) =>
    res
      .status(201)
      .json(await runNegotiationPractice(req.actor!.id, String(req.params.id), req.body)),
  );
  app.put('/api/missions/:id/negotiation/decision', async (req, res) =>
    res.json(await decideNegotiationPractice(req.actor!.id, String(req.params.id), req.body)),
  );
  app.put('/api/missions/:id/answers', async (req, res) =>
    res.json(
      await saveInterviewAnswer(req.actor!.id, String(req.params.id), answerSchema.parse(req.body)),
    ),
  );
  app.post('/api/missions/:id/cancel', async (req, res) => {
    const id = String(req.params.id);
    res.json(await cancelMission(req.actor!.id, id));
    abortRun(id);
  });
  app.post('/api/missions/:id/retry', async (req, res) => {
    const m = await ownedMission(req.actor!.id, String(req.params.id));
    const u = await db.user.findUniqueOrThrow({ where: { id: req.actor!.id } });
    if (m.profile.version !== u.profileVersion)
      throw new AppError(
        409,
        'STALE_PROFILE',
        'Start a new mission with your current approved profile.',
      );
    const changed = await db.mission.updateMany({
      where: { id: m.id, status: 'FAILED' },
      data: {
        status: 'QUEUED',
        error: null,
        data: json({ ...(m.data as MissionData), simulateSourceFailure: false }),
      },
    });
    if (!changed.count)
      throw new AppError(409, 'RETRY_NOT_AVAILABLE', 'Only a failed step can be retried.');
    await enqueue(m.id).catch(() => {});
    res.status(202).json({ ok: true });
  });

  // Export persisted approved content rather than a mutable draft supplied by the browser.
  app.get('/api/resumes/:id/download', async (req, res) => {
    const r = requireValue(
      await db.approvedResume.findFirst({
        where: { id: String(req.params.id), userId: req.actor!.id },
      }),
    );
    const c = r.content as any;
    const format = z.enum(['txt', 'pdf', 'docx']).parse(req.query.format || 'txt');
    const buffer =
      format === 'pdf'
        ? await resumePdf(c)
        : format === 'docx'
          ? await resumeDocx(c)
          : resumeText(c);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="careerflow-approved-resume.${format}"`,
    );
    res
      .type(
        format === 'pdf'
          ? 'application/pdf'
          : format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'text/plain',
      )
      .send(buffer);
  });
  app.use('/api', (_req, _res, next) =>
    next(new AppError(404, 'NOT_FOUND', 'API route not found.')),
  );

  // Register the API fallback before the SPA fallback so unknown API calls remain JSON errors.
  const dist = fileURLToPath(new URL('../../../dist/', import.meta.url));
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: dist }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof z.ZodError)
      return res.status(422).json({
        code: 'VALIDATION_ERROR',
        error: 'Please correct the highlighted fields.',
        fields: err.flatten().fieldErrors,
        requestId: res.locals.requestId,
      });
    if (err instanceof AppError)
      return res.status(err.status).json({
        code: err.code,
        error: err.message,
        requestId: res.locals.requestId,
      });
    if (err?.type === 'entity.too.large')
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        error: 'Request exceeds the permitted size.',
        requestId: res.locals.requestId,
      });
    if (err?.type === 'entity.parse.failed')
      return res.status(400).json({
        code: 'INVALID_JSON',
        error: 'Request body must be valid JSON.',
        requestId: res.locals.requestId,
      });
    if (err?.code === 'P2002')
      return res.status(409).json({
        code: 'CONFLICT',
        error: 'This record already exists. Refresh and retry.',
        requestId: res.locals.requestId,
      });
    console.error('Request failed:', err.message);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      error: 'The operation did not complete. Previously approved data is unchanged.',
      requestId: res.locals.requestId,
    });
  });
  return app;
}
