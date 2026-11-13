import type { Express } from 'express';
import { db } from './db.js';
import {
  capabilityLevels,
  type ExternalEvidence,
  type SkillCapability,
} from '../../../packages/contracts/src/capability.js';

// Capability levels for the signed-in user's latest approved profile (CFS-111). Computed on read
// from approved data only, so they always match the profile version the user approved. Answers
// the user confirmed during tailoring (CFS-123) count as self-reported, unverified evidence.

/** A confirmed answer supports level 2 (used) when tied to an experience, else 1 (aware). */
export function answerEvidence(
  memories: { source: unknown; text: string; recordId: string | null }[],
): ExternalEvidence[] {
  return memories.map((m) => ({
    skill: String((m.source as any)?.id || '').slice(4),
    source: 'your answer',
    verified: false,
    supports: m.recordId ? 2 : 1,
    detail: `Your answer while tailoring: ${m.text.slice(0, 160)}`,
  }));
}

export async function capabilitiesFor(userId: string): Promise<SkillCapability[]> {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile) return [];
  const stories = await db.careerMemory.findMany({
    where: { userId, status: 'CONFIRMED', kind: 'STAR', recordId: { not: null } },
    select: { recordId: true },
  });
  const answers = await db.careerMemory.findMany({
    where: { userId, status: 'CONFIRMED', source: { path: ['id'], string_starts_with: 'gap:' } },
    select: { source: true, text: true, recordId: true },
  });
  const data = profile.data as any;
  return capabilityLevels(
    data,
    [...((data.verifiedEvidence || []) as ExternalEvidence[]), ...answerEvidence(answers)],
    stories.map((s) => s.recordId!) as string[],
  );
}

export function registerCapabilities(app: Express) {
  app.get('/api/capabilities', async (req, res) =>
    res.json({ skills: await capabilitiesFor(req.actor!.id) }),
  );
}
