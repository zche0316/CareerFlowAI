// Plan-driven practice interview (CFS-166). Each question belongs to one stage of the loop most
// Australian graduate and junior tech roles use (recruiter screen, behavioural, technical,
// scenario, the candidate's questions). A stage says what it must establish and how many
// follow-ups the panel may spend on it. The panel keeps asking follow-ups at the weakest STAR
// part until the stage is covered or its budget is spent; the interview is over when every stage
// is covered, partly covered or skipped. Same long-range plan / next step / closed loop shape as
// the Profile Builder (CFS-151). Shared by the API (which enforces it) and the battle view.

export const interviewStages = [
  'motivation',
  'behavioural',
  'technical',
  'scenario',
  'gap',
  'closing',
] as const;
export type InterviewStage = (typeof interviewStages)[number];

export const STAGE_PLAN: Record<
  InterviewStage,
  { label: string; goal: string; followUps: number }
> = {
  motivation: {
    label: 'Motivation',
    goal: 'why this role and company, and what the candidate wants next',
    followUps: 1,
  },
  behavioural: {
    label: 'Behavioural',
    goal: 'one real STAR example of teamwork or handling a problem',
    followUps: 2,
  },
  technical: {
    label: 'Technical',
    goal: 'hands-on depth in a core skill for this role, explained step by step',
    followUps: 2,
  },
  scenario: {
    label: 'Scenario',
    goal: 'how the candidate would approach a realistic task in this role',
    followUps: 1,
  },
  gap: {
    label: 'Growth area',
    goal: 'an honest view of a requirement the candidate is still building, and a plan for it',
    followUps: 1,
  },
  closing: {
    label: 'Your questions',
    goal: 'a thoughtful question the candidate has for the panel',
    followUps: 0,
  },
};

// Questions saved before stages existed get one from their position.
const LEGACY_ORDER: InterviewStage[] = ['motivation', 'behavioural', 'gap', 'technical', 'closing'];
export const stageOf = (q: { stage?: string | null }, index: number): InterviewStage =>
  interviewStages.includes(q.stage as InterviewStage)
    ? (q.stage as InterviewStage)
    : LEGACY_ORDER[index] || 'behavioural';

export type PlanRound = {
  questionId: string;
  kind: 'answer' | 'follow_up';
  answer: string;
  prompt?: string;
  evaluation: { followUp: string };
  at: string;
};

export type PlanStep = {
  questionId: string;
  stage: InterviewStage;
  label: string;
  goal: string;
  budget: number;
  used: number;
  // open: not answered; probing: a follow-up is waiting; covered: the panel is satisfied;
  // partly: the follow-up budget ran out first; skipped: the candidate moved on.
  status: 'open' | 'probing' | 'covered' | 'partly' | 'skipped';
  pendingFollowUp: string;
  answers: string[];
};

export function interviewPlan(
  questions: { id: string; stage?: string | null }[],
  rounds: PlanRound[],
  skipped: string[] = [],
): { steps: PlanStep[]; done: boolean; next: PlanStep | null } {
  const steps = questions.map((q, i): PlanStep => {
    const stage = stageOf(q, i);
    const plan = STAGE_PLAN[stage];
    const own = rounds
      .filter((r) => r.questionId === q.id)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const used = own.filter((r) => r.kind === 'follow_up').length;
    const latest = own.at(-1);
    const wants = latest?.evaluation.followUp?.trim() || '';
    let status: PlanStep['status'] = !latest
      ? 'open'
      : wants && used < plan.followUps
        ? 'probing'
        : wants
          ? 'partly'
          : 'covered';
    // Moving on from an unanswered question skips it; from a follow-up, leaves it partly covered.
    if ((status === 'open' || status === 'probing') && skipped.includes(q.id))
      status = latest ? 'partly' : 'skipped';
    return {
      questionId: q.id,
      stage,
      label: plan.label,
      goal: plan.goal,
      budget: plan.followUps,
      used,
      status,
      pendingFollowUp: status === 'probing' ? wants : '',
      answers: own.map((r) => r.answer),
    };
  });
  const next = steps.find((s) => s.status === 'probing' || s.status === 'open') || null;
  return { steps, done: steps.length > 0 && !next, next };
}
