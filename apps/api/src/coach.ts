import { z } from 'zod';
import type { Express } from 'express';
import { db } from './db.js';
import { json, type MissionData } from './domain.js';
import { AppError } from './errors.js';
import { recordSpan, spanHook } from './trace.js';
import { listApplications } from './applications.js';
import { coachSources, loadCorpus } from './coach-sources.js';
import { configuredMode, generate, type Mode } from '../../../packages/agents/src/provider.js';
import { missionContext } from '../../../packages/agents/src/mission-context.js';
import { coachSchema, type Fact } from '../../../packages/contracts/src/index.js';

// The Career Coach at workspace level: its advice belongs to the profile version, not to one run,
// and its next actions come from every role on the board. Actions are rules over saved data, so
// they cost nothing; only "Refresh advice" makes one counted model call.

export type CoachAction = {
  id: string;
  text: string;
  reason: string;
  action:
    | { kind: 'find' }
    | { kind: 'tailor'; applicationId: string }
    | { kind: 'quests' }
    | { kind: 'profile' }
    | { kind: 'refresh' };
};

type AppSummary = {
  id: string;
  title: string;
  company: string;
  stage: string;
  score: number | null;
  updatedAt: Date | string;
  history: { status: string; at: string }[];
  gaps?: string[];
  levelGaps?: { skill: string; need: number; have: number; level: string }[];
};

const DAY = 86400000;

/** Next actions from the board, most useful first. Pure, so the rules are unit-tested. */
export function coachActions(input: {
  applications: AppSummary[];
  analysis: 'current' | 'stale' | 'none';
  lastFeedback: { jobTitle: string; improvements: string[] } | null;
  now?: Date;
}): CoachAction[] {
  const now = (input.now || new Date()).getTime();
  const apps = input.applications;
  const out: CoachAction[] = [];
  if (input.analysis !== 'current')
    out.push({
      id: 'refresh',
      text:
        input.analysis === 'stale'
          ? 'Refresh your career advice for your updated profile.'
          : 'Ask the Coach for career advice on your profile.',
      reason:
        input.analysis === 'stale'
          ? 'Your profile changed since the last advice.'
          : 'No advice has been prepared for this profile yet.',
      action: { kind: 'refresh' },
    });
  if (!apps.length)
    out.push({
      id: 'find',
      text: 'Find roles to start your first quest.',
      reason: 'Your board is empty.',
      action: { kind: 'find' },
    });
  for (const a of apps
    .filter((a) => a.stage === 'ready')
    .sort((x, y) => String(x.updatedAt).localeCompare(String(y.updatedAt))))
    out.push({
      id: `apply-${a.id}`,
      text: `Apply for ${a.title} at ${a.company}, then record it.`,
      reason: 'Your resume for this role is approved but not marked as applied.',
      action: { kind: 'quests' },
    });
  for (const a of apps
    .filter((a) => a.stage === 'saved' || a.stage === 'discovered')
    .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
    .slice(0, 2))
    out.push({
      id: `tailor-${a.id}`,
      text: `Tailor a resume for ${a.title} at ${a.company}.`,
      reason:
        (a.stage === 'discovered' ? 'Found by Scout' : 'Saved role') +
        (a.score !== null ? ` with a match of ${a.score}.` : '.'),
      action: { kind: 'tailor', applicationId: a.id },
    });
  for (const a of apps.filter((a) => a.stage === 'interview'))
    out.push({
      id: `practise-${a.id}`,
      text: `Practise the interview again for ${a.title}.`,
      reason: 'You recorded an interview for this role.',
      action: { kind: 'tailor', applicationId: a.id },
    });
  for (const a of apps.filter((a) => a.stage === 'applied')) {
    const applied = [...a.history].reverse().find((h) => h.status === 'applied');
    if (applied && now - new Date(applied.at).getTime() > 14 * DAY)
      out.push({
        id: `follow-${a.id}`,
        text: `Follow up on ${a.title} at ${a.company}.`,
        reason: 'You applied more than two weeks ago and recorded no reply.',
        action: { kind: 'quests' },
      });
  }
  if (input.lastFeedback?.improvements[0])
    out.push({
      id: 'practice-feedback',
      text: input.lastFeedback.improvements[0],
      reason: `From your last interview practice for ${input.lastFeedback.jobTitle}.`,
      action: { kind: 'quests' },
    });
  // A skill several open roles need at a higher level than the profile shows (CFS-111).
  const open = apps.filter((a) => !['rejected', 'closed'].includes(a.stage));
  const short = new Map<string, { roles: number; need: number; have: number }>();
  for (const a of open)
    for (const g of a.levelGaps || [])
      if (g.level === 'required') {
        const e = short.get(g.skill) || { roles: 0, need: 0, have: g.have };
        short.set(g.skill, { roles: e.roles + 1, need: Math.max(e.need, g.need), have: g.have });
      }
  const top = [...short].filter(([, e]) => e.roles >= 2).sort((x, y) => y[1].roles - x[1].roles)[0];
  if (top)
    out.push({
      id: 'level-gap',
      text: `${top[1].roles} of your roles need ${top[0]} at level ${top[1].need}; you are at ${top[1].have}. Add a project or story that uses it, if you have real evidence.`,
      reason: 'The most common required level gap across your open roles.',
      action: { kind: 'profile' },
    });
  // A requirement several roles ask for that the profile has no evidence for.
  const counts = new Map<string, number>();
  for (const a of apps)
    for (const g of new Set(a.gaps || [])) counts.set(g, (counts.get(g) || 0) + 1);
  const common = [...counts].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1])[0];
  if (common && !top)
    out.push({
      id: 'gap',
      text: `${common[1]} of your roles ask for ${common[0]}. Add it to your profile if you have real evidence.`,
      reason: 'A requirement with no approved evidence across several roles.',
      action: { kind: 'profile' },
    });
  return out.slice(0, 6);
}

async function latestFeedback(userId: string) {
  const missions = await db.mission.findMany({
    where: { userId, status: 'COMPLETE' },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });
  const m = missions.find((x) => (x.data as MissionData).feedback);
  if (!m) return null;
  const d = m.data as MissionData;
  return {
    jobTitle: d.selectedJob?.job?.title || 'a role',
    improvements: d.feedback.improvements || [],
    nextSteps: d.feedback.nextSteps || [],
    recordedAt: m.updatedAt.toISOString(),
  };
}

/**
 * Career advice already paid for on this profile version and provider mode: the workspace Coach's
 * latest review, else the analysis from an earlier run. New runs reuse it instead of a new call.
 */
export async function reusableAnalysis(userId: string, profileId: string, mode: string) {
  const review = await db.coachReview.findFirst({
    where: { userId, profileId, mode },
    orderBy: { createdAt: 'desc' },
  });
  if (review) return review.analysis as MissionData['analysis'];
  const run = (
    await db.mission.findMany({
      where: { userId, profileId, mode },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
      take: 20,
    })
  ).find((m) => (m.data as MissionData).analysis);
  return run ? (run.data as MissionData).analysis : null;
}

/** The Coach panel: latest advice for the current profile version plus the next actions. */
export async function coachOverview(userId: string, applications?: any[]) {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile) return null;
  const mode = configuredMode();
  const apps = applications || (await listApplications(userId));
  const review = await db.coachReview.findFirst({
    where: { userId, profileId: profile.id, mode },
    orderBy: { createdAt: 'desc' },
  });
  // Older advice from a run on this profile version counts until the Coach is asked again.
  const fromRun = review
    ? null
    : (
        await db.mission.findMany({
          where: { userId, profileId: profile.id, mode },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      ).find((m) => (m.data as MissionData).analysis);
  const older = review || fromRun ? null : await db.coachReview.findFirst({ where: { userId } });
  const analysis = review?.analysis || (fromRun?.data as MissionData | undefined)?.analysis || null;
  const feedback = await latestFeedback(userId);
  return {
    profileVersion: profile.version,
    analysis,
    sources: citedSources(analysis),
    analysedAt: review?.createdAt || fromRun?.createdAt || null,
    actions: coachActions({
      applications: apps.map((a) => ({ ...a, gaps: (a.gaps as string[]) || [] })),
      analysis: analysis ? 'current' : older ? 'stale' : 'none',
      lastFeedback: feedback,
    }),
  };
}

/** One counted Coach call on the approved profile, saved for this profile version. */
export async function refreshCoach(userId: string, feedback = '') {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile) throw new AppError(409, 'PROFILE_REQUIRED', 'Approve your profile first.');
  if ((profile.data as any)?.sharing?.coach === false)
    throw new AppError(403, 'SHARING_DISABLED', 'Coach access to your profile is turned off.');
  const recent = await db.coachReview.findFirst({
    where: { userId, createdAt: { gt: new Date(Date.now() - 60000) } },
  });
  if (recent)
    throw new AppError(
      429,
      'COACH_BUSY',
      'The Coach just reviewed your profile. Try again in a minute.',
    );
  const mode = configuredMode() as Mode;
  const facts = profile.facts as unknown as Fact[];
  const apps = await listApplications(userId);
  const board = apps
    .slice(0, 12)
    .map((a) => `${a.title} at ${a.company} (${a.stage})`)
    .join('; ');
  // Reference passages for what the user is aiming at (CFS-125); empty until the corpus is built.
  const data = profile.data as any;
  const started = Date.now();
  const retrieval = await coachSources(
    [data?.goals, feedback, ...(data?.skills || []), ...apps.slice(0, 6).map((a) => a.title)]
      .filter(Boolean)
      .join(' '),
  );
  const publicSources = retrieval.sources;
  // The query embedding is one small request; it is traced so the cost table shows it (CFS-141).
  if (retrieval.method === 'embedding')
    await recordSpan({ userId, agent: 'Coach sources' }, {
      role: 'embedding',
      model: 'text-embedding-3-small',
      mode: configuredMode(),
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      attempts: 1,
      inputTokens: retrieval.tokens,
      outputTokens: 0,
      status: 'ok',
    } as any);
  const known = new Set(facts.map((f) => f.id));
  const sourceIds = new Set(publicSources.map((s) => s.id));
  const grounded = coachSchema.superRefine((analysis, ctx) => {
    for (const [section, items] of Object.entries(analysis))
      items.forEach((item, index) => {
        if (
          !item.evidenceIds.some((id) => known.has(id)) ||
          item.evidenceIds.some((id) => !known.has(id) && !sourceIds.has(id))
        )
          ctx.addIssue({
            code: 'custom',
            path: [section, index, 'evidenceIds'],
            message:
              'Cite at least one supplied approved fact ID; other IDs must be supplied public source IDs.',
          });
      });
  });
  let usage = { calls: 0, input: 0, output: 0 };
  const analysis = await generate(
    'coach',
    missionContext('coach', {
      goal: String((profile.data as any)?.goals || 'Plan my next career step.'),
      facts,
      publicSources,
      // The roles being pursued, and what the user asked the Coach to revisit.
      ...(board || feedback
        ? {
            analysisFeedback: [
              board ? `Roles the candidate is pursuing now: ${board}.` : '',
              feedback ? `The candidate asks the Coach to revisit: ${feedback}` : '',
            ]
              .filter(Boolean)
              .join(' '),
          }
        : {}),
    }),
    grounded,
    mode,
    {
      onCall: async () => void usage.calls++,
      onTool: async () => {},
      onUsage: async (input, output) => {
        usage = { ...usage, input: usage.input + input, output: usage.output + output };
      },
      onSpan: spanHook({ userId, agent: 'Career Coach' }),
    },
  );
  await db.coachReview.create({
    data: {
      userId,
      profileId: profile.id,
      mode,
      analysis: json(analysis),
      calls: usage.calls,
      inputTokens: usage.input,
      outputTokens: usage.output,
    },
  });
  return coachOverview(userId, apps);
}

export function registerCoach(app: Express) {
  app.get('/api/coach', async (req, res) => res.json(await coachOverview(req.actor!.id)));
  app.post('/api/coach/refresh', async (req, res) => {
    const { feedback } = z
      .object({ feedback: z.string().trim().max(2000).default('') })
      .parse(req.body || {});
    res.json(await refreshCoach(req.actor!.id, feedback));
  });
}

/** Titles, links and attribution for the public sources an analysis cites (CFS-125, 140). */
function citedSources(analysis: any) {
  const corpus = loadCorpus();
  if (!corpus || !analysis) return null;
  const ids = new Set<string>(
    Object.values(analysis as Record<string, any[]>)
      .flat()
      .flatMap((item: any) => item?.evidenceIds || [])
      .filter((id: string) => corpus.sources.some((s) => String(id).startsWith(s.prefix))),
  );
  if (!ids.size) return null;
  const used = corpus.sources.filter((s) => [...ids].some((id) => id.startsWith(s.prefix)));
  return {
    attribution: used.map((s) => s.attribution).join('\n'),
    docs: corpus.docs
      .filter((d) => ids.has(d.id))
      .map(({ id, title, url, source }) => ({ id, title, url, source })),
  };
}
