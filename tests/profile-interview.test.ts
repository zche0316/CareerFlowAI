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

it('recognises the exact finish instruction shown by the UI without interpreting negation as consent', () => {
  for (const text of ['finish this experience', 'Finish this experience.', 'finish this project'])
    expect(interviewIntent(text)).toBe('finish_experience');
  expect(interviewIntent('I am not finished with this experience')).toBeNull();
  expect(interviewIntent('Before I finish this experience, I want to add a result.')).toBeNull();
});

it('switches to a uniquely named new role and asks STAR without closing or losing the previous story', () => {
  const role = {
    title: 'Business Analyst Intern',
    organisation: 'Northstar Logistics',
    startMonth: '2025-11',
    endMonth: '2026-02',
    current: false,
    details: ['I supported reporting.'],
    starStory: {
      situation: 'Different labels.',
      task: 'Standardise labels.',
      action: 'Reviewed definitions.',
      result: 'About one hour.',
    },
  };
  const before = { ...sampleProfile, projects: [], workExperiences: [role] };
  const previous = planInterview(before, interviewState([], before));
  const nextRole = {
    ...role,
    title: 'Customer Operations Assistant',
    organisation: 'Harbour Retail',
    starStory: undefined,
  };
  const after = { ...before, workExperiences: [role, nextRole] };
  const next = planInterview(
    after,
    previous.state,
    'I also worked as a Customer Operations Assistant at Harbour Retail.',
  );
  expect(next.state.active).toContain('customer operations assistant');
  expect(next.state.question?.key).toContain(':story:situation');
  expect(next.state.question?.text).toContain('optional');
  expect(next.state.closed).toEqual([]);
  expect(before.workExperiences[0].starStory).toEqual(role.starStory);
  expect(previous.state.active).toContain('business analyst intern');
  transitionInterview(previous.state, interviewIntent('finish this experience')!, before);
  const closed = planInterview(before, previous.state);
  expect(closed.state.closed).toHaveLength(1);
  expect(planInterview(after, closed.state, 'Harbour Retail').state.question?.key).toContain(
    ':story:situation',
  );
  expect(planInterview(after, closed.state, 'Northstar Logistics').state.active).not.toContain(
    'business analyst intern',
  );
});

it('recognises explicit next/end choices while retaining narratives containing those words', () => {
  expect(interviewIntent('add another experience')).toBe('next_experience');
  expect(interviewIntent('end conversation')).toBe('finish_interview');
  expect(interviewIntent('End conversation & review')).toBe('finish_interview');
  expect(interviewIntent('Add another experience: I worked at Harbour Retail.')).toBeNull();
  expect(interviewIntent('End interview after I explain my result.')).toBeNull();
  expect(interviewIntent("Don't end conversation")).toBeNull();
});

it('repeated next choices do not close unrelated records and review cannot silently restart', () => {
  const p = {
    ...profile,
    projects: [profile.projects[0], { ...profile.projects[0], title: 'Beta Project' }],
  };
  const initial = planInterview(p, interviewState([], p));
  transitionInterview(initial.state, 'next_experience', p);
  const inventory = planInterview(p, initial.state);
  expect(inventory.state.closed).toHaveLength(1);
  transitionInterview(inventory.state, 'next_experience', p);
  expect(inventory.state.closed).toHaveLength(1);
  transitionInterview(inventory.state, 'finish_interview', p);
  const review = structuredClone(inventory.state);
  for (const action of ['next_experience', 'finish_experience', 'skip_question'] as const) {
    transitionInterview(inventory.state, action, p);
    expect(inventory.state).toEqual(review);
  }
  transitionInterview(inventory.state, 'resume', p);
  expect(inventory.state.phase).toBe('collecting');
});

it('uses a unique role title when two experiences share one employer', () => {
  const p = {
    ...sampleProfile,
    projects: [],
    workExperiences: [
      {
        title: 'Analyst Intern',
        organisation: 'Example Company',
        startMonth: '2025-01',
        current: true,
        details: ['I checked records.'],
      },
      {
        title: 'Retail Assistant',
        organisation: 'Example Company',
        startMonth: '2024-01',
        current: true,
        details: ['I handled returns.'],
      },
    ],
  };
  const first = planInterview(p, interviewState([], p));
  const next = planInterview(p, first.state, 'Analyst Intern at Example Company');
  expect(next.state.active).toContain('analyst intern');
  expect(planInterview(p, first.state, 'Example Company').state.active).toBe(first.state.active);
  expect(interviewIntent("I haven't finished this experience")).toBeNull();
});

it('does not treat an unrelated reply or old addressed flag as a completed STAR part', () => {
  const p = {
    ...sampleProfile,
    projects: [],
    workExperiences: [
      {
        title: 'Retail Assistant',
        organisation: 'Harbour Retail',
        startMonth: '2024-07',
        endMonth: '2025-10',
        details: ['I handled enquiries.'],
        starStory: {
          situation: 'Colleagues asked repeated questions.',
          task: 'Help new staff.',
          action: '',
          result: '',
        },
      },
    ],
  };
  const initial = planInterview(p, interviewState([], p));
  expect(initial.state.question?.key).toContain(':story:action');
  initial.state.addressed.push(initial.state.question!.key);
  expect(planInterview(p, initial.state).state.question?.key).toContain(':story:action');
  const withAction = {
    ...p,
    workExperiences: [
      {
        ...p.workExperiences[0],
        starStory: { ...p.workExperiences[0].starStory, action: 'I wrote guidance.' },
      },
    ],
  };
  expect(planInterview(withAction, initial.state).state.question?.key).toContain(':story:result');
  transitionInterview(initial.state, 'skip_question', p);
  expect(planInterview(p, initial.state).state.question?.key).toContain(':story:result');
});
