import { it, expect } from 'vitest';
import { sampleProfile } from '../packages/contracts/src/index.js';
import { planInterview, interviewState } from '../packages/contracts/src/profile-interview.js';
import { proposeOutcomeAnswer, proposeStoryAnswer } from '../apps/api/src/profile-outcomes.js';

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
      details: ['I supported weekly delivery reporting with SQL and Excel.'],
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

it('retains the current outcome citation when the existing record already has ten citations', () => {
  const full = {
    ...form,
    workExperiences: [
      {
        ...form.workExperiences[0],
        conversationEvidence: Array.from({ length: 10 }, () => ({
          threadId: '00000000-0000-4000-8000-000000000001',
          messageId: '00000000-0000-4000-8000-000000000002',
          quote: 'I supported reporting.',
        })),
      },
    ],
  };
  const state = planInterview(full, interviewState([], full)).state;
  const proposal = proposeOutcomeAnswer(
    full,
    state,
    'About one hour, a team estimate.',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003',
  )!;
  expect(proposal.after[0].conversationEvidence).toHaveLength(10);
  expect(proposal.after[0].conversationEvidence.at(-1).quote).toBe(
    'About one hour, a team estimate.',
  );
});

// CFS-152: an answer to the situation, task or action question is kept word for word on the
// experience being discussed, even when extraction files it elsewhere.
it('saves a direct STAR answer verbatim on the active experience and leads with its situation', () => {
  const role = {
    ...form.workExperiences[0],
    starStory: {
      situation: 'The weekly report was built by hand in Excel.',
      task: 'Automate it.',
      action: '',
      result: '',
    },
  };
  const p = { ...form, workExperiences: [role] };
  const state = planInterview(p, interviewState([], p)).state;
  expect(state.question?.key).toContain(':story:action');
  expect(state.question?.text).toContain(
    'that situation (“The weekly report was built by hand in Excel.”)',
  );
  const text = 'I wrote one SQL view and a pandas script, then checked it against four past weeks.';
  const [thread, message] = [crypto.randomUUID(), crypto.randomUUID()];
  const proposal = proposeStoryAnswer(p, state, text, thread, message);
  expect(proposal?.field).toBe('workExperiences');
  expect(proposal?.after[0].starStory).toMatchObject({
    situation: role.starStory.situation,
    task: 'Automate it.',
    action: text,
  });
  expect(proposal?.after[0].conversationEvidence?.at(-1)).toMatchObject({
    quote: text,
    messageId: message,
  });
  expect(proposeStoryAnswer(p, state, 'What do you mean by action?', 't', 'm')).toBeNull();
  expect(proposeStoryAnswer(p, { ...state, question: null }, text, 't', 'm')).toBeNull();
  const situationFirst = planInterview(
    {
      ...p,
      workExperiences: [{ ...role, starStory: undefined, overview: 'I maintained the weekly delivery reports in Excel and SQL.' }],
    },
    interviewState([], p),
  ).state.question;
  expect(situationFirst?.text).toMatch(/^Pick one specific situation from Business Analyst Intern/);
});

it('keeps the extraction split when the model already filled the asked part this turn', () => {
  const role = {
    ...form.workExperiences[0],
    starStory: { situation: 'Labels differed.', task: '', action: '', result: '' },
  };
  const before = { ...form, workExperiences: [role] };
  const state = planInterview(before, interviewState([], before)).state;
  expect(state.question?.key).toContain(':story:task');
  const split = {
    ...role,
    starStory: { ...role.starStory, task: 'Standardise categories.', action: 'Compared labels.' },
  };
  const after = { ...form, workExperiences: [split] };
  const text = 'I had to standardise categories, so I compared labels.';
  expect(
    proposeStoryAnswer(after, state, text, crypto.randomUUID(), crypto.randomUUID(), before),
  ).toBeNull();
  expect(
    proposeStoryAnswer(before, state, text, crypto.randomUUID(), crypto.randomUUID(), before)
      ?.after[0].starStory.task,
  ).toBe(text);
});
