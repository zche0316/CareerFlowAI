import { it, expect } from 'vitest';
import { sampleProfile } from '../packages/contracts/src/index.js';
import { planInterview, interviewState } from '../packages/contracts/src/profile-interview.js';
import { proposeOutcomeAnswer } from '../apps/api/src/profile-outcomes.js';

const form = {
  ...sampleProfile,
  projects: [],
  workExperiences: [
    {
      id: 'qa-intern',
      title: 'Business Analyst Intern',
      organisation: 'Northstar Logistics',
      startMonth: '2025-11',
      endMonth: '2026-02',
      current: false,
      details: ['I supported reporting.'],
      starStory: {
        situation: 'Inconsistent categories.',
        task: 'Help standardise them.',
        action: 'I checked labels.',
        result: 'My supervisor approved the definitions.',
      },
    },
  ],
};
it('creates a pending, source-backed outcome edit with the complete estimate and scope qualifiers', () => {
  const state = planInterview(form, interviewState([], form)).state;
  const text =
    "Preparing the report took about one hour instead of roughly half a day. It was a team estimate, not formally measured. I didn't measure delivery speed.";
  const proposal = proposeOutcomeAnswer(
    form,
    state,
    text,
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  )!;
  expect(proposal.status).toBe('PENDING');
  expect(proposal.after[0].starStory.result).toContain(text);
  expect(proposal.after[0].starStory.result).toContain('My supervisor approved');
  expect(proposal.after[0].conversationEvidence.at(-1)).toEqual({
    quote: text,
    threadId: '00000000-0000-4000-8000-000000000001',
    messageId: '00000000-0000-4000-8000-000000000002',
  });
  expect(form.workExperiences[0].starStory.result).toBe('My supervisor approved the definitions.');
  expect(
    proposeOutcomeAnswer(
      { ...form, workExperiences: proposal.after },
      state,
      text,
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ),
  ).toBeNull();
});
it('does not attach a question, unrelated message or answer with no active outcome slot', () => {
  const state = planInterview(form, interviewState([], form)).state;
  expect(proposeOutcomeAnswer(form, state, 'Should I say one hour?', 't', 'm')).toBeNull();
  expect(
    proposeOutcomeAnswer(form, { ...state, question: null }, 'About one hour.', 't', 'm'),
  ).toBeNull();
});
