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
// Questions saved before stages existed are "general": one follow-up, as they always had.
export type PlanStage = InterviewStage | 'general';

export const STAGE_PLAN: Record<PlanStage, { label: string; goal: string; followUps: number }> = {
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
  general: {
    label: 'Question',
    goal: 'a specific, personal answer to the question',
    followUps: 1,
  },
};

// What each stage is judged on (CFS-179): four criteria scored with the same four marks, so
// grades compare across stages. STAR fits behavioural questions only; older questions without a
// stage were always scored on STAR and keep it. `ask` is the demo follow-up for a weak criterion
// and `cue` the demo rule that spots it; the Evaluator model reads `means`.
export type Criterion = { key: string; label: string; means: string; ask: string; cue: RegExp };
const STAR: Criterion[] = [
  {
    key: 'situation',
    label: 'Situation',
    means: 'where and when it happened',
    ask: 'Where and when was this? Set the scene briefly.',
    cue: /\b(at|during|when|while|in my)\b/,
  },
  {
    key: 'task',
    label: 'Task',
    means: 'what the candidate was asked or trying to achieve',
    ask: 'What were you specifically asked or trying to achieve?',
    cue: /\b(needed|had to|asked|goal|responsible|task)\b/,
  },
  {
    key: 'action',
    label: 'Action',
    means: 'what the candidate personally did, not the team',
    ask: 'What did you personally do, as opposed to the team?',
    cue: /\bi\b/,
  },
  {
    key: 'result',
    label: 'Result',
    means: 'an observable change that followed; never reward invented numbers',
    ask: 'And what changed because of what you did?',
    cue: /\b(result|so that|which meant|afterwards|improved|reduced|saved)\b/,
  },
];
export const RUBRICS: Record<PlanStage, Criterion[]> = {
  behavioural: STAR,
  general: STAR,
  motivation: [
    {
      key: 'role',
      label: 'Role',
      means: 'why this particular role, beyond wanting any job',
      ask: 'What draws you to this role specifically?',
      cue: /\b(role|position|analyst|engineer|developer|this job|work on)\b/,
    },
    {
      key: 'employer',
      label: 'Employer',
      means: 'why this employer or team, from something specific about them',
      ask: 'Why this company rather than a similar one?',
      cue: /\b(company|firm|team|organisation|organization|clients?|your)\b/,
    },
    {
      key: 'evidence',
      label: 'Evidence',
      means: 'experience of their own that shows the interest is real',
      ask: 'What have you already done that shows this interest?',
      cue: /\b(i (built|worked|did|studied|completed|enjoyed|automated|wrote)|internship|project)\b/,
    },
    {
      key: 'direction',
      label: 'Direction',
      means: 'what they want to learn or achieve next',
      ask: 'Where do you want this role to take you?',
      cue: /\b(learn|grow|next|future|career|develop|goal)\b/,
    },
  ],
  technical: [
    {
      key: 'approach',
      label: 'Approach',
      means: 'clear steps in a sensible order',
      ask: 'Walk me through the steps in order.',
      cue: /\b(first|then|next|finally|step)\b/,
    },
    {
      key: 'specifics',
      label: 'Specifics',
      means: 'concrete tools, methods or techniques, used correctly',
      ask: 'Which tools or techniques exactly, and why those?',
      cue: /\b(sql|python|pandas|join|query|regression|api|excel|tableau|power bi|git)\b/,
    },
    {
      key: 'checks',
      label: 'Checks',
      means: 'how they verify the result, handle edge cases or weigh trade-offs',
      ask: 'How would you check that the result is right?',
      cue: /\b(check|validat|verif|test|edge case|trade-?off|compare|reconcil)/,
    },
    {
      key: 'experience',
      label: 'Experience',
      means: 'grounding in something they actually did',
      ask: 'Where have you done this yourself?',
      cue: /\b(i (built|wrote|used|did|analysed|analyzed|automated)|in my (internship|project|course))\b/,
    },
  ],
  scenario: [
    {
      key: 'clarify',
      label: 'Clarify',
      means: 'pins down the question, scope and assumptions first',
      ask: 'What would you want to clarify before starting?',
      cue: /\b(clarify|assum|scope|define|pin down|understand)/,
    },
    {
      key: 'plan',
      label: 'Plan',
      means: 'a structured, workable approach',
      ask: 'How would you structure the work?',
      cue: /\b(first|then|plan|approach|collect|compare|model)\b/,
    },
    {
      key: 'judgement',
      label: 'Judgement',
      means: 'risks, limitations and trade-offs',
      ask: 'What could make your conclusion wrong?',
      cue: /\b(risk|limit|bias|trade-?off|confound|caveat|uncertain)/,
    },
    {
      key: 'communication',
      label: 'Communication',
      means: 'how they would share the result with the people who need it',
      ask: 'How would you present this to the client?',
      cue: /\b(present|explain|report|communicat|chart|stakeholder|client)/,
    },
  ],
  gap: [
    {
      key: 'honesty',
      label: 'Honesty',
      means: 'names the gap plainly, without overstating',
      ask: 'Which part of this is new to you?',
      cue: /\b(haven'?t|have not|not yet|new to|limited|gap|never)\b/,
    },
    {
      key: 'related',
      label: 'Related experience',
      means: 'related experience that will help',
      ask: 'What have you done that comes closest?',
      cue: /\b(closest|similar|related|used|studied|course)\b/,
    },
    {
      key: 'plan',
      label: 'Plan',
      means: 'a concrete way to build the skill',
      ask: 'How exactly would you build this skill?',
      cue: /\b(plan|course|practi[cs]e|learn|study|project)\b/,
    },
    {
      key: 'progress',
      label: 'Progress',
      means: 'how they would show or measure progress, and by when',
      ask: 'How would you show you had got there, and by when?',
      cue: /\b(weeks?|months?|review|show|measure|by the end|feedback)\b/,
    },
  ],
  closing: [
    {
      key: 'relevance',
      label: 'Relevance',
      means: 'about the role, team or work rather than logistics',
      ask: 'Is there anything about the work itself you would like to know?',
      cue: /\b(role|team|project|work|graduate|analyst)\b/,
    },
    {
      key: 'specificity',
      label: 'Specificity',
      means: 'specific to this employer or role',
      ask: 'Is there something specific to us you would like to ask?',
      cue: /\b(your|here|this (role|team|program|company))\b/,
    },
    {
      key: 'insight',
      label: 'Insight',
      means: 'shows they have thought about what the job involves',
      ask: 'What would you want to know before your first week?',
      cue: /\b(how|what does|look like|success|challenge)\b/,
    },
    {
      key: 'growth',
      label: 'Growth',
      means: 'about learning, feedback or progression',
      ask: 'Anything about how graduates learn here?',
      cue: /\b(feedback|learn|grow|develop|mentor|progress)\b/,
    },
  ],
};

export type Mark = 'critical' | 'hit' | 'partial' | 'miss';
type Evaluation = { marks?: Record<string, string>; star?: Record<string, string> };
/** Marks of a round: per-stage criteria, or STAR for rounds scored before CFS-179. */
export const marksOf = (e: Evaluation) => e.marks || e.star;
/** The criteria a round was scored on. */
export const criteriaOf = (stage: PlanStage, e: Evaluation) => (e.marks ? RUBRICS[stage] : STAR);

// Guessing a stage from position mislabelled older questions (a data-quality question shown as
// Motivation), so questions without a stage are general.
export const stageOf = (q: { stage?: string | null }, _index?: number): PlanStage =>
  interviewStages.includes(q.stage as InterviewStage) ? (q.stage as InterviewStage) : 'general';

export type PlanRound = {
  questionId: string;
  kind: 'answer' | 'follow_up';
  answer: string;
  prompt?: string;
  evaluation: { followUp: string; marks?: Record<string, string>; star?: Record<string, string> };
  at: string;
  unresolved?: string;
};

export type PlanStep = {
  questionId: string;
  stage: PlanStage;
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

// A stage left with a wanted follow-up is only partly covered if a criterion is still weak: the
// model nearly always finds one more thing to ask.
const weak = (marks?: Record<string, string>) =>
  !marks || Object.values(marks).some((m) => m === 'miss' || m === 'partial');

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
        : wants || (latest.unresolved && weak(marksOf(latest.evaluation)))
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
