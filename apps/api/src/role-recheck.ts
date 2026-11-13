import type { Express } from 'express';
import { db } from './db.js';
import { json } from './domain.js';
import { queueClient } from './queue.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { JobRepository } from '../../../packages/recruitment/src/repository.js';
import { robotsAllow } from '../../../packages/recruitment/src/agent-discovery.js';

// Re-check tracked roles (CFS-122). Official board listings (Greenhouse, Lever, Ashby) are asked
// again through their public APIs; other roles are checked by fetching their link where the
// site's robots.txt allows it. A role the user has not applied to is closed when its listing is
// gone; an applied role is only flagged, so the user's own record never changes silently.

export type ListingCheck = {
  status: 'published' | 'closed' | 'reachable' | 'unverified';
  checkedAt: string;
  method: 'official-job-board-api' | 'link' | 'none';
  reason?: string;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Revalidate = (job: any) => Promise<{ status: string; reason?: string }>;

const AGENT = { 'User-Agent': 'CareerFlow-role-check' };
const BOARD_APIS = ['greenhouse', 'lever', 'ashby'];
// Statuses whose listing still matters. Offers, rejections and closed roles are left alone.
const TRACKED = ['saved', 'discovered', 'applied', 'interview'];
const APPLIED = ['applied', 'interview'];
// A role is checked at most this often, and a run checks at most this many roles.
export const RECHECK_EVERY_MS = 20 * 3600 * 1000;
export const RECHECK_BATCH = 20;
const RECHECK_QUEUE = 'careerflow-role-recheck';
export const RECHECK_CRON = '30 6 * * *';

/** One listing: the official board API where there is one, else its link. Never throws. */
export async function checkListing(
  job: any,
  deps: { revalidate?: Revalidate; fetcher?: Fetcher; now?: Date } = {},
): Promise<ListingCheck> {
  const checkedAt = (deps.now || new Date()).toISOString();
  const provider = job?.source?.provider;
  // Demo roles are fictional, so there is no listing to ask about.
  if (job?.source?.type === 'disclosed-fixture' || job?.source?.fictional === true)
    return {
      status: 'unverified',
      checkedAt,
      method: 'none',
      reason: 'Demo role: there is no real listing.',
    };
  if (BOARD_APIS.includes(provider)) {
    try {
      const r = await (deps.revalidate || ((j) => new JobRepository().revalidate(j)))(job);
      if (r.status === 'published_at_check')
        return { status: 'published', checkedAt, method: 'official-job-board-api' };
      if (r.status === 'closed_or_removed')
        return {
          status: 'closed',
          checkedAt,
          method: 'official-job-board-api',
          reason: 'The employer’s job board no longer lists it.',
        };
      return {
        status: 'unverified',
        checkedAt,
        method: 'official-job-board-api',
        reason: r.reason,
      };
    } catch (e) {
      return {
        status: 'unverified',
        checkedAt,
        method: 'official-job-board-api',
        reason: `The job board could not be checked: ${(e as Error).message.slice(0, 120)}`,
      };
    }
  }
  return checkLink(job?.applicationUrl || job?.url, deps.fetcher || fetch, checkedAt);
}

async function checkLink(
  url: string | undefined,
  fetcher: Fetcher,
  checkedAt: string,
): Promise<ListingCheck> {
  let u: URL;
  try {
    u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) throw Error('scheme');
  } catch {
    return { status: 'unverified', checkedAt, method: 'none', reason: 'No public link to check.' };
  }
  const robots = await fetcher(`${u.origin}/robots.txt`, {
    headers: AGENT,
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  if (robots && !robotsAllow(robots, u))
    return {
      status: 'unverified',
      checkedAt,
      method: 'link',
      reason: 'The site asks automated readers not to open this page.',
    };
  try {
    const r = await fetcher(u.href, {
      headers: { ...AGENT, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 404 || r.status === 410)
      return {
        status: 'closed',
        checkedAt,
        method: 'link',
        reason: `The link now returns ${r.status}.`,
      };
    if (r.ok)
      // A page that still loads is not proof the role is open, so it is not called published.
      return {
        status: 'reachable',
        checkedAt,
        method: 'link',
        reason: 'The link still opens; the page may not say whether the role is open.',
      };
    return {
      status: 'unverified',
      checkedAt,
      method: 'link',
      reason: `The link returned ${r.status}.`,
    };
  } catch {
    return {
      status: 'unverified',
      checkedAt,
      method: 'link',
      reason: 'The link could not be reached.',
    };
  }
}

/** Re-check the user's tracked roles that are due, and apply the result to each role. */
export async function recheckRoles(
  userId: string,
  deps: Parameters<typeof checkListing>[1] & { force?: boolean } = {},
) {
  const now = deps.now || new Date();
  const roles = await db.application.findMany({
    where: { userId, status: { in: TRACKED }, OR: [{ mode: configuredMode() }, { mode: null }] },
    orderBy: { updatedAt: 'asc' },
  });
  const due = roles
    .filter((a) => {
      const last = (a.job as any)?.listingCheck?.checkedAt;
      return deps.force || !last || now.getTime() - new Date(last).getTime() >= RECHECK_EVERY_MS;
    })
    .slice(0, RECHECK_BATCH);
  const summary = { checked: 0, closed: 0, flagged: 0, published: 0, reachable: 0, unverified: 0 };
  for (const a of due) {
    const match = a.job as any;
    const check = await checkListing(match.job, deps);
    summary.checked++;
    const applied = APPLIED.includes(a.status);
    if (check.status === 'closed') applied ? summary.flagged++ : summary.closed++;
    else summary[check.status]++;
    const history = a.history as { status: string; at: string; note?: string }[];
    const closeIt = check.status === 'closed' && !applied;
    await db.application.update({
      where: { id: a.id },
      data: {
        job: json({ ...match, listingCheck: check }),
        ...(closeIt
          ? {
              status: 'closed',
              history: json([
                ...history,
                { status: 'closed', at: check.checkedAt, note: `Listing closed: ${check.reason}` },
              ]),
            }
          : {}),
      },
    });
  }
  return summary;
}

/** Daily re-check for every user with tracked roles, after the worker starts. */
export async function initRecheck(withWorker: boolean) {
  const boss = queueClient();
  await boss.createQueue(RECHECK_QUEUE);
  if (!withWorker) return;
  await boss.work(RECHECK_QUEUE, async () => {
    const users = await db.application.findMany({
      where: { status: { in: TRACKED } },
      distinct: ['userId'],
      select: { userId: true },
    });
    for (const { userId } of users)
      await recheckRoles(userId).catch((e) =>
        console.error('Role re-check skipped:', e instanceof Error ? e.message : e),
      );
  });
  await boss.schedule(RECHECK_QUEUE, RECHECK_CRON, null, { tz: 'Australia/Sydney' });
}

export function registerRoleRecheck(app: Express) {
  // Checks roles not checked in the last 20 hours; the daily job does the same for everyone.
  app.post('/api/applications/recheck', async (req, res) =>
    res.json(await recheckRoles(req.actor!.id)),
  );
}
