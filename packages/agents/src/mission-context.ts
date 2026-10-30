import type { Fact } from '../../contracts/src/index.js';
import type { ProviderContext } from './provider.js';

// Audit quotations stay in the database. Preserve every approved fact and its ID;
// the model only needs the claim and record relationship to cite it correctly.
export function missionContext(role: string, input: ProviderContext): ProviderContext {
  const facts = (role === 'feedback' ? [] : input.facts).map(({ id, kind, text }) => ({
    id,
    kind,
    text,
  })) as Fact[];
  const base: ProviderContext = { goal: input.goal, facts };
  const job = input.job
    ? { title: input.job.title, description: input.job.description }
    : undefined;
  if (role === 'coach')
    return {
      ...base,
      ...(input.analysisFeedback ? { analysisFeedback: input.analysisFeedback } : {}),
    };
  if (role === 'resume')
    return {
      ...base,
      job,
      ...(input.profileBase ? { profileBase: input.profileBase } : {}),
      ...(input.feedback ? { feedback: input.feedback } : {}),
    };
  if (role === 'questions')
    return {
      ...base,
      job,
      ...(input.priorFeedback ? { priorFeedback: input.priorFeedback } : {}),
    };
  if (role === 'feedback')
    return { ...base, job, questions: input.questions, answers: input.answers };
  return base;
}
