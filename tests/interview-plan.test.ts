import { describe, expect, it } from 'vitest';
import { interviewPlan } from '../packages/contracts/src/interview-plan.js';

const qs = [
  { id: 'q1', stage: 'motivation' },
  { id: 'q2', stage: 'behavioural' },
  { id: 'q3' }, // legacy question: stage from its position
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
    expect(plan.steps.map((s) => s.stage)).toEqual(['motivation', 'behavioural', 'gap']);
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
