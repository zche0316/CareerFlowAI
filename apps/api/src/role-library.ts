import { db } from './db.js';
import { json } from './domain.js';
import { jobFingerprint } from '../../../packages/agents/src/scout/scout.js';
import { buildJobRecord } from '../../../packages/contracts/src/job-record.js';

// One role library per user. TrackedJob is the log of every role any search has shown (Scout
// sweeps and Find roles runs), used to tell new roles from ones already seen. Application is the
// role the user is pursuing and holds its status. Both use the same fingerprint, so a role is the
// same role whichever source found it.

/** A fixture listing from the demo repository rather than a real vacancy. */
export const isDemoJob = (job: any) =>
  job?.source?.type === 'disclosed-fixture' ||
  job?.source?.fictional === true ||
  job?.source?.liveVacancy === false;

/** Fingerprints of every role this user has seen or put on the board. */
export async function knownFingerprints(userId: string) {
  const [tracked, applications] = await Promise.all([
    db.trackedJob.findMany({ where: { userId }, select: { fingerprint: true } }),
    db.application.findMany({ where: { userId }, select: { fingerprint: true } }),
  ]);
  return new Set([...tracked, ...applications].map((r) => r.fingerprint));
}

/** Record roles a search showed, so Scout does not offer them again as new. */
export async function recordSeen(userId: string, jobs: any[], currency = 'AUD') {
  const now = new Date();
  for (const job of jobs) {
    if (!job?.title) continue;
    const fingerprint = jobFingerprint(job);
    await db.trackedJob.upsert({
      where: { userId_fingerprint: { userId, fingerprint } },
      create: { userId, fingerprint, record: json(buildJobRecord(job, currency)) },
      update: { lastSeenAt: now },
    });
  }
}

type HistoryEntry = { status: string; at: string; note?: string };
const progress = ['saved', 'applied', 'interview', 'offer', 'rejected', 'closed'];

/**
 * Bring stored rows up to the current fingerprint and give every application a mode. When two
 * rows turn out to be the same role they are merged: runs move to the kept application, histories
 * are combined and the furthest status wins. Idempotent; runs at startup.
 */
export async function migrateRoleLibrary() {
  const applications = await db.application.findMany({ orderBy: { createdAt: 'asc' } });
  for (const a of applications) {
    const match = a.job as any;
    const fingerprint = jobFingerprint(match.job || {});
    let mode = a.mode;
    if (!mode) {
      const run = await db.mission.findFirst({
        where: { applicationId: a.id },
        orderBy: { createdAt: 'desc' },
        select: { mode: true },
      });
      mode = run?.mode || (isDemoJob(match.job) ? 'fixture' : 'openai');
    }
    if (fingerprint === a.fingerprint && mode === a.mode) continue;
    const twin =
      fingerprint === a.fingerprint
        ? null
        : await db.application.findUnique({
            where: { userId_fingerprint: { userId: a.userId, fingerprint } },
          });
    if (!twin) {
      await db.application.update({ where: { id: a.id }, data: { fingerprint, mode } });
      continue;
    }
    // The earlier application is kept; this one's runs, history and notes join it.
    const history = [...(twin.history as HistoryEntry[]), ...(a.history as HistoryEntry[])].sort(
      (x, y) => x.at.localeCompare(y.at),
    );
    const status =
      progress.indexOf(a.status) > progress.indexOf(twin.status) ? a.status : twin.status;
    await db.$transaction([
      db.mission.updateMany({ where: { applicationId: a.id }, data: { applicationId: twin.id } }),
      db.application.update({
        where: { id: twin.id },
        data: {
          status,
          history: json(history),
          notes: [twin.notes, a.notes].filter(Boolean).join('\n'),
          mode: twin.mode || mode,
        },
      }),
      db.application.delete({ where: { id: a.id } }),
    ]);
  }
  const tracked = await db.trackedJob.findMany({ orderBy: { firstSeenAt: 'asc' } });
  for (const t of tracked) {
    const fingerprint = jobFingerprint(t.record as any);
    if (fingerprint === t.fingerprint) continue;
    const twin = await db.trackedJob.findUnique({
      where: { userId_fingerprint: { userId: t.userId, fingerprint } },
    });
    if (!twin) await db.trackedJob.update({ where: { id: t.id }, data: { fingerprint } });
    else {
      await db.trackedJob.update({
        where: { id: twin.id },
        data: {
          firstSeenAt: t.firstSeenAt < twin.firstSeenAt ? t.firstSeenAt : twin.firstSeenAt,
          lastSeenAt: t.lastSeenAt > twin.lastSeenAt ? t.lastSeenAt : twin.lastSeenAt,
        },
      });
      await db.trackedJob.delete({ where: { id: t.id } });
    }
  }
}
