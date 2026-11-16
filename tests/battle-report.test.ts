import { expect, it } from 'vitest';
import { battleReport, gradeOf } from '../packages/contracts/src/battle-report.js';

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
  expect(b.star).toEqual(star('hit', 'hit', 'critical', 'miss'));
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
