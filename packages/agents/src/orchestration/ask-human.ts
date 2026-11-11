import { interrupt } from '@langchain/langgraph';

// SCAFFOLD (plan milestone M4). An agent-initiated pause: a specialist asks the user a question
// when information is missing or its confidence is low, instead of guessing.
// To wire it: queue.ts maps kind 'clarification' to an AWAITING_CLARIFICATION status,
// decisionSchema accepts { kind: 'clarification', answer }, and the UI shows the question.
export type ClarificationRequest = {
  kind: 'clarification';
  agent: string;
  question: string;
  why: string;
  options?: string[];
};

export const shouldAskHuman = (confidence: number, threshold = 0.6) => confidence < threshold;

// Call inside a graph node. Like every interrupt, the node replays from the top on resume,
// so keep side effects after this call.
export function askHuman(request: Omit<ClarificationRequest, 'kind'>): string {
  const answer = interrupt({ kind: 'clarification', ...request }) as {
    kind?: string;
    answer?: string;
  };
  if (answer?.kind !== 'clarification' || !answer.answer?.trim())
    throw Error('A clarification answer is required.');
  // Answers are user statements for this mission, not approved profile facts.
  return answer.answer.trim().slice(0, 2000);
}
