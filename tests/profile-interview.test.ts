import { it, expect } from 'vitest';
import { sampleProfile } from '../packages/contracts/src/index.js';
import { recordSchema } from '../packages/contracts/src/profile-records.js';
import {
  interviewState,
  interviewIntent,
  planInterview,
  transitionInterview,
} from '../packages/contracts/src/profile-interview.js';
it('does not require optional majors or coursework before continuing the interview', () => {
  const p = {
    ...sampleProfile,
    education: '',
    educations: [
      recordSchema.parse({
        id: 'degree',
        title: 'Bachelor of Commerce',
        organisation: 'University of Sydney',
        startMonth: '2024-02',
        current: true,
      }),
    ],
  };
  const plan = planInterview(p, interviewState([], p));
  expect(plan.state.question?.text || '').not.toMatch(
    /major|coursework|subjects|education|degree/i,
  );
});
const profile = {
  ...sampleProfile,
  projects: [
    {
      id: 'alpha',
      title: 'Data Cleaning and Validation Project',
      organisation: 'Example University',
      startMonth: null,
      endMonth: null,
      current: false,
      details: ['I used Python and Pandas. The outcome is unknown.'],
    },
  ],
};
it('asks for an optional personal incident after a role overview instead of repeating duties or tools', () => {
  const p = {
    ...sampleProfile,
    projects: [],
    workExperiences: [
      {
        id: 'intern',
        title: 'Business Analyst Intern',
        organisation: 'Northstar Logistics',
        startMonth: '2025-11',
        endMonth: '2026-02',
        current: false,
        details: ['I supported reporting using SQL and Excel; I did not manage the team.'],
        technologies: [],
      },
    ],
  };
  const first = planInterview(p, interviewState([], p));
  expect(first.state.question?.key).toContain(':story:situation');
  expect(first.state.question?.text).toContain('optional');
  transitionInterview(first.state, 'skip_question', p);
  expect(planInterview(p, first.state).state.question).toBeNull();
  const withStory = {
    ...p,
    workExperiences: [
      {
        ...p.workExperiences[0],
        starStory: {
          situation: 'Warehouses used inconsistent labels.',
          task: 'I needed to standardise the categories.',
          action: 'I reviewed definitions with my supervisor.',
          result: 'Preparation took about one hour rather than half a day.',
        },
      },
    ],
  };
  expect(planInterview(withStory, interviewState([], withStory)).state.question).toBeNull();
  const missingResult = {
    ...p,
    workExperiences: [
      {
        ...withStory.workExperiences[0],
        starStory: { ...withStory.workExperiences[0].starStory, result: '' },
      },
    ],
  };
  expect(
    planInterview(missingResult, interviewState([], missingResult)).state.question?.key,
  ).toContain(':story:result');
});
it('treats enough as a durable control and excludes finished experiences from subsequent questions', () => {
  expect(interviewIntent('I think the content is enough now for this project')).toBe(
    'finish_experience',
  );
  const plan = planInterview(profile, interviewState([], profile));
  expect(plan.state.question?.key).toContain(':start');
  transitionInterview(plan.state, 'finish_experience', profile);
  const next = planInterview(profile, plan.state);
  expect(next.state.closed).toHaveLength(1);
  expect(next.state.question?.text).not.toContain('Data Cleaning');
  const restored = interviewState([{ role: 'assistant', interviewState: next.state }], profile);
  expect(planInterview(profile, restored)).toEqual(next);
});
it('skips a date slot without requiring a date and needs explicit reopen to revisit a finished experience', () => {
  const plan = planInterview(profile, interviewState([], profile));
  transitionInterview(plan.state, 'skip_question', profile);
  const next = planInterview(profile, plan.state);
  expect(next.state.question?.key).toContain(':end');
  transitionInterview(next.state, 'finish_experience', profile);
  const closed = planInterview(profile, next.state);
  transitionInterview(closed.state, 'finish_interview', profile);
  expect(planInterview(profile, closed.state).state.question).toBeNull();
  transitionInterview(closed.state, 'resume', profile, next.state.closed[0]);
  expect(planInterview(profile, closed.state).state.active).toBe(next.state.closed[0]);
});
it('recognises stop requests in existing histories without rewriting old messages', () => {
  const messages = [
    {
      role: 'assistant',
      questions: [
        'What were the start and end dates for the Data Cleaning and Validation Project?',
      ],
    },
    { role: 'user', text: 'I think the content is enough now for this project' },
    { role: 'assistant', questions: ['When did Data Cleaning and Validation Project start?'] },
  ];
  const state = interviewState(messages, profile);
  expect(state.closed).toHaveLength(1);
  expect(planInterview(profile, state).state.question?.text).not.toContain('Data Cleaning');
  expect(messages[2].questions).toHaveLength(1);
});

it('does not interpret not enough as finish and can honour a legacy stop before records were applied', () => {
  expect(interviewIntent('I think the content is not enough now for this project')).toBeNull();
  const old = [
    {
      role: 'assistant',
      questions: ['What were the start and end dates for the Data Cleaning Project?'],
    },
    { role: 'user', text: 'I think the content is enough now for this project' },
  ];
  const empty = { ...sampleProfile, projects: [] };
  const saved = interviewState(old, empty);
  expect(saved.closed).toHaveLength(1);
  const later = {
    ...empty,
    projects: [{ title: 'Data Cleaning Project', organisation: 'Example University', details: [] }],
  };
  expect(planInterview(later, saved).state.active).toBeNull();
});

it('uses the most recent project topic across a failed message instead of closing an unrelated sample project', () => {
  const form = {
    ...sampleProfile,
    projects: [{ title: 'Student Dashboard', organisation: 'Example University', details: [] }],
  };
  const old = [
    {
      role: 'assistant',
      questions: [
        'Where was the Data Cleaning and Validation Project physically carried out or was it remote?',
      ],
    },
    { role: 'user', text: 'Skip this question' },
    { role: 'assistant', failed: true, questions: [] },
    { role: 'user', text: 'I think the content is enough now for this project' },
  ];
  const state = interviewState(old, form);
  expect(state.closed.join(' ')).toContain('data cleaning and validation project');
  expect(state.closed.join(' ')).not.toContain('student dashboard');
});

it('offers a new experience rather than automatically reopening an unrelated existing example', () => {
  const p = {
    ...profile,
    projects: [
      { ...profile.projects[0], id: 'old', title: 'Student Dashboard' },
      profile.projects[0],
    ],
  };
  const current = planInterview(p, interviewState([], p));
  transitionInterview(current.state, 'next_experience', p);
  const next = planInterview(p, current.state);
  expect(next.state.active).toBeNull();
  expect(next.state.question?.text).toContain('different experience');
  const withNew = {
    ...p,
    projects: [...p.projects, { ...profile.projects[0], id: 'new', title: 'Beta Project' }],
  };
  expect(planInterview(withNew, next.state).state.question?.text).toContain('Beta Project');
});
