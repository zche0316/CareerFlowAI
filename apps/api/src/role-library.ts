import { createHash } from 'node:crypto';
import { db } from './db.js';
import { json } from './domain.js';
import { jobFingerprint } from '../../../packages/agents/src/scout/scout.js';
import { buildJobRecord } from '../../../packages/contracts/src/job-record.js';

// One role library per user. TrackedJob is the log of every role any search has shown (Scout
// sweeps and Find roles runs), used to tell new roles from ones already seen. Application is the
// role the user is pursuing and holds its status. Both use the same fingerprint, so a role is the
// same role whichever source found it.

// ---- Role identity -------------------------------------------------------------------------
// Two listings are the same role when, in order:
//   1. they are the same posting: same source and listing id (Greenhouse, Lever, Ashby, Adzuna),
//      or the same link once tracking parameters are removed;
//   2. otherwise employer, title and city match (jobFingerprint) and the descriptions are alike
//      or one of them has no text to compare. Two openings with the same title at the same
//      employer and city but different descriptions stay separate roles;
//   3. a matched role that no search showed for REPOST_DAYS counts as re-advertised.

export const REPOST_DAYS = 60;
const DAY = 86400000;
const keptParams = new Set(['jk', 'gh_jid', 'jobid', 'job_id', 'id', 'currentjobid', 'vjk']);

/** A link without tracking parameters, fragment, "www." or trailing slash. */
export function canonicalUrl(raw?: string | null) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    const params = [...u.searchParams]
      .filter(([k]) => keptParams.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '').toLowerCase()}${query}`;
  } catch {
    return null;
  }
}

/** The posting's own identity, when the source gives one. */
export function postingKey(job: any): string | null {
  const s = job?.source || {};
  if (['greenhouse', 'lever', 'ashby', 'adzuna'].includes(s.provider) && s.listingId)
    return `${s.provider}:${String(s.board || '').toLowerCase()}:${s.listingId}`;
  if (s.type === 'disclosed-fixture' && job.id) return `fixture:${job.id}`;
  const url = canonicalUrl(job?.applicationUrl || job?.url || s.url);
  return url ? `url:${url}` : null;
}

// MinHash over word 3-grams: 32 numbers that estimate how much two descriptions overlap.
const PERMS = 32;
function hash(text: string, seed: number) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function textSignature(text = ''): number[] | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 30) return null; // too short to tell two descriptions apart
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) grams.add(words.slice(i, i + 3).join(' '));
  const sig: number[] = [];
  for (let p = 0; p < PERMS; p++) {
    let min = 0xffffffff;
    for (const g of grams) min = Math.min(min, hash(g, p * 0x9e3779b1));
    sig.push(min);
  }
  return sig;
}
/** Estimated share of wording two descriptions have in common, or null when one has none. */
export function similarity(a?: number[] | null, b?: number[] | null) {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  return a.filter((v, i) => v === b[i]).length / a.length;
}

export type KnownRole = {
  fingerprint: string;
  postingKey: string | null;
  textSig: number[] | null;
  lastSeenAt?: Date | null;
};

/** Which known role a listing is, or the identity it gets as a new role. */
export function resolveRole(
  job: any,
  known: KnownRole[],
  now = new Date(),
  stored?: { key?: string | null; sig?: number[] | null },
) {
  const key = stored?.key !== undefined ? stored.key : postingKey(job);
  const sig = stored?.sig !== undefined ? stored.sig : textSignature(job?.description);
  const base = jobFingerprint(job || {});
  const reposted = (k: KnownRole) =>
    Boolean(k.lastSeenAt && now.getTime() - new Date(k.lastSeenAt).getTime() > REPOST_DAYS * DAY);
  const exact = key ? known.find((k) => k.postingKey === key) : undefined;
  if (exact)
    return { fingerprint: exact.fingerprint, match: exact, reposted: reposted(exact), key, sig };
  const family = known.filter(
    (k) => k.fingerprint === base || k.fingerprint.startsWith(base + ':'),
  );
  const alike = family.find((k) => {
    const s = similarity(sig, k.textSig);
    return s === null || s >= 0.6;
  });
  if (alike)
    return { fingerprint: alike.fingerprint, match: alike, reposted: reposted(alike), key, sig };
  // A different opening with the same employer, title and city gets its own identity.
  const fingerprint = family.length
    ? `${base}:${createHash('sha256')
        .update(key || (sig || []).join(',') || String(job?.id || ''))
        .digest('hex')
        .slice(0, 8)}`
    : base;
  return { fingerprint, match: null, reposted: false, key, sig };
}

/** A fixture listing from the demo repository rather than a real vacancy. */
export const isDemoJob = (job: any) =>
  job?.source?.type === 'disclosed-fixture' ||
  job?.source?.fictional === true ||
  job?.source?.liveVacancy === false;

type Known = KnownRole & { onBoard: boolean };

/** Every role this user has seen or put on the board, for resolveRole. */
export async function knownRoles(userId: string): Promise<Known[]> {
  const [tracked, applications] = await Promise.all([
    db.trackedJob.findMany({
      where: { userId },
      select: { fingerprint: true, postingKey: true, textSig: true, lastSeenAt: true },
    }),
    db.application.findMany({
      where: { userId },
      select: { fingerprint: true, postingKey: true, textSig: true },
    }),
  ]);
  const board = new Set(applications.map((a) => a.fingerprint));
  // A board role was last seen when a search last showed it, which the tracked log records.
  const lastSeen = new Map(tracked.map((t) => [t.fingerprint, t.lastSeenAt]));
  return [
    ...applications.map((a) => ({
      ...a,
      textSig: a.textSig as number[] | null,
      lastSeenAt: lastSeen.get(a.fingerprint) || null,
      onBoard: true,
    })),
    ...tracked.map((t) => ({
      ...t,
      textSig: t.textSig as number[] | null,
      onBoard: board.has(t.fingerprint),
    })),
  ];
}

/**
 * Sort a search's listings against the library: new roles (including re-advertised ones that are
 * not on the board), roles seen before, duplicates within this search, and board roles that were
 * re-advertised. Each listing gets its resolved fingerprint.
 */
export function sortListings(jobs: any[], known: Known[], now = new Date()) {
  const pool = [...known];
  const fresh: any[] = [];
  const all: any[] = [];
  const seenAgain = new Set<string>();
  const repostedOnBoard = new Set<string>();
  const inThisSearch = new Set<string>();
  let duplicates = 0;
  for (const job of jobs) {
    const r = resolveRole(job, pool, now);
    const tagged = {
      ...job,
      fingerprint: r.fingerprint,
      ...(r.reposted ? { reposted: true } : {}),
    };
    all.push(tagged);
    if (inThisSearch.has(r.fingerprint)) duplicates++;
    else if (!r.match) fresh.push(tagged);
    else if (r.reposted && !(r.match as Known).onBoard) fresh.push(tagged);
    else {
      seenAgain.add(r.fingerprint);
      if (r.reposted) repostedOnBoard.add(r.fingerprint);
    }
    inThisSearch.add(r.fingerprint);
    if (!r.match)
      pool.push({ fingerprint: r.fingerprint, postingKey: r.key, textSig: r.sig, onBoard: false });
  }
  return {
    all,
    fresh,
    seenAgain: [...seenAgain],
    repostedOnBoard: [...repostedOnBoard],
    duplicates,
  };
}

/** Save what a search showed: new roles join the log, known ones get a new last-seen time. */
export async function recordListings(
  userId: string,
  sorted: ReturnType<typeof sortListings>,
  extra: { sweepId?: string; currency?: string; record?: (job: any) => unknown } = {},
) {
  const now = new Date();
  for (const job of sorted.fresh)
    await db.trackedJob.upsert({
      where: { userId_fingerprint: { userId, fingerprint: job.fingerprint } },
      create: {
        userId,
        fingerprint: job.fingerprint,
        sweepId: extra.sweepId,
        postingKey: postingKey(job),
        textSig: json(textSignature(job.description)),
        record: json(extra.record ? extra.record(job) : buildJobRecord(job, extra.currency)),
      },
      update: { lastSeenAt: now },
    });
  if (sorted.seenAgain.length)
    await db.trackedJob.updateMany({
      where: { userId, fingerprint: { in: sorted.seenAgain } },
      data: { lastSeenAt: now },
    });
  // A role on the board that was advertised again is noted in its history.
  for (const fingerprint of sorted.repostedOnBoard) {
    const a = await db.application.findUnique({
      where: { userId_fingerprint: { userId, fingerprint } },
    });
    if (a)
      await db.application.update({
        where: { id: a.id },
        data: {
          history: json([
            ...(a.history as HistoryEntry[]),
            { status: a.status, at: now.toISOString(), note: 'Re-advertised' },
          ]),
        },
      });
  }
}

/** Record every role a Find roles search showed; returns each listing's fingerprint by job id. */
export async function recordSeen(userId: string, jobs: any[]) {
  const sorted = sortListings(jobs, await knownRoles(userId));
  await recordListings(userId, sorted);
  return new Map<string, string>(sorted.all.map((job) => [job.id, job.fingerprint]));
}

type HistoryEntry = { status: string; at: string; note?: string };
const progress = ['saved', 'applied', 'interview', 'offer', 'rejected', 'closed'];

/**
 * Bring stored rows up to the current identity rules and give every application a mode. Rows are
 * resolved in creation order against the ones already processed; when two are the same role they
 * are merged: runs move to the earlier application, histories combine and the furthest status
 * wins. Idempotent; runs at startup.
 */
export async function migrateRoleLibrary() {
  const applications = await db.application.findMany({ orderBy: { createdAt: 'asc' } });
  const kept = new Map<string, (KnownRole & { id: string })[]>();
  for (const a of applications) {
    const job = (a.job as any).job || {};
    const pool = kept.get(a.userId) || [];
    const r = resolveRole(job, pool);
    let mode = a.mode;
    if (!mode) {
      const run = await db.mission.findFirst({
        where: { applicationId: a.id },
        orderBy: { createdAt: 'desc' },
        select: { mode: true },
      });
      mode = run?.mode || (isDemoJob(job) ? 'fixture' : 'openai');
    }
    const twin = r.match ? pool.find((k) => k.fingerprint === r.match!.fingerprint) : undefined;
    if (!twin) {
      if (
        r.fingerprint !== a.fingerprint ||
        mode !== a.mode ||
        r.key !== a.postingKey ||
        JSON.stringify(r.sig) !== JSON.stringify(a.textSig)
      )
        await db.application.update({
          where: { id: a.id },
          data: { fingerprint: r.fingerprint, mode, postingKey: r.key, textSig: json(r.sig) },
        });
      pool.push({ id: a.id, fingerprint: r.fingerprint, postingKey: r.key, textSig: r.sig });
      kept.set(a.userId, pool);
      continue;
    }
    // The earlier application is kept; this one's runs, history and notes join it.
    const target = (await db.application.findUnique({ where: { id: twin.id } }))!;
    const history = [...(target.history as HistoryEntry[]), ...(a.history as HistoryEntry[])].sort(
      (x, y) => x.at.localeCompare(y.at),
    );
    const status =
      progress.indexOf(a.status) > progress.indexOf(target.status) ? a.status : target.status;
    await db.$transaction([
      db.mission.updateMany({ where: { applicationId: a.id }, data: { applicationId: target.id } }),
      db.application.update({
        where: { id: target.id },
        data: {
          status,
          history: json(history),
          notes: [target.notes, a.notes].filter(Boolean).join('\n'),
          mode: target.mode || mode,
        },
      }),
      db.application.delete({ where: { id: a.id } }),
    ]);
  }
  const tracked = await db.trackedJob.findMany({ orderBy: { firstSeenAt: 'asc' } });
  const seen = new Map<string, (KnownRole & { id: string })[]>();
  for (const t of tracked) {
    const record = t.record as any;
    const pool = seen.get(t.userId) || [];
    // Tracked records keep the link but not the description, so the link and names decide.
    const job = {
      title: record.title,
      company: record.company,
      location: record.location,
      url: record.url,
    };
    const r = resolveRole(job, pool, new Date(), {
      key: t.postingKey || postingKey(job),
      sig: (t.textSig as number[] | null) || null,
    });
    const key = r.key;
    const twin = r.match ? pool.find((k) => k.fingerprint === r.match!.fingerprint) : undefined;
    if (!twin) {
      if (r.fingerprint !== t.fingerprint || key !== t.postingKey)
        await db.trackedJob.update({
          where: { id: t.id },
          data: { fingerprint: r.fingerprint, postingKey: key },
        });
      pool.push({
        id: t.id,
        fingerprint: r.fingerprint,
        postingKey: key,
        textSig: t.textSig as any,
      });
      seen.set(t.userId, pool);
      continue;
    }
    const target = (await db.trackedJob.findUnique({ where: { id: twin.id } }))!;
    await db.trackedJob.update({
      where: { id: target.id },
      data: {
        lastSeenAt: t.lastSeenAt > target.lastSeenAt ? t.lastSeenAt : target.lastSeenAt,
      },
    });
    await db.trackedJob.delete({ where: { id: t.id } });
  }
}
