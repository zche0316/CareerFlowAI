import {
  criteriaOf,
  interviewPlan,
  marksOf,
  type Criterion,
  type Mark,
  type PlanRound,
  type PlanStep,
} from './interview-plan.js';

// Battle report (CFS-178): a grade per stage and overall, computed from the Evaluator's marks
// already saved with each round. No new model call: the grade explains itself from the marks
// shown beside it. Each stage is judged on its own four criteria (CFS-179): STAR for behavioural
// questions, other criteria for motivation, technical, scenario, gap and closing questions.

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export const markPoints: Record<Mark, number> = { critical: 3, hit: 2, partial: 1, miss: 0 };
const rank = (m?: string) => (m && m in markPoints ? markPoints[m as Mark] : -1);

/** Letter grade for a share of the best possible score. */
export const gradeOf = (score: number): Grade =>
  score >= 0.9 ? 'S' : score >= 0.75 ? 'A' : score >= 0.55 ? 'B' : score >= 0.35 ? 'C' : 'D';

export type ReportRound = PlanRound & {
  evaluation: PlanRound['evaluation'] & { note?: string };
};

export type StageReport = {
  step: PlanStep;
  question: string;
  criteria: Pick<Criterion, 'key' | 'label' | 'means'>[];
  // A follow-up exists to fill a gap, so each criterion counts at its best mark in the stage.
  marks: Record<string, Mark> | null;
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
  const scored = own.filter((r) => marksOf(r.evaluation));
  const latest = scored.at(-1);
  const criteria = criteriaOf(step.stage, latest?.evaluation || { marks: {} }).map(
    ({ key, label, means }) => ({ key, label, means }),
  );
  if (!latest)
    return {
      step,
      question,
      criteria,
      marks: null,
      score: null,
      grade: null,
      rounds: own,
      stillWanted: '',
    };
  const marks = Object.fromEntries(
    criteria.map(({ key }) => [
      key,
      scored
        .map((r) => marksOf(r.evaluation)?.[key])
        .reduce<Mark>((best, m) => (rank(m) > rank(best) ? (m as Mark) : best), 'miss'),
    ]),
  ) as Record<string, Mark>;
  const score =
    criteria.reduce((n, c) => n + markPoints[marks[c.key]], 0) /
    (criteria.length * markPoints.critical);
  const last = own.at(-1)!;
  const stillWanted =
    step.status === 'covered' ? '' : last.unresolved || last.evaluation.followUp || '';
  return {
    step,
    question,
    criteria,
    marks,
    score,
    grade: gradeOf(score),
    rounds: own,
    stillWanted,
  };
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
