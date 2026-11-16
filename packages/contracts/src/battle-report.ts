import { interviewPlan, type PlanRound, type PlanStep } from './interview-plan.js';

// Battle report (CFS-178): a grade per stage and overall, computed from the Evaluator's STAR
// marks already saved with each round. No new model call: the grade explains itself from the
// marks shown beside it.

export const starParts = ['situation', 'task', 'action', 'result'] as const;
export type StarPart = (typeof starParts)[number];
export type Mark = 'critical' | 'hit' | 'partial' | 'miss';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export const markPoints: Record<Mark, number> = { critical: 3, hit: 2, partial: 1, miss: 0 };
const rank = (m?: string) => (m && m in markPoints ? markPoints[m as Mark] : -1);

/** Letter grade for a share of the best possible STAR score. */
export const gradeOf = (score: number): Grade =>
  score >= 0.9 ? 'S' : score >= 0.75 ? 'A' : score >= 0.55 ? 'B' : score >= 0.35 ? 'C' : 'D';

export type ReportRound = PlanRound & {
  evaluation: PlanRound['evaluation'] & { note?: string };
};

export type StageReport = {
  step: PlanStep;
  question: string;
  // A follow-up exists to fill a gap, so each STAR part counts at its best mark in the stage.
  star: Record<StarPart, Mark> | null;
  score: number | null;
  grade: Grade | null;
  rounds: ReportRound[];
  // What the panel still wanted when the follow-ups ran out or the candidate moved on.
  stillWanted: string;
};

export function stageReport(step: PlanStep, question: string, rounds: ReportRound[]): StageReport {
  const own = rounds
    .filter((r) => r.questionId === step.questionId)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const scored = own.filter((r) => r.evaluation.star);
  if (!scored.length)
    return { step, question, star: null, score: null, grade: null, rounds: own, stillWanted: '' };
  const star = Object.fromEntries(
    starParts.map((p) => [
      p,
      scored
        .map((r) => r.evaluation.star![p])
        .reduce((best, m) => (rank(m) > rank(best) ? m : best), 'miss'),
    ]),
  ) as Record<StarPart, Mark>;
  const score =
    starParts.reduce((n, p) => n + markPoints[star[p]], 0) /
    (starParts.length * markPoints.critical);
  const latest = own.at(-1)!;
  const stillWanted =
    step.status === 'covered' ? '' : latest.unresolved || latest.evaluation.followUp || '';
  return { step, question, star, score, grade: gradeOf(score), rounds: own, stillWanted };
}

export type BattleReport = {
  stages: StageReport[];
  answered: number;
  // Every planned stage counts; an unanswered or skipped stage scores zero.
  score: number;
  grade: Grade;
};

export function battleReport(
  questions: { id: string; question: string; stage?: string | null }[],
  rounds: ReportRound[],
  skipped: string[] = [],
): BattleReport {
  const plan = interviewPlan(questions, rounds, skipped);
  const stages = plan.steps.map((step, i) => stageReport(step, questions[i].question, rounds));
  const answered = stages.filter((s) => s.score !== null).length;
  const score = stages.length ? stages.reduce((n, s) => n + (s.score || 0), 0) / stages.length : 0;
  return { stages, answered, score, grade: gradeOf(score) };
}
