import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { json, type MissionData } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { enqueue } from './queue.js';
import { spanHook } from './trace.js';
import { knownRoles, resolveRole } from './role-library.js';
import { readPublicJob } from './job-link.js';
import { capabilitiesFor } from './capability.js';
import { levelGaps, requirementItems } from '../../../packages/contracts/src/capability.js';
import { configuredMode, type Mode } from '../../../packages/agents/src/provider.js';
import { mapJobRequirements, scoreJobMapping } from '../../../packages/agents/src/job-mapping.js';
import { matchingProfileView } from '../../../packages/contracts/src/career-evidence.js';
import { compare } from '../../../packages/matching/domain.js';
import type { CareerProfile, Fact } from '../../../packages/contracts/src/index.js';

// An application is one role the user is pursuing. It outlives runs (Mission rows) and profile
// versions: every resume and every interview practice for that role hangs off it through its runs.

export const applicationStatuses = [
  'discovered',
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
  'closed',
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];
type HistoryEntry = { status: string; at: string; note?: string };

const ACTIVE = [
  'QUEUED',
  'RUNNING',
  'AWAITING_JOB',
  'AWAITING_EVIDENCE',
  'AWAITING_APPROVAL',
  'AWAITING_INTERVIEW',
];
const slim = (match: any) => ({
  ...match,
  job: { ...match.job, description: String(match.job?.description || '').slice(0, 20000) },
});

/** Find or create the application for a matched role, refreshing its snapshot. */
export async function upsertApplication(
  userId: string,
  match: any,
  source: 'search' | 'scout' | 'link',
  mode: string = configuredMode(),
  status: ApplicationStatus = 'saved',
) {
  // The identity the role library gave this listing, or the one it resolves to now: the same
  // posting or a listing with the same names and a similar description joins the existing role.
  const known = await knownRoles(userId);
  const tag = match.fingerprint || match.job?.fingerprint;
  const resolved = resolveRole(match.job, known);
  const fingerprint =
    tag && known.some((k) => k.fingerprint === tag)
      ? tag
      : resolved.match
        ? resolved.fingerprint
        : tag || resolved.fingerprint;
  const at = new Date().toISOString();
  return db.application.upsert({
    where: { userId_fingerprint: { userId, fingerprint } },
    create: {
      userId,
      fingerprint,
      job: json(slim(match)),
      source,
      status,
      mode,
      postingKey: resolved.key,
      textSig: json(resolved.sig),
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
    m.mode,
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
      m.mode,
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
  practice: boolean;
};

/**
 * Where the role stands. A status the user recorded (applied and later) wins; before that it is
 * derived from the runs: an approved resume means ready, otherwise a run in progress means tailoring.
 */
export function applicationStage(
  status: string,
  runs: (Pick<RunSummary, 'status' | 'approvedResumeId'> & { practice?: boolean })[],
) {
  // Before the user records an application, the runs decide the stage.
  if (status !== 'saved' && status !== 'discovered') return status;
  if (runs.some((r) => r.approvedResumeId)) return 'ready';
  if (runs.some((r) => !r.practice && ACTIVE.includes(r.status))) return 'tailoring';
  return status;
}

// New runs are linked when they are created, so older missions need the backfill only once per
// user per server process, not on every workspace poll.
const backfilled = new Set<string>();

export async function listApplications(userId: string) {
  if (!backfilled.has(userId)) {
    await backfillApplications(userId);
    backfilled.add(userId);
  }
  // Demo roles and live roles keep separate boards; rows not yet given a mode show in both.
  const applications = await db.application.findMany({
    where: { userId, OR: [{ mode: configuredMode() }, { mode: null }] },
    orderBy: { updatedAt: 'desc' },
  });
  const missions = await db.mission.findMany({
    where: { userId, applicationId: { in: applications.map((a) => a.id) } },
    orderBy: { createdAt: 'desc' },
  });
  const capabilities = await capabilitiesFor(userId);
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
          practice: Boolean(d.practiceOnly),
        };
      });
    const match = a.job as any;
    return {
      id: a.id,
      fingerprint: a.fingerprint,
      title: match.job?.title || '',
      company: match.job?.company || '',
      location: match.job?.location || '',
      url: match.job?.applicationUrl || match.job?.url || '',
      score: typeof match.score === 'number' ? match.score : null,
      // Where this role asks for more than the profile shows, biggest required gaps first.
      levelGaps: levelGaps(requirementItems(match), capabilities).slice(0, 4),
      gaps: Array.isArray(match.gaps)
        ? match.gaps.filter((g: unknown): g is string => typeof g === 'string').slice(0, 20)
        : [],
      source: a.source,
      // When the listing was last re-checked and what was found (CFS-122).
      listingCheck: match.listingCheck || null,
      status: a.status,
      stage: applicationStage(a.status, runs),
      history: a.history as { status: string; at: string; note?: string }[],
      notes: a.notes,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      // Tailoring and practice can run side by side (CFS-134).
      activeRunId: runs.find((r) => !r.practice && ACTIVE.includes(r.status))?.id || null,
      activePracticeId: runs.find((r) => r.practice && ACTIVE.includes(r.status))?.id || null,
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
    m.mode,
  );
}

/**
 * Start a run on a saved role: the resume team with the current approved profile, then the
 * interview, as in a quest where the role is already chosen. The role is scored again when the
 * profile changed since it was matched, because requirement mappings cite profile fact ids.
 */
/**
 * Score a role against an approved profile: the matching baseline in fixture mode, one counted
 * Job Matcher call in live mode (requirement mappings cite the profile's fact ids).
 */
export async function scoreForProfile(
  userId: string,
  job: any,
  profile: { data: unknown; facts: unknown },
  mode: string,
  missionId?: string,
) {
  let usage = { calls: 0, input: 0, output: 0 };
  const facts = profile.facts as unknown as Fact[];
  if (mode === 'fixture')
    return {
      match: compare(matchingProfileView(profile.data as unknown as CareerProfile), job, [
        job.title + ' ' + job.description,
      ]),
      usage,
    };
  const mapping = await mapJobRequirements(job, facts, mode as Mode, {
    onCall: async () => void usage.calls++,
    onTool: async () => {},
    onUsage: async (input, output) => {
      usage = { ...usage, input: usage.input + input, output: usage.output + output };
    },
    onSpan: spanHook({ userId, missionId, agent: 'Job Matcher' }),
  });
  return { match: scoreJobMapping(job, mapping, facts, profile.data as any), usage };
}

export async function startApplicationRun(
  userId: string,
  id: string,
  kind: 'tailor' | 'practice' = 'tailor',
) {
  const a = await owned(userId, id);
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile)
    throw new AppError(409, 'PROFILE_REQUIRED', 'Approve your profile before tailoring a resume.');
  const runs = await db.mission.findMany({
    where: { userId, applicationId: id },
    orderBy: { createdAt: 'desc' },
  });
  // Tailoring and practice are independent (CFS-134): only a run of the same kind blocks.
  const active = runs.find(
    (r) =>
      ACTIVE.includes(r.status) &&
      Boolean((r.data as MissionData).practiceOnly) === (kind === 'practice'),
  );
  if (active)
    throw new AppError(
      409,
      'RUN_ACTIVE',
      kind === 'practice'
        ? 'A practice run for this role is already open. Continue it instead.'
        : 'This role already has a tailoring run in progress. Open it instead.',
    );
  const mode = configuredMode();
  // Reuse a career analysis for this profile version and mode instead of paying for it again.
  // The workspace Coach's latest advice, else an earlier run's (CFS-138): role runs never pay
  // for a second Coach call on the same profile version. Imported lazily: coach.ts imports this file.
  const { reusableAnalysis } = await import('./coach.js');
  const reused = await reusableAnalysis(userId, profile.id, mode);
  const previous = runs.find((r) => r.profileId === profile.id && r.mode === mode);
  const at = new Date().toISOString();
  const stored = a.job as any;
  const missionId = randomUUID();
  // Practice reuses the latest approved resume for this role made with the current profile when
  // there is one; otherwise the interview works from the approved profile alone (CFS-134).
  const source =
    kind === 'practice'
      ? runs.find(
          (r) =>
            r.profileId === profile.id &&
            r.mode === mode &&
            (r.data as MissionData).approvedResumeId,
        )
      : undefined;
  let match = (source || previous)?.data
    ? ((source || previous)!.data as MissionData).selectedJob
    : null;
  let usage = { calls: 0, input: 0, output: 0 };
  if (!match) {
    const scored = await scoreForProfile(userId, stored.job, profile, mode, missionId);
    match = scored.match;
    usage = scored.usage;
  }
  const kept = source?.data as MissionData | undefined;
  const mission = await db.mission.create({
    data: {
      id: missionId,
      userId,
      profileId: profile.id,
      applicationId: a.id,
      goal: `${kind === 'practice' ? 'Practise' : 'Tailor'}: ${stored.job.title} at ${stored.job.company}`.slice(
        0,
        2000,
      ),
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
        ...(reused ? { analysis: reused } : {}),
        matches: [match],
        selectedJob: match,
        preselected: true,
        jobRetrieval: { source: 'application', applicationId: a.id, count: 1, fetchedAt: at },
        ...(kind === 'practice' ? { practiceOnly: true } : {}),
        ...(kept
          ? {
              resumeDraft: kept.resumeDraft,
              approvedResumeId: kept.approvedResumeId,
              practiceFromRunId: source!.id,
            }
          : {}),
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

const pastedListing = z.object({
  title: z.string().trim().min(2).max(300),
  company: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300).default(''),
  description: z
    .string()
    .trim()
    .min(200, 'Paste the full advertisement (at least 200 characters).')
    .max(20000),
  url: z.string().trim().url().max(2000).optional(),
});
export const addRoleSchema = z.union([
  z.object({ url: z.string().trim().url().max(2000) }),
  z.object({ listing: pastedListing }),
]);

/**
 * Put a role on the board directly, without a search run: from a public job link (one model call
 * at most to read the page) or from an advertisement the user pasted. The role is scored against
 * the current approved profile; nothing is tailored until the user asks.
 */
export async function addRole(userId: string, input: z.infer<typeof addRoleSchema>) {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile)
    throw new AppError(409, 'PROFILE_REQUIRED', 'Approve your profile before adding roles.');
  const mode = configuredMode();
  const job =
    'url' in input
      ? await readPublicJob(input.url, async () => {})
      : {
          id: 'pasted-' + randomUUID(),
          title: input.listing.title,
          company: input.listing.company,
          location: input.listing.location,
          employmentType: 'Not supplied',
          description: input.listing.description,
          salary: null,
          applicationUrl: input.listing.url || '',
          source: {
            name: 'Pasted listing',
            version: 'user-provided',
            externalListing: true,
            liveVacancy: false,
            fictional: false,
            fetchedAt: new Date().toISOString(),
            coverage: 'User-pasted listing; not retrieved or verified by API',
          },
        };
  const { match } = await scoreForProfile(userId, job, profile, mode);
  return upsertApplication(userId, match, 'link', mode);
}

/** Remove a role from the board. Only a role with no runs can be removed; others are closed. */
export async function removeRole(userId: string, id: string) {
  const a = await owned(userId, id);
  if (await db.mission.count({ where: { userId, applicationId: a.id } }))
    throw new AppError(
      409,
      'ROLE_HAS_RUNS',
      'This role has runs and documents. Set its status to Closed to archive it instead.',
    );
  await db.application.delete({ where: { id: a.id } });
  return { ok: true };
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
  app.post('/api/applications/:id/practice', async (req, res) =>
    res
      .status(202)
      .json(await startApplicationRun(req.actor!.id, String(req.params.id), 'practice')),
  );
  app.post('/api/applications', async (req, res) =>
    res.status(201).json(await addRole(req.actor!.id, addRoleSchema.parse(req.body))),
  );
  app.delete('/api/applications/:id', async (req, res) =>
    res.json(await removeRole(req.actor!.id, String(req.params.id))),
  );
  app.post('/api/missions/:id/saved-roles', async (req, res) => {
    const { jobId } = z.object({ jobId: z.string().min(1).max(500) }).parse(req.body);
    res.status(201).json(await saveFromRun(req.actor!.id, String(req.params.id), jobId));
  });
}
