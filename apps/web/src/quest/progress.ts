import { mentions } from '../../../../packages/agents/src/resume-team/gap-analysis.js';

// Game numbers are derived from records the user already controls, so they can't be farmed by
// sending more applications and they never disagree with the workspace. Rules, in one place:
export const XP_RULES = {
  approvedFact: 10, // each fact in the approved profile
  approvedResume: 80, // each resume version you explicitly approved
  practiceAnswer: 30, // each saved interview practice answer
  completedMission: 100, // a mission that reached interview feedback
  coachQuest: 60, // reward shown for a Coach action (side quest)
} as const;
export const XP_PER_LEVEL = 1000;

type Fact = { id: string; kind: string; text: string; recordHeaderId?: string };

export function progressFrom(workspace: any) {
  const facts: Fact[] = workspace?.profile?.facts || [];
  const missions: any[] = workspace?.missions || [];
  const resumes: any[] = workspace?.resumes || [];
  const answers = missions.reduce((n, m) => n + (m.data?.answers?.length || 0), 0);
  const completed = missions.filter((m) => m.status === 'COMPLETE').length;
  const xp =
    facts.length * XP_RULES.approvedFact +
    resumes.length * XP_RULES.approvedResume +
    answers * XP_RULES.practiceAnswer +
    completed * XP_RULES.completedMission;
  return {
    xp,
    level: Math.floor(xp / XP_PER_LEVEL) + 1,
    intoLevel: xp % XP_PER_LEVEL,
    sources: [
      { label: 'Approved facts', xp: facts.length * XP_RULES.approvedFact },
      { label: 'Approved resumes', xp: resumes.length * XP_RULES.approvedResume },
      { label: 'Practice answers', xp: answers * XP_RULES.practiceAnswer },
      { label: 'Missions completed', xp: completed * XP_RULES.completedMission },
    ],
  };
}

export type SkillTile = {
  term: string;
  askedBy: number;
  jobs: number;
  status: 'unlocked' | 'partial' | 'locked';
  factIds: string[];
};

// Skill board: what the latest ranked jobs ask for, against what approved facts show.
export function skillBoard(workspace: any, limit = 5): SkillTile[] {
  const facts: Fact[] = workspace?.profile?.facts || [];
  const source = (workspace?.missions || []).find((m: any) => m.data?.matches?.length);
  const matches: any[] = (source?.data?.matches || []).slice(0, limit);
  const counts = new Map<string, { label: string; askedBy: number; partial: boolean }>();
  for (const match of matches) {
    const terms = new Set<string>(
      [...(match.requirements?.required || []), ...(match.requirements?.preferred || [])].map(
        (t: string) => t.trim(),
      ),
    );
    for (const term of terms) {
      if (!term) continue;
      const key = term.toLowerCase();
      const partial = (match.mapping?.items || []).some(
        (i: any) => i.term?.toLowerCase() === key && i.status === 'partial',
      );
      const entry = counts.get(key) || { label: term, askedBy: 0, partial: false };
      entry.askedBy += 1;
      entry.partial ||= partial;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .map(({ label, askedBy, partial }) => {
      const factIds = facts.filter((f) => mentions(f.text, label)).map((f) => f.id);
      const status: SkillTile['status'] = factIds.length ? 'unlocked' : partial ? 'partial' : 'locked';
      return { term: label, askedBy, jobs: matches.length, status, factIds };
    })
    .sort(
      (a, b) =>
        b.askedBy - a.askedBy ||
        Number(b.status === 'unlocked') - Number(a.status === 'unlocked') ||
        a.term.localeCompare(b.term),
    )
    .slice(0, 12);
}

// Attributes: each approved skill, strengthened by how many approved facts back it (max 5).
export function attributes(workspace: any) {
  const facts: Fact[] = workspace?.profile?.facts || [];
  const skills: string[] = workspace?.profile?.data?.skills || [];
  return skills
    .map((skill) => ({
      skill,
      facts: facts.filter((f) => mentions(f.text, skill)).length,
    }))
    .map((a) => ({ ...a, points: Math.min(5, a.facts) }))
    .sort((a, b) => b.points - a.points || a.skill.localeCompare(b.skill));
}

// How many approved resumes use each fact: the "equipped in" count on inventory cards.
export function factUsage(workspace: any) {
  const usage = new Map<string, number>();
  for (const resume of workspace?.resumes || [])
    for (const claim of resume.content?.claims || [])
      usage.set(claim.factId, (usage.get(claim.factId) || 0) + 1);
  return usage;
}
