import { describe, expect, it } from 'vitest';
import { interviewPlan } from '../packages/contracts/src/interview-plan.js';

const qs = [
  { id: 'q1', stage: 'motivation' },
  { id: 'q2', stage: 'behavioural' },
  { id: 'q3' }, // older question without a stage: general
];
let t = 0;
const round = (questionId: string, kind: 'answer' | 'follow_up', followUp = '') => ({
  questionId,
  kind,
  answer: `${questionId} ${kind}`,
  evaluation: { followUp },
  at: `2026-11-16T00:00:${String(t++).padStart(2, '0')}Z`,
});

describe('interview stage plan', () => {
  it('probes a stage until its follow-up budget is spent, then moves on', () => {
    let plan = interviewPlan(qs, []);
    expect(plan.steps.map((s) => s.stage)).toEqual(['motivation', 'behavioural', 'general']);
    expect(plan.next?.questionId).toBe('q1');

    const rounds = [round('q2', 'answer', 'What did you do?')];
    plan = interviewPlan(qs, rounds);
    expect(plan.steps[1]).toMatchObject({ status: 'probing', used: 0, budget: 2 });
    expect(plan.steps[1].pendingFollowUp).toBe('What did you do?');

    rounds.push(round('q2', 'follow_up', 'And the result?'));
    expect(interviewPlan(qs, rounds).steps[1]).toMatchObject({ status: 'probing', used: 1 });
    rounds.push(round('q2', 'follow_up', 'Anything else?'));
    plan = interviewPlan(qs, rounds);
    expect(plan.steps[1]).toMatchObject({ status: 'partly', used: 2, pendingFollowUp: '' });
    expect(plan.steps[1].answers).toHaveLength(3);
  });

  it('is done when every stage is covered, partly covered or skipped', () => {
    const rounds = [round('q1', 'answer'), round('q2', 'answer', 'Why?')];
    let plan = interviewPlan(qs, rounds, ['q3']);
    expect(plan.steps.map((s) => s.status)).toEqual(['covered', 'probing', 'skipped']);
    expect(plan.done).toBe(false);
    plan = interviewPlan(qs, rounds, ['q2', 'q3']);
    expect(plan.steps[1].status).toBe('partly');
    expect(plan.done).toBe(true);
  });

  it('restarts a stage when its main question is answered again', () => {
    const rounds = [round('q1', 'answer', 'Why us?')];
    expect(interviewPlan(qs, rounds).steps[0].status).toBe('probing');
    expect(interviewPlan(qs, [round('q1', 'answer')]).steps[0].status).toBe('covered');
  });
});

describe('interview stage plan, budget spent', () => {
  it('records a stage as partly covered when the panel still wanted a follow-up', () => {
    const r = [
      { ...round('q1', 'answer', 'Why us?') },
      { ...round('q1', 'follow_up'), unresolved: 'And why this team?' },
    ];
    expect(interviewPlan(qs, r).steps[0]).toMatchObject({ status: 'partly', used: 1 });
    const strong = { situation: 'hit', task: 'hit', action: 'critical', result: 'hit' };
    r[1] = { ...r[1], evaluation: { followUp: '', star: strong } } as any;
    expect(interviewPlan(qs, r).steps[0].status).toBe('covered');
  });
});

it('finds required skills the resume does not evidence, for the gap question (CFS-180)', async () => {
  const { requirementGaps } = await import('../packages/contracts/src/interview-plan.js');
  const { missionContext } = await import('../packages/agents/src/mission-context.js');
  const item = (term: string, level: string, status: string) => ({ term, level, status });
  // The resume team's report wins over the job mapping; preferred and evidenced items are out.
  const d = {
    resumeTeam: {
      gaps: {
        requirements: [
          item('Stata', 'required', 'not_evidenced'),
          item('SQL', 'required', 'evidenced'),
          item('R', 'preferred', 'not_evidenced'),
          item('Stata', 'required', 'not_evidenced'),
        ],
      },
    },
    selectedJob: { mapping: { items: [item('Excel', 'required', 'not_evidenced')] } },
  };
  expect(requirementGaps(d)).toEqual(['Stata']);
  expect(requirementGaps({ selectedJob: d.selectedJob })).toEqual(['Excel']);
  expect(requirementGaps(undefined)).toEqual([]);
  const base = { goal: 'g', facts: [] } as any;
  expect(
    missionContext('questions', { ...base, requirementGaps: ['Stata'] }).requirementGaps,
  ).toEqual(['Stata']);
  expect(missionContext('questions', { ...base, requirementGaps: [] })).not.toHaveProperty(
    'requirementGaps',
  );
  // Only question planning receives them.
  expect(missionContext('feedback', { ...base, requirementGaps: ['Stata'] })).not.toHaveProperty(
    'requirementGaps',
  );
});
