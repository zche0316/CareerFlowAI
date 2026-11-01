import { randomUUID } from 'node:crypto';
import {
  experiences,
  hasOutcomeDetail,
  type InterviewState,
} from '../../../packages/contracts/src/profile-interview.js';
import { recordSchema } from '../../../packages/contracts/src/profile-records.js';
import { AppError } from './errors.js';

// A direct answer to an outcome question is source material, even if extraction returns no update.
// Return a proposal only; the caller never applies or approves the profile here.
export function proposeOutcomeAnswer(
  profile: any,
  state: InterviewState,
  text: string,
  threadId: string,
  messageId: string,
) {
  if (
    !state.question?.key.match(/:story:(?:result|measurement)$/) ||
    !state.active ||
    !hasOutcomeDetail(text) ||
    /[?？]/.test(text)
  )
    return null;
  const record = experiences(profile).find((r) => r.key === state.active);
  if (!record) return null;
  const field = record.key.startsWith('workExperiences:') ? 'workExperiences' : 'projects';
  const oldResult = record.starStory?.result || '';
  if (oldResult.includes(text)) return null;
  const result = [oldResult, text].filter(Boolean).join('\n');
  if (result.length > 2000)
    throw new AppError(
      422,
      'RESULT_TOO_LONG',
      'Your answer is saved. Please shorten the outcome to fit the profile; no details were silently removed.',
    );
  const updated = recordSchema.parse({
    ...record,
    starStory: { ...record.starStory, result },
    conversationEvidence: [
      ...(record.conversationEvidence || []),
      { quote: text, threadId, messageId },
    ],
  });
  return {
    id: randomUUID(),
    field,
    before: profile[field] || [],
    after: (profile[field] || []).map((r: any) => (r.id === record.id ? updated : r)),
    evidence: [{ quote: text, messageId, memoryRef: null, profileRef: null }],
    status: 'PENDING',
  };
}
