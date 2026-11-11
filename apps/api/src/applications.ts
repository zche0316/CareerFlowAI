import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { json, type MissionData } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { enqueue } from './queue.js';
import { spanHook } from './trace.js';
import { jobFingerprint } from '../../../packages/agents/src/scout/scout.js';
import { configuredMode, type Mode } from '../../../packages/agents/src/provider.js';
import { mapJobRequirements, scoreJobMapping } from '../../../packages/agents/src/job-mapping.js';
import { matchingProfileView } from '../../../packages/contracts/src/career-evidence.js';
import { compare } from '../../../packages/matching/domain.js';
import type { CareerProfile, Fact } from '../../../packages/contracts/src/index.js';

// An application is one role the user is pursuing. It outlives runs (Mission rows) and profile
// versions: every resume and every interview practice for that role hangs off it through its runs.

export const applicationStatuses = [
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
  'closed',
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
type HistoryEntry = { status: string; at: string; note?: string };

const ACTIVE = ['QUEUED', 'RUNNING', 'AWAITING_JOB', 'AWAITING_APPROVAL', 'AWAITING_INTERVIEW'];
const slim = (match: any) => ({
  ...match,
  job: { ...match.job, description: String(match.job?.description || '').slice(0, 20000) },
});

/** Find or create the application for a matched role, refreshing its snapshot. */
export async function upsertApplication(
  userId: string,
  match: any,
  source: 'search' | 'scout' | 'link',
  status: ApplicationStatus = 'saved',
) {
  const fingerprint = jobFingerprint(match.job);
  const at = new Date().toISOString();
  return db.application.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: {
      userId,
      fingerprint,
      job: json(slim(match)),
      source,
      status,
      history: json([{ status, at }]),
    },
    update: { job: json(slim(match)) },
  });
}

/** Link a run to the application of the role it works on (created when the role is new). */
export async function linkRun(userId: string, missionId: string, source: 'search' | 'scout') {
  const m = await db.mission.findFirst({ where: { id: missionId, userId } });
  const match = (m?.data as MissionData | undefined)?.selectedJob;
  if (!m || !match) return null;
  const application = await upsertApplication(
    userId,
    match,
    match.job?.source?.importedFromURL ? 'link' : source,
  );
  await db.mission.update({ where: { id: m.id }, data: { applicationId: application.id } });
  return application;
}

/** Status the group build kept inside a mission, newest wins. */
function legacyStatus(d: MissionData): HistoryEntry | null {
  const entries: HistoryEntry[] = [];
  if (d.optionalTools?.status)
    entries.push({ status: d.optionalTools.status.value, at: d.optionalTools.status.at });
  for (const h of d.applicationHistory || [])
    if (h.status === 'submitted_self_reported') entries.push({ status: 'applied', at: h.at });
  return entries.sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}

/** Give every older run that chose a role an application. Idempotent; mission data is unchanged. */
export async function backfillApplications(userId: string) {
  const missions = await db.mission.findMany({
    where: { userId, applicationId: null },
    orderBy: { createdAt: 'asc' },
  });
  for (const m of missions) {
    const d = m.data as MissionData;
    if (!d.selectedJob?.job) continue;
    const application = await upsertApplication(
      userId,
      d.selectedJob,
      d.scout ? 'scout' : d.selectedJob.job.source?.importedFromURL ? 'link' : 'search',
    );
    await db.mission.update({ where: { id: m.id }, data: { applicationId: application.id } });
    const legacy = legacyStatus(d);
    if (legacy && application.status === 'saved')
      await db.application.update({
        where: { id: application.id },
        data: {
          status: legacy.status,
          history: json([...(application.history as HistoryEntry[]), legacy]),
        },
      });
  }
}

type RunSummary = {
  id: string;
  status: string;
  mode: string;
  createdAt: Date;
  updatedAt: Date;
  approvedResumeId: string | null;
  interviewFeedback: boolean;
  scout: boolean;
};

/**
 * Where the role stands. A status the user recorded (applied and later) wins; before that it is
 * derived from the runs: an approved resume means ready, otherwise a run in progress means tailoring.
 */
export function applicationStage(
  status: string,
  runs: Pick<RunSummary, 'status' | 'approvedResumeId'>[],
) {
  if (status !== 'saved') return status;
  if (runs.some((r) => r.approvedResumeId)) return 'ready';
  if (runs.some((r) => ACTIVE.includes(r.status))) return 'tailoring';
  return 'saved';
}

export async function listApplications(userId: string) {
  await backfillApplications(userId);
  const applications = await db.application.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  const missions = await db.mission.findMany({
    where: { userId, applicationId: { in: applications.map((a) => a.id) } },
    orderBy: { createdAt: 'desc' },
  });
  return applications.map((a) => {
    const runs: RunSummary[] = missions
      .filter((m) => m.applicationId === a.id)
      .map((m) => {
        const d = m.data as MissionData;
        return {
          id: m.id,
          status: m.status,
          mode: m.mode,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          approvedResumeId: d.approvedResumeId || null,
          interviewFeedback: Boolean(d.feedback),
          scout: Boolean(d.scout),
        };
      });
    const match = a.job as any;
    return {
      id: a.id,
      title: match.job?.title || '',
      company: match.job?.company || '',
      location: match.job?.location || '',
      url: match.job?.applicationUrl || match.job?.url || '',
      score: typeof match.score === 'number' ? match.score : null,
      gaps: Array.isArray(match.gaps)
        ? match.gaps.filter((g: unknown): g is string => typeof g === 'string').slice(0, 20)
        : [],
      source: a.source,
      status: a.status,
      stage: applicationStage(a.status, runs),
      history: a.history,
      notes: a.notes,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      activeRunId: runs.find((r) => ACTIVE.includes(r.status))?.id || null,
      latestResumeId: runs.find((r) => r.approvedResumeId)?.approvedResumeId || null,
      runs,
    };
  });
}

const owned = async (userId: string, id: string) =>
  requireValue(await db.application.findFirst({ where: { id, userId } }));

/** Record a status or notes. Applying itself stays manual; this only keeps the user's record. */
export async function updateApplication(
  userId: string,
  id: string,
  input: { status?: ApplicationStatus; note?: string; notes?: string },
) {
  const a = await owned(userId, id);
  const history = a.history as HistoryEntry[];
  const changed = input.status && input.status !== a.status;
  return db.application.update({
    where: { id },
    data: {
      ...(changed
        ? {
            status: input.status,
            history: json([
              ...history,
              {
                status: input.status!,
                at: new Date().toISOString(),
                ...(input.note ? { note: input.note } : {}),
              },
            ]),
          }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

/** Mirror a status recorded on a run (older mission endpoints) onto its application. */
export async function recordRunStatus(
  userId: string,
  missionId: string,
  status: ApplicationStatus,
) {
  const m = await db.mission.findFirst({ where: { id: missionId, userId } });
  const id = m?.applicationId || (await linkRun(userId, missionId, 'search'))?.id;
  if (id) await updateApplication(userId, id, { status });
}

/**
 * Save a role from a run's shortlist to the board without starting the resume team. The run is
 * not changed: the user can still choose a role in it.
 */
export async function saveFromRun(userId: string, missionId: string, jobId: string) {
  const m = requireValue(await db.mission.findFirst({ where: { id: missionId, userId } }));
  const match = ((m.data as MissionData).matches || []).find((r: any) => r.job.id === jobId);
  if (!match) throw new AppError(404, 'NOT_FOUND', 'That role is not in this shortlist.');
  return upsertApplication(
    userId,
    match,
    (m.data as MissionData).scout ? 'scout' : match.job.source?.importedFromURL ? 'link' : 'search',
  );
}

/**
 * Start a run on a saved role: the resume team with the current approved profile, then the
 * interview, as in a quest where the role is already chosen. The role is scored again when the
 * profile changed since it was matched, because requirement mappings cite profile fact ids.
 */
export async function startApplicationRun(userId: string, id: string) {
  const a = await owned(userId, id);
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile)
    throw new AppError(409, 'PROFILE_REQUIRED', 'Approve your profile before tailoring a resume.');
  const runs = await db.mission.findMany({
    where: { userId, applicationId: id },
    orderBy: { createdAt: 'desc' },
  });
  const active = runs.find((r) => ACTIVE.includes(r.status));
  if (active)
    throw new AppError(
      409,
      'RUN_ACTIVE',
      'This role already has a run in progress. Open it instead.',
    );
  const mode = configuredMode();
  // Reuse a career analysis for this profile version and mode instead of paying for it again.
  const analysed = (
    await db.mission.findMany({
      where: { userId, profileId: profile.id, mode },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
      take: 20,
    })
  ).find((m) => (m.data as MissionData).analysis);
  const previous = runs.find((r) => r.profileId === profile.id && r.mode === mode);
  const at = new Date().toISOString();
  const stored = a.job as any;
  const missionId = randomUUID();
  let match = previous ? (previous.data as MissionData).selectedJob : null;
  let usage = { calls: 0, input: 0, output: 0 };
  if (!match) {
    const facts = profile.facts as unknown as Fact[];
    if (mode === 'fixture')
      match = compare(matchingProfileView(profile.data as unknown as CareerProfile), stored.job, [
        stored.job.title + ' ' + stored.job.description,
      ]);
    else {
      // One counted Job Matcher call, charged to the new run.
      const mapping = await mapJobRequirements(stored.job, facts, mode as Mode, {
        onCall: async () => void usage.calls++,
        onTool: async () => {},
        onUsage: async (input, output) => {
          usage = { ...usage, input: usage.input + input, output: usage.output + output };
        },
        onSpan: spanHook({ userId, missionId, agent: 'Job Matcher' }),
      });
      match = scoreJobMapping(stored.job, mapping, facts, profile.data as any);
    }
  }
  const mission = await db.mission.create({
    data: {
      id: missionId,
      userId,
      profileId: profile.id,
      applicationId: a.id,
      goal: `Tailor: ${stored.job.title} at ${stored.job.company}`.slice(0, 2000),
      mode,
      data: json({
        revisions: 0,
        answers: [],
        apiCalls: usage.calls,
        inputTokens: usage.input,
        outputTokens: usage.output,
        minScore: 0,
        jobSearch: (runs[0]?.data as MissionData | undefined)?.jobSearch || { provider: 'manual' },
        agentAccess: 'all-approved-profile',
        ...(analysed ? { analysis: (analysed.data as MissionData).analysis } : {}),
        matches: [match],
        selectedJob: match,
        preselected: true,
        jobRetrieval: { source: 'application', applicationId: a.id, count: 1, fetchedAt: at },
      }),
      events: json([
        {
          at,
          agent: 'Orchestrator',
          action: 'queued',
          detail: `Run started on a saved role with approved profile v${profile.version}.`,
        },
      ]),
    },
  });
  await db.application.update({ where: { id: a.id }, data: { job: json(slim(match)) } });
  await enqueue(mission.id);
  return mission;
}

export function registerApplications(app: Express) {
  app.get('/api/applications', async (req, res) => res.json(await listApplications(req.actor!.id)));
  app.patch('/api/applications/:id', async (req, res) => {
    const input = z
      .object({
        status: z.enum(applicationStatuses).optional(),
        note: z.string().trim().max(500).optional(),
        notes: z.string().max(4000).optional(),
      })
      .parse(req.body);
    res.json(await updateApplication(req.actor!.id, String(req.params.id), input));
  });
  app.post('/api/applications/:id/runs', async (req, res) =>
    res.status(202).json(await startApplicationRun(req.actor!.id, String(req.params.id))),
  );
  app.post('/api/missions/:id/saved-roles', async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(500) }).parse(req.body);
    res.status(201).json(await saveFromRun(req.actor!.id, String(req.params.id), jobId));
  });
}
