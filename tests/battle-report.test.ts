import { expect, it } from 'vitest';
import { battleReport, gradeOf } from '../packages/contracts/src/battle-report.js';
import { RUBRICS } from '../packages/contracts/src/interview-plan.js';
import { fixtureEvaluation } from '../packages/agents/src/provider.js';
import { evaluationSchemaFor } from '../packages/contracts/src/index.js';

const star = (situation: string, task: string, action: string, result: string) => ({
  situation,
  task,
  action,
  result,
});

it('grades a stage at the best STAR mark of each part across its answer and follow-ups', () => {
  const questions = [
    { id: 'm', question: 'Why this role?', stage: 'motivation' },
    { id: 'b', question: 'Tell us about a problem you fixed.', stage: 'behavioural' },
    { id: 't', question: 'How would you clean this data?', stage: 'technical' },
  ];
  const rounds: any[] = [
    {
      questionId: 'b',
      kind: 'answer',
      answer: 'We fixed a dashboard.',
      at: '1',
      evaluation: {
        star: star('hit', 'partial', 'miss', 'miss'),
        note: 'Say what you did.',
        followUp: 'What did you do?',
      },
    },
    {
      questionId: 'b',
      kind: 'follow_up',
      prompt: 'What did you do?',
      answer: 'I wrote the de-duplication step.',
      at: '2',
      evaluation: {
        star: star('partial', 'hit', 'critical', 'miss'),
        note: 'Add the result.',
        followUp: '',
      },
      unresolved: 'What changed afterwards?',
    },
    {
      questionId: 'm',
      kind: 'answer',
      answer: 'I like analysis.',
      at: '3',
      evaluation: {
        star: star('critical', 'critical', 'critical', 'critical'),
        note: 'Clear.',
        followUp: '',
      },
    },
  ];
  const report = battleReport(questions, rounds);
  const [m, b, t] = report.stages;
  // Behavioural: situation hit (2), task hit (2), action critical (3), result miss (0) = 7 of 12.
  expect(b.marks).toEqual(star('hit', 'hit', 'critical', 'miss'));
  expect(b.criteria.map((c) => c.label)).toEqual(['Situation', 'Task', 'Action', 'Result']);
  expect(b.score).toBeCloseTo(7 / 12);
  expect(b.grade).toBe('B');
  expect(b.rounds.map((r) => r.kind)).toEqual(['answer', 'follow_up']);
  expect(b.stillWanted).toBe('What changed afterwards?');
  expect(m.grade).toBe('S');
  expect(m.stillWanted).toBe('');
  // Unanswered stages have no grade and count as zero overall.
  expect(t.grade).toBeNull();
  expect(report.answered).toBe(2);
  expect(report.score).toBeCloseTo((1 + 7 / 12) / 3);
  expect(report.grade).toBe('C');
});

it('maps scores to letter grades at the documented thresholds', () => {
  expect([0.9, 0.89, 0.75, 0.55, 0.35, 0.34].map(gradeOf)).toEqual(['S', 'A', 'A', 'B', 'C', 'D']);
});

it('judges each stage on its own criteria; old STAR rounds keep STAR (CFS-179)', () => {
  const questions = [{ id: 'm', question: 'Why this role?', stage: 'motivation' }];
  const motivation = (marks: Record<string, string>) => ({
    questionId: 'm',
    kind: 'answer',
    answer: 'x',
    at: '1',
    evaluation: { marks, note: 'n', followUp: '' },
  });
  const report = battleReport(questions, [
    motivation({
      role: 'hit',
      employer: 'partial',
      evidence: 'critical',
      direction: 'miss',
    }) as any,
  ]);
  expect(report.stages[0].criteria.map((c) => c.key)).toEqual([
    'role',
    'employer',
    'evidence',
    'direction',
  ]);
  expect(report.stages[0].score).toBeCloseTo(6 / 12);
  // A motivation answer scored on STAR before stage criteria existed still shows STAR.
  const old = battleReport(questions, [
    {
      questionId: 'm',
      kind: 'answer',
      answer: 'x',
      at: '1',
      evaluation: { star: star('hit', 'hit', 'hit', 'hit'), followUp: '' },
    } as any,
  ]);
  expect(old.stages[0].criteria.map((c) => c.key)).toEqual([
    'situation',
    'task',
    'action',
    'result',
  ]);
});

it('builds the evaluation schema and demo marks from the stage criteria', () => {
  const schema = evaluationSchemaFor('technical');
  const ok = schema.safeParse({
    marks: { approach: 'hit', specifics: 'hit', checks: 'miss', experience: 'partial' },
    note: 'Add how you would check it.',
    followUp: 'How would you check it?',
  });
  expect(ok.success).toBe(true);
  expect(schema.safeParse({ marks: { situation: 'hit' }, note: 'n', followUp: '' }).success).toBe(
    false,
  );
  const demo = fixtureEvaluation(
    'First I would profile the data in SQL, then validate the totals.',
    false,
    RUBRICS.technical,
  );
  expect(demo.marks).toEqual({
    approach: 'hit',
    specifics: 'hit',
    checks: 'hit',
    experience: 'miss',
  });
  expect(demo.followUp).toBe('Where have you done this yourself?');
  // STAR keeps its stricter rule for a critical action.
  expect(
    fixtureEvaluation('I built 3 SQL reports at my internship, which reduced exports.', true).marks
      .action,
  ).toBe('critical');
});
