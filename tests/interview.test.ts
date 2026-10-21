import { describe, expect, it } from 'vitest';
import { feedbackSchema, questionsSchema } from '../packages/contracts/src/index.js';
import { getInterviewCompletion, mergeInterviewAnswer } from '../apps/api/src/interview.js';

const questions = [
  { id: 'q1', question: 'Which evidence supports your interest?', focus: 'Motivation' },
  { id: 'q2', question: 'Describe a relevant example.', focus: 'Evidence' },
  { id: 'q3', question: 'Which role requirement is a growth area?', focus: 'Reflection' },
];

describe('Interview Coach completion rules', () => {
  it('replaces edited answers without changing question order', () => {
    const answers = mergeInterviewAnswer(
      questions,
      [
        { questionId: 'q1', answer: 'First answer' },
        { questionId: 'q2', answer: 'Old second answer' },
      ],
      { questionId: 'q2', answer: 'Updated second answer' },
    );

    expect(answers).toEqual([
      { questionId: 'q1', answer: 'First answer' },
      { questionId: 'q2', answer: 'Updated second answer' },
    ]);
  });

  it('derives early completion from persisted answers', () => {
    expect(
      getInterviewCompletion(questions, [{ questionId: 'q2', answer: 'Saved response' }]),
    ).toEqual({ answeredCount: 1, questionCount: 3, endedEarly: true });
    expect(
      getInterviewCompletion(
        questions,
        questions.map((question) => ({
          questionId: question.id,
          answer: `Answer for ${question.id}`,
        })),
      ),
    ).toEqual({ answeredCount: 3, questionCount: 3, endedEarly: false });
  });

  it('rejects malformed questions, duplicate IDs, more than three questions and empty feedback', () => {
    expect(() =>
      questionsSchema.parse({
        questions: [{ id: 'q1', question: 'Short', focus: 'Focus' }],
      }),
    ).toThrow();
    expect(() =>
      questionsSchema.parse({
        questions: [
          { id: 'q1', question: 'A sufficiently detailed question one?', focus: 'Focus' },
          { id: 'q1', question: 'A sufficiently detailed question two?', focus: 'Focus' },
        ],
      }),
    ).toThrow(/unique/i);
    expect(() =>
      questionsSchema.parse({
        questions: Array.from({ length: 4 }, (_, index) => ({
          id: `q${index + 1}`,
          question: `A sufficiently detailed interview question ${index + 1}?`,
          focus: 'Role evidence',
        })),
      }),
    ).toThrow();
    expect(() =>
      feedbackSchema.parse({ strengths: [], improvements: ['Improve'], nextSteps: ['Practise'] }),
    ).toThrow();
  });
});
