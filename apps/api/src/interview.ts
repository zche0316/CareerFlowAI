export type InterviewQuestion = {
  id: string;
  question: string;
  focus: string;
};

export type InterviewAnswer = {
  questionId: string;
  answer: string;
};

export type InterviewCompletion = {
  answeredCount: number;
  questionCount: number;
  endedEarly: boolean;
};

// Keep saved answers aligned with the current question order and replace edits in place.
export function mergeInterviewAnswer(
  questions: InterviewQuestion[],
  answers: InterviewAnswer[],
  answer: InterviewAnswer,
): InterviewAnswer[] {
  const byQuestion = new Map(answers.map((saved) => [saved.questionId, saved]));
  byQuestion.set(answer.questionId, answer);
  return questions.flatMap((question) => {
    const saved = byQuestion.get(question.id);
    return saved ? [{ questionId: question.id, answer: saved.answer }] : [];
  });
}

// Completion is derived from persisted answers so clients cannot mislabel a partial interview.
export function getInterviewCompletion(
  questions: InterviewQuestion[],
  answers: InterviewAnswer[],
): InterviewCompletion {
  const questionIds = new Set(questions.map((question) => question.id));
  const answeredIds = new Set(
    answers
      .filter((answer) => questionIds.has(answer.questionId))
      .map((answer) => answer.questionId),
  );
  return {
    answeredCount: answeredIds.size,
    questionCount: questions.length,
    endedEarly: answeredIds.size < questions.length,
  };
}
