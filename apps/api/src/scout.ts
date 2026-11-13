import type { Express } from 'express';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { z } from 'zod';
import { db, databaseUrl, portablePool } from './db.js';
import { json, type MissionData } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { enqueue, queueClient } from './queue.js';
import { linkRun, listApplications, upsertApplication } from './applications.js';
import { knownRoles, postingKey, recordListings, sortListings } from './role-library.js';
import { spanHook, traceTotals } from './trace.js';
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
import { tavilyAccess } from '../../../packages/recruitment/src/tavily.js';
import { compare, vectorSimilarity } from '../../../packages/matching/domain.js';
import { configuredMode, type Mode } from '../../../packages/agents/src/provider.js';
import { mapJobRequirements, scoreJobMapping } from '../../../packages/agents/src/job-mapping.js';
import { extractJobPage } from '../../../packages/agents/src/job-page.js';
import {
  jobSearchAgentAvailable,
  searchJobsWithModel,
} from '../../../packages/agents/src/job-search-agent.js';
import { readJobs } from '../../../packages/agents/src/workflow.js';
import { buildScoutGraph, type ScoutGraphPorts } from '../../../packages/agents/src/scout/graph.js';
import { jobFingerprint } from '../../../packages/agents/src/scout/scout.js';
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
  autoPackage?: boolean;
  fetched?: number;
  fresh?: number;
  alreadySeen?: number;
  duplicates?: number;
  // Roles seen before but not shown by any search for REPOST_DAYS, listed again as new.
  reposted?: number;
  failures?: { provider: string; message: string }[];
  limitations?: string[];
  webDiscovery?: {
    pagesFound: number;
    pagesRead: number;
    accepted: number;
    rejected: { url: string; reason: string }[];
  } | null;
  // Model web search: roles it reported, how many pages passed the server check, and leads.
  agentDiscovery?: {
    model: string;
    searches: number;
    pagesOpenedByModel: number;
    reported: number;
    checked: number;
    leads: number;
    rejected: { url: string; reason: string }[];
  } | null;
  leads?: number;
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
    autoPackage: saved?.autoPackage ?? false,
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

// One package quest for a chosen role: the role is already selected, so the quest runs the
// resume team and stops at the normal draft review. Used by sweeps and by pasted leads.
async function startPackage(input: {
  userId: string;
  mode: Mode;
  sweepId: string;
  match: any;
  minScore: number;
  search: unknown;
  detail: string;
  fingerprint?: string;
}) {
  const { userId, mode, sweepId, match } = input;
  const profile = requireValue(await latestProfile(userId));
  // Reuse the latest career analysis for this profile version instead of paying for it per package.
  const analysed = (
    await db.mission.findMany({
      // Same provider mode only: a demo analysis must not seed a live quest.
      where: { userId, profileId: profile.id, mode },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
      take: 20,
    })
  ).find((m) => (m.data as MissionData).analysis);
  const at = new Date().toISOString();
  const mission = await db.mission.create({
    data: {
      userId,
      profileId: profile.id,
      goal: `Scout: ${match.job.title} at ${match.job.company}`.slice(0, 2000),
      mode,
      data: json({
        revisions: 0,
        answers: [],
        apiCalls: 0,
        minScore: input.minScore,
        jobSearch: input.search,
        agentAccess: 'all-approved-profile',
        ...(analysed ? { analysis: (analysed.data as MissionData).analysis } : {}),
        matches: [match],
        jobRetrieval: { source: 'scout', sweepId, count: 1, fetchedAt: at },
        selectedJob: match,
        scout: {
          sweepId,
          fingerprint: input.fingerprint || match.job.fingerprint || jobFingerprint(match.job),
        },
      }),
      events: json([{ at, agent: 'Scout', action: 'queued', detail: input.detail }]),
    },
  });
  await linkRun(userId, mission.id, 'scout');
  await patchSweep(sweepId, (d) => ({
    ...d,
    packages: { ...(d.packages || {}), [match.job.id]: { missionId: mission.id } },
  }));
  await enqueue(mission.id);
  return mission.id;
}

// Scores one role against the latest approved profile: the matching baseline in fixture mode,
// the Job Matcher's requirement mapping (one counted call) in live mode.
async function scoreRole(job: any, userId: string, mode: Mode, sweepId: string) {
  const profile = requireValue(await latestProfile(userId));
  const p = profile.data as unknown as CareerProfile;
  const facts = profile.facts as unknown as Fact[];
  if (mode === 'fixture')
    return compare(matchingProfileView(p), job, [job.title + ' ' + job.description]);
  const mapping = await mapJobRequirements(job, facts, mode, {
    onCall: async () => void (await patchSweep(sweepId, () => {}, { calls: 1 })),
    onTool: async () => {},
    onUsage: async () => {},
    onSpan: spanHook({ userId, sweepId, agent: 'Job Matcher' }),
  });
  return scoreJobMapping(job, mapping, facts, p);
}

// A lead was found by model web search on a site the server may not read. The user opens it,
// pastes the advertisement, and Scout scores it and starts a resume team on that text.
/**
 * Put a role from the Scout table on the board without starting a resume team. The full listing
 * comes from the sweep or search run that showed it; a lead has none until its ad is pasted.
 */
// Listings carry the identity the role library gave them; older ones fall back to the names.
const listingKey = (job: any, tag?: string) =>
  job ? tag || job.fingerprint || jobFingerprint(job) : null;

/**
 * The full listing behind a tracked role: Scout keeps its sweep's shortlist and candidates, and a
 * Find roles run keeps only the roles it ranked. A role a search showed but did not rank has a
 * summary in the role library and nothing to save from (CFS-128).
 */
async function storedListing(userId: string, sweepId: string | null, fingerprint: string) {
  let mode: string = configuredMode();
  if (sweepId) {
    const sweep = await db.scoutSweep.findUnique({ where: { id: sweepId } });
    const d = (sweep?.data || {}) as unknown as SweepData;
    const ranked = (d.shortlist || []).find((m: any) => listingKey(m.job) === fingerprint);
    const seen = (d.candidates || []).find((job) => listingKey(job) === fingerprint);
    if (sweep) mode = sweep.mode;
    if (ranked || seen)
      return { match: ranked || { job: seen, score: null }, source: 'scout' as const, mode };
  }
  for (const run of await recentRuns(userId)) {
    const found = ((run.data as MissionData).matches || []).find(
      (m: any) => listingKey(m.job, m.fingerprint) === fingerprint,
    );
    if (found) return { match: found, source: 'search' as const, mode: run.mode };
  }
  return null;
}

const recentRuns = (userId: string) =>
  db.mission.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { data: true, mode: true },
    take: 40,
  });

/** Fingerprints of tracked roles that can be saved to the board, for the Scout table. */
async function saveableRoles(
  userId: string,
  rows: { fingerprint: string; sweepId: string | null }[],
) {
  const keys = new Set<string>();
  const sweepIds = [...new Set(rows.map((r) => r.sweepId).filter(Boolean))] as string[];
  for (const sweep of await db.scoutSweep.findMany({ where: { userId, id: { in: sweepIds } } })) {
    const d = sweep.data as unknown as SweepData;
    for (const m of d.shortlist || []) keys.add(String(listingKey((m as any).job)));
    for (const job of d.candidates || []) keys.add(String(listingKey(job)));
  }
  for (const run of await recentRuns(userId))
    for (const m of (run.data as MissionData).matches || [])
      keys.add(String(listingKey(m.job, m.fingerprint)));
  return keys;
}

export async function saveTrackedRole(userId: string, fingerprint: string) {
  const tracked = requireValue(
    await db.trackedJob.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } }),
  );
  if ((tracked.record as unknown as JobRecord).lead)
    throw new AppError(
      409,
      'LEAD_NEEDS_TEXT',
      'Scout could not read this page. Open it and paste the advertisement first.',
    );
  const stored = await storedListing(userId, tracked.sweepId, fingerprint);
  if (!stored)
    throw new AppError(
      409,
      'LISTING_NOT_STORED',
      'The full listing for this role is no longer stored. Find it again or paste its link.',
    );
  const { match, source, mode } = stored;
  return upsertApplication(userId, match, source, mode);
}

export async function packageLead(
  userId: string,
  fingerprint: string,
  pasted: { description: string; title?: string; company?: string; location?: string },
) {
  const tracked = await db.trackedJob.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
  });
  if (!tracked) throw new AppError(404, 'LEAD_NOT_FOUND', 'That lead is no longer on record.');
  const record = tracked.record as unknown as JobRecord & { missionId?: string };
  if (!record.lead) throw new AppError(422, 'NOT_A_LEAD', 'Only unchecked leads take a pasted ad.');
  if (record.missionId)
    throw new AppError(409, 'LEAD_PACKAGED', 'A resume team already has this lead.');
  if (!tracked.sweepId) throw new AppError(422, 'LEAD_SWEEP', 'This lead has no sweep on record.');
  const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: tracked.sweepId } }));
  const sweepData = sweep.data as unknown as SweepData;
  const title = pasted.title?.trim() || record.title;
  const company = pasted.company?.trim() || record.company;
  const location = pasted.location?.trim() || record.location;
  const job = {
    id: 'lead-' + fingerprint.slice(0, 16),
    title,
    company,
    location,
    employmentType: 'Not supplied',
    description: pasted.description.replace(/\s+/g, ' ').trim(),
    salary: null,
    growth: null,
    applicationUrl: record.url,
    source: {
      provider: 'lead',
      name: 'Pasted lead',
      version: 'user-provided',
      externalListing: true,
      liveVacancy: false,
      fictional: false,
      fetchedAt: new Date().toISOString(),
      coverage:
        'Found by model web search; the description was pasted by the user from the original page and was not retrieved or verified by the server',
    },
  };
  const mode = sweep.mode as Mode;
  const match = { ...(await scoreRole(job, userId, mode, sweep.id)), fromLead: true };
  // The pasted text now gives the record its quoted fields; it stays marked as a lead.
  const currency = countrySpec(sweepData.search.country).currency;
  await patchSweep(sweep.id, (d) => ({ ...d, shortlist: [...(d.shortlist || []), match] }));
  const missionId = await startPackage({
    userId,
    mode,
    sweepId: sweep.id,
    match,
    minScore: sweepData.minScore,
    search: sweepData.search,
    fingerprint,
    detail: `You pasted the advertisement for ${title} (match ${Math.round(match.score)}). The resume team starts on it; you review the draft.`,
  });
  await db.trackedJob.update({
    where: { id: tracked.id },
    data: {
      record: json({
        ...buildJobRecord(job, currency),
        source: record.source,
        verified: false,
        lead: true,
        leadReason: record.leadReason,
        pasted: true,
        missionId,
      }),
    },
  });
  return { missionId, score: Math.round(match.score) };
}

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
    // Roles already seen by any search, or already on the board, are not new: Scout neither
    // lists them as new nor starts a resume team on them (role-library.ts decides identity).
    const known = await knownRoles(sweep.userId);
    // Shortlists from runs made before every search recorded its roles count as seen too.
    for (const m of await db.mission.findMany({
      where: { userId: sweep.userId },
      select: { data: true },
    }))
      for (const match of (m.data as MissionData).matches || [])
        if (match?.job && !match.fingerprint)
          known.push({
            fingerprint: jobFingerprint(match.job),
            postingKey: postingKey(match.job),
            textSig: null,
            onBoard: false,
          });

    let jobs: any[] = [];
    const failures: SweepData['failures'] = [];
    let limitations: string[] = [];
    let webDiscovery: SweepData['webDiscovery'] = null;
    // Live mode reads web pages with one counted model call each; fixture mode never does.
    const extractPage =
      sweep.mode === 'fixture'
        ? undefined
        : (page: { url: string; text: string }) =>
            extractJobPage(page, sweep.mode as Mode, {
              onCall: async () => void (await patchSweep(sweepId, () => {}, { calls: 1 })),
              onTool: async () => {},
              onUsage: async () => {},
              onSpan: spanHook({ userId: sweep.userId, sweepId, agent: 'Scout' }),
            });
    // Model web search is one counted call that runs the provider's own search tool.
    const searchAgent =
      sweep.mode === 'fixture' || !jobSearchAgentAvailable()
        ? undefined
        : (criteria: Parameters<typeof searchJobsWithModel>[0]) =>
            searchJobsWithModel(criteria, sweep.mode as Mode, {
              onCall: async () => void (await patchSweep(sweepId, () => {}, { calls: 1 })),
              onTool: async () => {},
              onUsage: async () => {},
              onSpan: spanHook({ userId: sweep.userId, sweepId, agent: 'Scout' }),
            });
    let agentDiscovery: SweepData['agentDiscovery'] = null;
    try {
      if (data.search.provider === 'fixtures') jobs = await readJobs();
      else {
        const fetched: any = await new JobRepository().search(data.search, {
          extractPage,
          searchAgent,
        });
        if (fetched.discovery?.provider === 'agent') {
          const d = fetched.discovery;
          agentDiscovery = {
            model: d.model,
            searches: d.searches,
            pagesOpenedByModel: d.pagesOpenedByModel,
            reported: d.reported,
            checked: d.checked,
            leads: d.leads,
            rejected: d.rejected,
          };
        }
        jobs = fetched.jobs;
        limitations = fetched.limitations || [];
        webDiscovery =
          fetched.webDiscovery ||
          (fetched.discovery?.provider === 'web' ? fetched.discovery : null);
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
    const sorted = sortListings(jobs, known);
    // Leads were never read, so they are recorded for the user but never scored or tailored.
    const fresh = sorted.fresh.slice(0, MAX_CANDIDATES).map(slim);
    const candidates = fresh.filter((job) => job.source?.lead !== true);
    const leads = fresh.filter((job) => job.source?.lead === true);
    const currency = countrySpec(data.search.country).currency;
    await recordListings(sweep.userId, { ...sorted, fresh }, { sweepId, currency });
    await patchSweep(
      sweepId,
      (d) => ({
        ...d,
        fetched: jobs.length,
        fresh: fresh.length,
        leads: leads.length,
        agentDiscovery,
        alreadySeen: sorted.seenAgain.length,
        duplicates: sorted.duplicates,
        reposted: fresh.filter((job) => job.reposted).length,
        failures,
        limitations,
        ...(webDiscovery
          ? {
              webDiscovery: {
                pagesFound: webDiscovery.pagesFound,
                pagesRead: webDiscovery.pagesRead,
                accepted: webDiscovery.accepted,
                rejected: webDiscovery.rejected,
              },
            }
          : {}),
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
              onSpan: spanHook({ userId: sweep.userId, sweepId, agent: 'Job Matcher' }),
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
    const missionId = await startPackage({
      userId: sweep.userId,
      mode: sweep.mode as Mode,
      sweepId,
      match,
      minScore: data.minScore,
      search: data.search,
      detail: `Scout shortlisted ${match.job.title} (match ${Math.round(match.score)}). The resume team starts on it; you review the draft.`,
    });
    return { jobId, missionId, title: match.job.title };
  },

  async autoPackage(sweepId) {
    const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: sweepId } }));
    return (sweep.data as unknown as SweepData).autoPackage === true;
  },

  async discover(sweepId, jobIds) {
    const sweep = requireValue(await db.scoutSweep.findUnique({ where: { id: sweepId } }));
    const data = sweep.data as unknown as SweepData;
    let added = 0;
    for (const jobId of jobIds) {
      const match = (data.shortlist || []).find((m) => m.job.id === jobId);
      if (!match) continue;
      await upsertApplication(sweep.userId, match, 'scout', sweep.mode, 'discovered');
      added++;
    }
    return added;
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
      data: json({
        search: setting.search,
        topK: setting.topK,
        minScore: setting.minScore,
        autoPackage: setting.autoPackage,
      }),
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
  const saveable = await saveableRoles(userId, tracked);
  // Roles already on the board show their stage instead of a Save button.
  const board = new Map(
    (await listApplications(userId)).map((a) => [
      a.fingerprint,
      { id: a.id, stage: a.stage, checkedAt: a.listingCheck?.checkedAt || null },
    ]),
  );
  // Per-sweep model work from the stored spans; sweeps before tracing simply show zeros.
  const spans = await db.traceSpan.findMany({
    where: { userId, sweepId: { in: sweeps.map((s) => s.id) } },
    select: {
      sweepId: true,
      agent: true,
      attempts: true,
      inputTokens: true,
      outputTokens: true,
      durationMs: true,
      status: true,
    },
  });
  return {
    setting: await scoutSetting(userId),
    schedule: { cron: SCOUT_CRON, timeZone: SCOUT_TZ },
    limits: { reviewPerSweep: SCOUT_REVIEW_LIMIT, sweepsPerDay: SCOUT_SWEEPS_PER_DAY },
    // The model web search source needs the native OpenAI route; the UI offers it only then.
    modelSearchAvailable: jobSearchAgentAvailable(),
    webSearchAvailable: tavilyAccess().configured,
    trackedTotal: await db.trackedJob.count({ where: { userId } }),
    tracked: tracked.map((t) => ({
      fingerprint: t.fingerprint,
      firstSeenAt: t.firstSeenAt,
      lastSeenAt: t.lastSeenAt,
      record: t.record as unknown as JobRecord,
      board: board.get(t.fingerprint) || null,
      saveable: saveable.has(t.fingerprint),
    })),
    sweeps: sweeps.map((s) => {
      const d = s.data as unknown as SweepData;
      return {
        id: s.id,
        status: s.status,
        trigger: s.trigger,
        mode: s.mode,
        calls: s.calls,
        trace: traceTotals(spans.filter((t) => t.sweepId === s.id)),
        createdAt: s.createdAt,
        finishedAt: d.finishedAt || null,
        search: d.search,
        fetched: d.fetched ?? null,
        fresh: d.fresh ?? null,
        alreadySeen: d.alreadySeen ?? null,
        duplicates: d.duplicates ?? null,
        reposted: d.reposted ?? null,
        reviewed: d.reviewed ?? null,
        notReviewed: d.notReviewed ?? null,
        failures: d.failures || [],
        limitations: d.limitations || [],
        webDiscovery: d.webDiscovery || null,
        agentDiscovery: d.agentDiscovery || null,
        leads: d.leads ?? null,
        handoffs: d.handoffs || [],
        error: d.error || null,
        // A discover-only sweep put its shortlist on the board instead of starting resume teams;
        // a lead the user pasted still gets its package.
        discovered:
          d.autoPackage === false
            ? (d.shortlist || []).filter((m) => !d.packages?.[m.job.id]).length
            : 0,
        packages: (d.shortlist || [])
          .filter((m) => d.autoPackage !== false || d.packages?.[m.job.id])
          .map((match) => {
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
              critic:
                typeof md.resumeTeam?.critiques?.at(-1)?.pass === 'boolean'
                  ? md.resumeTeam.critiques.at(-1).pass
                    ? 'passed'
                    : 'open issues'
                  : null,
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
        autoPackage: z.boolean().default(false),
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
  app.post('/api/scout/leads/:fingerprint/package', async (req, res) => {
    const input = z
      .object({
        description: z
          .string()
          .trim()
          .min(200, 'Paste the full advertisement (at least 200 characters).')
          .max(20000),
        title: z.string().max(300).optional(),
        company: z.string().max(300).optional(),
        location: z.string().max(300).optional(),
      })
      .parse(req.body);
    const fingerprint = z
      .string()
      .regex(/^[a-f0-9]{16,64}$/)
      .parse(req.params.fingerprint);
    res.status(202).json(await packageLead(req.actor!.id, fingerprint, input));
  });
  app.post('/api/scout/roles/:fingerprint/save', async (req, res) => {
    const fingerprint = z
      .string()
      .regex(/^[a-f0-9]{16,64}$/)
      .parse(req.params.fingerprint);
    res.status(201).json(await saveTrackedRole(req.actor!.id, fingerprint));
  });
  app.post('/api/scout/sweeps', async (req, res) => {
    const sweep = await startSweep(req.actor!.id, 'manual');
    res.status(202).json({ id: sweep.id, status: sweep.status });
  });
}
