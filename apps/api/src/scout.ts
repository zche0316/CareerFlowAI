import type { Express } from 'express';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { z } from 'zod';
import { db, databaseUrl, portablePool } from './db.js';
import { json, type MissionData } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { enqueue, queueClient } from './queue.js';
import {
  jobSearchSchema,
  type CareerProfile,
  type Fact,
} from '../../../packages/contracts/src/index.js';
import { suggestJobSearch } from '../../../packages/contracts/src/job-search.js';
import { buildJobRecord, type JobRecord } from '../../../packages/contracts/src/job-record.js';
import { matchingProfileView } from '../../../packages/contracts/src/career-evidence.js';
import {
  JobRepository,
  recruitmentSettings,
} from '../../../packages/recruitment/src/repository.js';
import { countrySpec } from '../../../packages/recruitment/src/geography.js';
import { compare, vectorSimilarity } from '../../../packages/matching/domain.js';
import { configuredMode, type Mode } from '../../../packages/agents/src/provider.js';
import { mapJobRequirements, scoreJobMapping } from '../../../packages/agents/src/job-mapping.js';
import { readJobs } from '../../../packages/agents/src/workflow.js';
import { buildScoutGraph, type ScoutGraphPorts } from '../../../packages/agents/src/scout/graph.js';
import { freshJobs, jobFingerprint } from '../../../packages/agents/src/scout/scout.js';
import type { Handoff } from '../../../packages/agents/src/orchestration/handoff.js';

const QUEUE = 'careerflow-scout';
const TICK = 'careerflow-scout-tick';
// Scheduled sweeps run once a day; the cron is evaluated in this time zone.
export const SCOUT_CRON = '0 7 * * *';
export const SCOUT_TZ = 'Australia/Sydney';
// Live scoring makes one model call per reviewed role; a sweep never reviews more than this.
export const SCOUT_REVIEW_LIMIT = 6;
export const SCOUT_SWEEPS_PER_DAY = 6;
const MAX_CANDIDATES = 40;

type SweepData = {
  search: z.infer<typeof jobSearchSchema>;
  topK: number;
  minScore: number;
  fetched?: number;
  fresh?: number;
  alreadySeen?: number;
  duplicates?: number;
  failures?: { provider: string; message: string }[];
  limitations?: string[];
  candidates?: any[];
  reviewed?: number;
  notReviewed?: number;
  shortlist?: any[];
  packages?: Record<string, { missionId: string }>;
  handoffs?: Handoff[];
  error?: string;
  finishedAt?: string;
};

const latestProfile = (userId: string) =>
  db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });

function defaultSearch(profile: CareerProfile) {
  const defaults = recruitmentSettings().defaults;
  const suggested = suggestJobSearch(profile);
  return jobSearchSchema.parse({
    provider: defaults.provider,
    country: defaults.country,
    keyword: suggested.keyword,
    location: defaults.country === 'au' ? suggested.location : '',
  });
}

export async function scoutSetting(userId: string) {
  const saved = await db.scoutSetting.findUnique({ where: { userId } });
  const profile = await latestProfile(userId);
  return {
    enabled: saved?.enabled ?? false,
    topK: saved?.topK ?? 3,
    minScore: saved?.minScore ?? 50,
    search: saved
      ? jobSearchSchema.parse(saved.search)
      : profile
        ? defaultSearch(profile.data as unknown as CareerProfile)
        : jobSearchSchema.parse({ provider: recruitmentSettings().defaults.provider }),
  };
}

// Serialise writers on one sweep row: tailoring branches run in parallel and all patch its JSON.
async function patchSweep(
  id: string,
  change: (data: SweepData) => SweepData | void,
  extra: { status?: string; calls?: number } = {},
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ScoutSweep" WHERE id = ${id} FOR UPDATE`;
    const row = requireValue(await tx.scoutSweep.findUnique({ where: { id } }));
    const data = row.data as unknown as SweepData;
    const next = change(data) || data;
    return tx.scoutSweep.update({
      where: { id },
      data: {
        data: json(next),
        ...(extra.status ? { status: extra.status } : {}),
        ...(extra.calls ? { calls: { increment: extra.calls } } : {}),
      },
    });
  });
}

const slim = (job: any) => ({ ...job, description: String(job.description || '').slice(0, 20000) });

const ports: ScoutGraphPorts = {
  async collect(sweepId) {
    const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: sweepId } }));
    const data = sweep.data as unknown as SweepData;
    if (data.candidates) {
      return {
        fetched: data.fetched || 0,
        fresh: data.fresh || 0,
        failures: data.failures?.length || 0,
      };
    }
    const seen = new Set(
      (
        await db.trackedJob.findMany({
          where: { userId: sweep.userId },
          select: { fingerprint: true },
        })
      ).map((t) => t.fingerprint),
    );
    // Roles the user already saw in an earlier quest shortlist count as seen too.
    for (const m of await db.mission.findMany({
      where: { userId: sweep.userId },
      select: { data: true },
    }))
      for (const match of (m.data as MissionData).matches || [])
        if (match?.job) seen.add(jobFingerprint(match.job));

    let jobs: any[] = [];
    const failures: SweepData['failures'] = [];
    let limitations: string[] = [];
    try {
      if (data.search.provider === 'fixtures') jobs = await readJobs();
      else {
        const fetched = await new JobRepository().search(data.search);
        jobs = fetched.jobs;
        limitations = fetched.limitations || [];
        for (const s of fetched.sources || [])
          if (s.status === 'unavailable')
            failures.push({ provider: s.board || s.provider, message: 'Source unavailable' });
      }
    } catch (e) {
      // A failed source is reported in the sweep, never replaced with demo roles.
      failures.push({
        provider: data.search.provider,
        message: e instanceof Error ? e.message.slice(0, 300) : 'Job source unavailable',
      });
    }
    const sorted = freshJobs(jobs, seen);
    const candidates = sorted.fresh.slice(0, MAX_CANDIDATES).map(slim);
    const currency = countrySpec(data.search.country).currency;
    const now = new Date();
    for (const job of candidates) {
      const fingerprint = jobFingerprint(job);
      const record = buildJobRecord(job, currency);
      await db.trackedJob.upsert({
        where: { userId_fingerprint: { userId: sweep.userId, fingerprint } },
        create: { userId: sweep.userId, fingerprint, sweepId, record: json(record) },
        update: { lastSeenAt: now },
      });
    }
    if (sorted.seenAgain.length)
      await db.trackedJob.updateMany({
        where: { userId: sweep.userId, fingerprint: { in: sorted.seenAgain } },
        data: { lastSeenAt: now },
      });
    await patchSweep(
      sweepId,
      (d) => ({
        ...d,
        fetched: jobs.length,
        fresh: candidates.length,
        alreadySeen: sorted.seenAgain.length,
        duplicates: sorted.duplicates,
        failures,
        limitations,
        candidates,
      }),
      { status: 'RUNNING' },
    );
    return { fetched: jobs.length, fresh: candidates.length, failures: failures.length };
  },

  async rank(sweepId) {
    const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: sweepId } }));
    const data = sweep.data as unknown as SweepData;
    const brief = (list: any[]) => list.map((m) => ({ jobId: m.job.id, score: m.score }));
    if (data.shortlist) return brief(data.shortlist);
    const profile = requireValue(await latestProfile(sweep.userId));
    const p = profile.data as unknown as CareerProfile;
    const facts = profile.facts as unknown as Fact[];
    const jobs = data.candidates || [];
    const corpus = jobs.map((j) => j.title + ' ' + j.description);
    const view = matchingProfileView(p);
    let scored: any[] = [];
    let reviewed = jobs.length;
    const failures = [...(data.failures || [])];
    if (sweep.mode === 'fixture') scored = jobs.map((job) => compare(view, job, corpus));
    else {
      // Screen by lexical overlap first so the model only reviews a bounded number of roles.
      const screened = jobs
        .map((job) => ({
          job,
          semantic: vectorSimilarity(
            view.skills.join(' ') + ' ' + view.goals,
            job.title + ' ' + job.description,
            corpus,
          ),
        }))
        .sort((a, b) => b.semantic - a.semantic || a.job.id.localeCompare(b.job.id))
        .slice(0, SCOUT_REVIEW_LIMIT);
      reviewed = screened.length;
      for (let offset = 0; offset < screened.length; offset += 2) {
        const batch = await Promise.allSettled(
          screened.slice(offset, offset + 2).map(async ({ job }) => {
            const mapping = await mapJobRequirements(job, facts, sweep.mode as Mode, {
              onCall: async () => void (await patchSweep(sweepId, () => {}, { calls: 1 })),
              onTool: async () => {},
              onUsage: async () => {},
            });
            return scoreJobMapping(job, mapping, facts, p);
          }),
        );
        batch.forEach((result, i) => {
          if (result.status === 'fulfilled') scored.push(result.value);
          else
            failures.push({
              provider: 'Job Matcher',
              message: `Could not map ${screened[offset + i].job.title}; it was left out of this sweep.`,
            });
        });
      }
    }
    const shortlist = scored
      .filter((m) => m.score >= data.minScore)
      .sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id))
      .slice(0, data.topK);
    await patchSweep(sweepId, (d) => ({
      ...d,
      failures,
      reviewed,
      notReviewed: Math.max(0, jobs.length - reviewed),
      shortlist,
      // The full candidate list is no longer needed once ranked; job records keep the facts.
      candidates: [],
    }));
    return brief(shortlist);
  },

  async tailor(sweepId, jobId) {
    const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: sweepId } }));
    const data = sweep.data as unknown as SweepData;
    const existing = data.packages?.[jobId];
    if (existing) return { jobId, missionId: existing.missionId };
    const match = requireValue((data.shortlist || []).find((m) => m.job.id === jobId));
    const profile = requireValue(await latestProfile(sweep.userId));
    // Reuse the latest career analysis for this profile version instead of paying for it per package.
    const analysed = (
      await db.mission.findMany({
        where: { userId: sweep.userId, profileId: profile.id },
        orderBy: { createdAt: 'desc' },
        select: { data: true },
        take: 20,
      })
    ).find((m) => (m.data as MissionData).analysis);
    const at = new Date().toISOString();
    const mission = await db.mission.create({
      data: {
        userId: sweep.userId,
        profileId: profile.id,
        goal: `Scout: ${match.job.title} at ${match.job.company}`.slice(0, 2000),
        mode: sweep.mode,
        data: json({
          revisions: 0,
          answers: [],
          apiCalls: 0,
          minScore: data.minScore,
          jobSearch: data.search,
          agentAccess: 'all-approved-profile',
          ...(analysed ? { analysis: (analysed.data as MissionData).analysis } : {}),
          matches: [match],
          jobRetrieval: { source: 'scout', sweepId, count: 1, fetchedAt: at },
          selectedJob: match,
          scout: { sweepId, fingerprint: jobFingerprint(match.job) },
        }),
        events: json([
          {
            at,
            agent: 'Scout',
            action: 'queued',
            detail: `Scout shortlisted ${match.job.title} (match ${Math.round(match.score)}). The resume team starts on it; you review the draft.`,
          },
        ]),
      },
    });
    await patchSweep(sweepId, (d) => ({
      ...d,
      packages: { ...(d.packages || {}), [jobId]: { missionId: mission.id } },
    }));
    await enqueue(mission.id);
    return { jobId, missionId: mission.id };
  },

  async report(sweepId, _packages, handoffs) {
    await patchSweep(sweepId, (d) => ({ ...d, handoffs, finishedAt: new Date().toISOString() }), {
      status: 'COMPLETE',
    });
  },
};

let graph: ReturnType<typeof buildScoutGraph> | undefined;
let saver: PostgresSaver | undefined;

export async function runSweep(sweepId: string) {
  if (!graph) {
    saver = portablePool
      ? new PostgresSaver(portablePool)
      : PostgresSaver.fromConnString(databaseUrl);
    await saver.setup();
    graph = buildScoutGraph(ports, saver);
  }
  const config = { configurable: { thread_id: 'scout:' + sweepId }, recursionLimit: 20 };
  try {
    const state = await graph.getState(config);
    // A retried sweep continues from its checkpoint instead of fetching and scoring again.
    await graph.invoke(state.values?.sweepId ? null : { sweepId }, config);
  } catch (e) {
    console.error('Scout sweep failed:', sweepId, e instanceof Error ? e.message : e);
    await patchSweep(
      sweepId,
      (d) => ({
        ...d,
        error: 'Scout could not finish this sweep. Nothing was changed in your profile or quests.',
        finishedAt: new Date().toISOString(),
      }),
      { status: 'FAILED' },
    );
  }
}

export async function startSweep(userId: string, trigger: 'manual' | 'schedule') {
  if (!(await latestProfile(userId)))
    throw new AppError(409, 'PROFILE_REQUIRED', 'Review and approve a career profile first.');
  const since = new Date(Date.now() - 24 * 3600000);
  const recent = await db.scoutSweep.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { status: true },
  });
  if (recent.some((s) => s.status === 'QUEUED' || s.status === 'RUNNING'))
    throw new AppError(409, 'SWEEP_RUNNING', 'Scout is already out on a sweep.');
  if (recent.length >= SCOUT_SWEEPS_PER_DAY)
    throw new AppError(429, 'SWEEP_LIMIT', `Up to ${SCOUT_SWEEPS_PER_DAY} sweeps per day.`);
  const setting = await scoutSetting(userId);
  const sweep = await db.scoutSweep.create({
    data: {
      userId,
      trigger,
      mode: configuredMode(),
      data: json({ search: setting.search, topK: setting.topK, minScore: setting.minScore }),
    },
  });
  await queueClient().send(QUEUE, { sweepId: sweep.id });
  return sweep;
}

export async function initScout(withWorker: boolean) {
  const boss = queueClient();
  await boss.createQueue(QUEUE, { retryLimit: 1, retryDelay: 10, expireInSeconds: 600 });
  await boss.createQueue(TICK);
  if (!withWorker) return;
  await boss.work<{ sweepId: string }>(QUEUE, async (jobs) => {
    for (const job of jobs) await runSweep(job.data.sweepId);
  });
  await boss.work(TICK, async () => {
    for (const s of await db.scoutSetting.findMany({ where: { enabled: true } }))
      await startSweep(s.userId, 'schedule').catch((e) =>
        console.error('Scheduled sweep skipped:', e instanceof Error ? e.message : e),
      );
  });
  await boss.schedule(TICK, SCOUT_CRON, null, { tz: SCOUT_TZ });
}

export async function closeScout() {
  // The portable pool is shared and closed with the database client.
  if (saver && !portablePool) await saver.end();
  graph = undefined;
  saver = undefined;
}

async function overview(userId: string) {
  const sweeps = await db.scoutSweep.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const missionIds = sweeps.flatMap((s) =>
    Object.values((s.data as unknown as SweepData).packages || {}).map((p) => p.missionId),
  );
  const missions = new Map(
    (
      await db.mission.findMany({
        where: { userId, id: { in: missionIds } },
        select: { id: true, status: true, data: true },
      })
    ).map((m) => [m.id, m]),
  );
  const tracked = await db.trackedJob.findMany({
    where: { userId },
    orderBy: { firstSeenAt: 'desc' },
    take: 40,
  });
  return {
    setting: await scoutSetting(userId),
    schedule: { cron: SCOUT_CRON, timeZone: SCOUT_TZ },
    limits: { reviewPerSweep: SCOUT_REVIEW_LIMIT, sweepsPerDay: SCOUT_SWEEPS_PER_DAY },
    trackedTotal: await db.trackedJob.count({ where: { userId } }),
    tracked: tracked.map((t) => ({
      fingerprint: t.fingerprint,
      firstSeenAt: t.firstSeenAt,
      lastSeenAt: t.lastSeenAt,
      record: t.record as unknown as JobRecord,
    })),
    sweeps: sweeps.map((s) => {
      const d = s.data as unknown as SweepData;
      return {
        id: s.id,
        status: s.status,
        trigger: s.trigger,
        mode: s.mode,
        calls: s.calls,
        createdAt: s.createdAt,
        finishedAt: d.finishedAt || null,
        search: d.search,
        fetched: d.fetched ?? null,
        fresh: d.fresh ?? null,
        alreadySeen: d.alreadySeen ?? null,
        duplicates: d.duplicates ?? null,
        reviewed: d.reviewed ?? null,
        notReviewed: d.notReviewed ?? null,
        failures: d.failures || [],
        limitations: d.limitations || [],
        handoffs: d.handoffs || [],
        error: d.error || null,
        packages: (d.shortlist || []).map((match) => {
          const missionId = d.packages?.[match.job.id]?.missionId || null;
          const m = missionId ? missions.get(missionId) : undefined;
          const md = (m?.data || {}) as MissionData;
          return {
            jobId: match.job.id,
            title: match.job.title,
            company: match.job.company,
            location: match.job.location,
            url: match.job.applicationUrl || null,
            score: Math.round(match.score),
            missionId,
            status: m?.status || null,
            approved: Boolean(md.approvedResumeId),
            critic: md.resumeTeam?.critiques?.at(-1)?.verdict || null,
            record: buildJobRecord(match.job),
          };
        }),
      };
    }),
  };
}

export function registerScout(app: Express) {
  app.get('/api/scout', async (req, res) => res.json(await overview(req.actor!.id)));
  app.put('/api/scout/settings', async (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        topK: z.number().int().min(1).max(3),
        minScore: z.number().int().min(0).max(100),
        search: jobSearchSchema.omit({ listing: true }),
      })
      .parse(req.body);
    if (input.search.provider === 'manual')
      throw new AppError(422, 'SCOUT_SOURCE', 'Scout needs a searchable job source.');
    const userId = req.actor!.id;
    await db.scoutSetting.upsert({
      where: { userId },
      create: { userId, ...input, search: json(input.search) },
      update: { ...input, search: json(input.search) },
    });
    res.json(await scoutSetting(userId));
  });
  app.post('/api/scout/sweeps', async (req, res) => {
    const sweep = await startSweep(req.actor!.id, 'manual');
    res.status(202).json({ id: sweep.id, status: sweep.status });
  });
}
