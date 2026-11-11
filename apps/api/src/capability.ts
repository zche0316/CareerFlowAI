import type { Express } from 'express';
import { db } from './db.js';
import {
  capabilityLevels,
  type ExternalEvidence,
  type SkillCapability,
} from '../../../packages/contracts/src/capability.js';

// Capability levels for the signed-in user's latest approved profile (CFS-111). Computed on read
// from approved data only, so they always match the profile version the user approved.

export async function capabilitiesFor(userId: string): Promise<SkillCapability[]> {
  const profile = await db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } });
  if (!profile) return [];
  const stories = await db.careerMemory.findMany({
    where: { userId, status: 'CONFIRMED', kind: 'STAR', recordId: { not: null } },
    select: { recordId: true },
  });
  const data = profile.data as any;
  return capabilityLevels(
    data,
    (data.verifiedEvidence || []) as ExternalEvidence[],
    stories.map((s) => s.recordId!) as string[],
  );
}

export function registerCapabilities(app: Express) {
  app.get('/api/capabilities', async (req, res) =>
    res.json({ skills: await capabilitiesFor(req.actor!.id) }),
  );
}
