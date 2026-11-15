import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { lightJson } from '../../../packages/agents/src/conversation/light-model.js';
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
  const rules = capabilityLevels(
    data,
    [...((data.verifiedEvidence || []) as ExternalEvidence[]), ...answerEvidence(answers)],
    stories.map((s) => s.recordId!) as string[],
  );
  return judgeCapabilities(`${userId}:${profile.version}`, rules, data);
}

// Model judgement of capability levels (CFS-161). The rules count evidence (listed, used in a
// record, a STAR result, months of work); they cannot read how deep the work was. A light model
// reads each skill's evidence in the user's own words and sets the level, within bounds: at most
// one level from the rule level, never above 1 without a record or external evidence, and never
// 4 without more than a year of work. One call per approved profile version, cached; the rules
// stand whenever no model answers.
const JUDGE = `You assess a candidate's capability per technical skill from their approved profile evidence only. Levels: 0 no evidence, 1 aware (listed, coursework), 2 used (applied it in real work or a project), 3 proficient (used it independently for a non-trivial result, more than once or with a clear outcome), 4 advanced (deep, sustained use over more than a year, leading or designing with it). Judge depth from what the evidence says the person personally did, not from how often the skill is named. Team results are not personal depth. Never infer beyond the text. For every skill return {"skill", "level", "reason"}: the reason is one short sentence quoting or pointing to the evidence, written to the candidate ("You used…"). Return {"skills": [...]}.`;
const judgeSchema = z.object({
  skills: z.array(
    z.object({
      skill: z.string(),
      level: z.number().int().min(0).max(4),
      reason: z.string().max(300),
    }),
  ),
});
const judged = new Map<string, Map<string, { level: number; reason: string }>>();

function evidenceText(skill: SkillCapability, profile: any) {
  const records = [...(profile.workExperiences || []), ...(profile.projects || [])];
  return skill.evidence.slice(0, 4).map((e) => {
    const r = e.recordId ? records.find((x: any) => x.id === e.recordId) : null;
    if (!r) return e.label;
    const story = r.starStory
      ? Object.entries(r.starStory)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' ')
      : '';
    return `${e.label} (${r.startMonth || '?'} to ${r.current ? 'now' : r.endMonth || '?'}): ${[r.overview, story].filter(Boolean).join(' ').slice(0, 700)}`;
  });
}

export async function judgeCapabilities(
  key: string,
  rules: SkillCapability[],
  profile: any,
): Promise<SkillCapability[]> {
  if (!rules.length || configuredMode() === 'fixture') return rules;
  if (!judged.has(key)) {
    const out = await lightJson(
      JUDGE,
      {
        skills: rules.slice(0, 25).map((s) => ({
          skill: s.skill,
          ruleLevel: s.rawLevel,
          evidence: evidenceText(s, profile),
        })),
      },
      judgeSchema,
      [],
      { timeoutMs: 20000, maxTokens: 2500 },
    );
    if (!out) return rules;
    judged.set(key, new Map(out.skills.map((s) => [s.skill.toLowerCase(), s])));
  }
  const verdicts = judged.get(key)!;
  return rules
    .map((s) => {
      const v = verdicts.get(s.skill.toLowerCase());
      if (!v) return s;
      const hasRecord = s.evidence.some((e) => e.kind === 'record' || e.kind === 'external');
      const ceiling = !hasRecord ? 1 : s.rawLevel === 4 ? 4 : 3;
      // Listed or studied is at least "aware"; the model cannot erase what the profile states.
      const floor = s.evidence.some((e) => e.kind === 'listed' || e.kind === 'course') ? 1 : 0;
      const level = Math.max(
        floor,
        0,
        Math.min(ceiling, s.rawLevel + 1, Math.max(s.rawLevel - 1, v.level)),
      );
      // The recency rule still applies after judgement.
      const shown = (s.stale && level > 1 ? level - 1 : level) as SkillCapability['level'];
      return {
        ...s,
        level: shown,
        judgement: { level: level as any, ruleLevel: s.rawLevel, reason: v.reason },
      };
    })
    .sort((a, b) => b.level - a.level || a.skill.localeCompare(b.skill));
}

export function registerCapabilities(app: Express) {
  app.get('/api/capabilities', async (req, res) =>
    res.json({ skills: await capabilitiesFor(req.actor!.id) }),
  );
}
