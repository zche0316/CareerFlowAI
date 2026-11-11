import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { json, ownedMission, type MissionData } from './domain.js';
import { AppError } from './errors.js';
import { checkpointHistory, enqueue } from './queue.js';

export type SavePoint = {
  checkpointId: string;
  step: number;
  at: string | null;
  source: string | null;
  next: string[];
};

/** The mission's own checkpoint history (top-level graph only), oldest first. */
export const savePoints = (missionId: string): Promise<SavePoint[]> => checkpointHistory(missionId);

export const branchPoints = {
  // Keep the Career Coach analysis; Job Matcher searches again.
  analysis: ['analysis', 'priorFeedback', 'analysisFeedback', 'refinedFromMissionId'],
  // Keep the analysis and the ranked shortlist; you choose a different job.
  shortlist: [
    'analysis',
    'priorFeedback',
    'analysisFeedback',
    'refinedFromMissionId',
    'matches',
    'jobRetrieval',
    'evidenceRetrieval',
  ],
} as const;
export type BranchPoint = keyof typeof branchPoints;

/**
 * Branch a new quest from a save point. Saved results up to that point are copied, so the
 * graph's completed nodes skip on replay and no model call is repeated. The source mission,
 * approved facts and approved resumes are never changed.
 */
export async function branchMission(userId: string, sourceId: string, from: BranchPoint) {
  const source = await ownedMission(userId, sourceId);
  const data = source.data as MissionData;
  const latest = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!latest || latest.id !== source.profileId)
    throw new AppError(
      409,
      'STALE_PROFILE',
      'Your approved profile changed after this quest. Start a new quest instead of branching.',
    );
  if (from === 'analysis' && !data.analysis)
    throw new AppError(409, 'SAVE_POINT_UNAVAILABLE', 'This quest has no saved career analysis.');
  if (from === 'shortlist' && !data.matches?.length)
    throw new AppError(409, 'SAVE_POINT_UNAVAILABLE', 'This quest has no saved shortlist.');
  const copied = Object.fromEntries(
    branchPoints[from].filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
  );
  const at = new Date().toISOString();
  const mission = await db.mission.create({
    data: {
      userId,
      profileId: source.profileId,
      goal: source.goal,
      mode: source.mode,
      data: json({
        revisions: 0,
        answers: [],
        apiCalls: 0,
        minScore: data.minScore,
        jobSearch: data.jobSearch,
        agentAccess: data.agentAccess,
        ...copied,
        branchedFrom: { missionId: source.id, savePoint: from, at },
      }),
      events: json([
        {
          at,
          agent: 'Orchestrator',
          action: 'queued',
          detail: `Branched from the ${from === 'shortlist' ? 'job choice' : 'analysis'} save point of quest ${source.id.slice(0, 8)}. Saved results were reused, not regenerated.`,
        },
      ]),
    },
  });
  await enqueue(mission.id).catch(() => {});
  return mission;
}

export function registerSavePoints(app: Express) {
  app.get('/api/missions/:id/save-points', async (req, res) => {
    const id = String(req.params.id);
    const m = await ownedMission(req.actor!.id, id);
    const data = m.data as MissionData;
    const all = await db.mission.findMany({
      where: { userId: req.actor!.id },
      select: { id: true, status: true, createdAt: true, data: true },
      orderBy: { createdAt: 'asc' },
    });
    const branches = all
      .filter((x) => (x.data as MissionData)?.branchedFrom?.missionId === id)
      .map((x) => ({
        id: x.id,
        status: x.status,
        createdAt: x.createdAt,
        savePoint: (x.data as MissionData).branchedFrom.savePoint,
        job: (x.data as MissionData).selectedJob?.job?.title || null,
      }));
    res.json({
      checkpoints: await savePoints(id),
      branchable: { analysis: Boolean(data.analysis), shortlist: Boolean(data.matches?.length) },
      branchedFrom: data.branchedFrom || null,
      branches,
    });
  });
  app.post('/api/missions/:id/branch', async (req, res) => {
    const { from } = z.object({ from: z.enum(['analysis', 'shortlist']) }).parse(req.body);
    res.status(202).json(await branchMission(req.actor!.id, String(req.params.id), from));
  });
}
