import { it, expect } from 'vitest';
import { sampleProfile as sample } from '../packages/contracts/src/index.js';
import { recordSchema } from '../packages/contracts/src/profile-records.js';
import {
  substantiveOverview,
  coverageFields,
  missingFields,
  interviewState,
  interviewIntent,
  planInterview,
  transitionInterview,
} from '../packages/contracts/src/profile-interview.js';
// The experience tests below start from a profile with every coverage field filled (CFS-151),
// so they see only the experience questions.
const sampleProfile = { ...sample, workArrangement: 'Hybrid' };

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
    details: ['I supported weekly delivery reporting with SQL and Excel.'],
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
  for (const text of ["that's all", 'That’s it.', "I'm done", 'nothing else', '就这些', '我说完了'])
    expect(interviewIntent(text)).toBe('finish_interview');
  expect(interviewIntent("that's all I did at Harbour Retail, I wrote SQL")).toBeNull();
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
        details: ['I checked customer records for duplicates in Excel.'],
      },
      {
        title: 'Retail Assistant',
        organisation: 'Example Company',
        startMonth: '2024-01',
        current: true,
        details: ['I handled customer returns and refunds at the front desk.'],
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
        details: ['I handled customer enquiries by phone and email.'],
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

it('asks for quantified impact after approval, accepts estimates or unmeasured outcomes, and honours skip', () => {
  const role = {
    title: 'Business Analyst Intern',
    organisation: 'Northstar Logistics',
    startMonth: '2025-11',
    endMonth: '2026-02',
    current: false,
    details: ['I supported weekly delivery reporting with SQL and Excel.'],
    starStory: {
      situation: 'Inconsistent categories.',
      task: 'Help standardise them.',
      action: 'I reviewed definitions.',
      result: 'My supervisor approved the definitions before the team used them.',
    },
  };
  const p = { ...sampleProfile, projects: [], workExperiences: [role] };
  const next = planInterview(p, interviewState([], p));
  expect(next.state.question?.key).toContain(':story:measurement');
  expect(next.state.question?.text).toContain('measured or estimated');
  expect(next.state.question?.text).toContain("team's result");
  for (const result of [
    'Preparing the report took about one hour instead of roughly half a day. It was a team estimate.',
    'We helped 12 people; no time saving was measured.',
    "I didn't measure the impact and don't know the time saved.",
  ]) {
    const updated = {
      ...p,
      workExperiences: [{ ...role, starStory: { ...role.starStory, result } }],
    };
    expect(planInterview(updated, next.state).state.question).toBeNull();
  }
  transitionInterview(next.state, 'skip_question', p);
  expect(planInterview(p, next.state).state.question).toBeNull();
});

// CFS-151: the interview keeps asking until every profile field is filled or skipped.
const story = {
  id: 'intern',
  title: 'Data analyst intern',
  organisation: 'Harbourline Logistics',
  startMonth: '2025-12',
  endMonth: '2026-02',
  current: false,
  details: ['I wrote SQL views for the weekly report.'],
  overview: 'I wrote SQL views for the weekly report.',
  technologies: ['SQL'],
  starStory: {
    situation: 's',
    task: 't',
    action: 'a',
    result: 'It took 15 minutes instead of 4 hours.',
  },
};
const empty = {
  name: 'Sam Rivera',
  goals: '',
  education: 'BSc Statistics',
  skills: [],
  location: '',
  workArrangement: '',
  employmentType: '',
};

it('asks an empty profile field again even after it was answered once', () => {
  const state = { ...interviewState([], empty), addressed: ['profile:goals'] };
  expect(planInterview(empty, state).state.question?.key).toBe('profile:goals');
});

it('asks matching preferences only after the first experience, then lists what is still empty', () => {
  const start = { ...empty, goals: 'Graduate data analyst' };
  expect(planInterview(start, interviewState([], start)).state.question?.key).toBe('inventory:0');
  const withStory = { ...start, workExperiences: [story] };
  const keys: string[] = [];
  let state = interviewState([], withStory);
  for (let i = 0; i < 6; i++) {
    const q = planInterview(withStory, state).state.question;
    if (!q) break;
    keys.push(q.key);
    state = { ...planInterview(withStory, state).state };
    transitionInterview(state, 'skip_question', withStory);
  }
  expect(keys).toEqual(coverageFields.filter((f) => f.after === 'experience').map((f) => f.key));
  expect(missingFields(withStory, state)).toEqual([]);
});

it('lists the empty fields on the first request to finish and finishes on the second', () => {
  const p = { ...empty, goals: 'Graduate data analyst', workExperiences: [story] };
  const state = planInterview(p, interviewState([], p)).state;
  transitionInterview(state, 'finish_interview', p);
  expect(state.phase).not.toBe('review');
  const plan = planInterview(p, state);
  expect(plan.hint).toContain('Skills, Preferred location, Work arrangement, Employment type');
  expect(plan.state.question?.key).toBe('profile:skills');
  transitionInterview(plan.state, 'finish_interview', p);
  expect(plan.state.phase).toBe('review');
  const full = {
    ...p,
    skills: ['SQL'],
    location: 'Sydney',
    workArrangement: 'Hybrid',
    employmentType: 'Full-time',
  };
  const done = planInterview(full, interviewState([], full)).state;
  transitionInterview(done, 'finish_interview', full);
  expect(done.phase).toBe('review');
});

it('does not ask whether a degree is ongoing when an expected completion month is known (CFS-154)', () => {
  const p = {
    ...empty,
    goals: 'Graduate data analyst',
    education: '',
    educations: [
      {
        id: 'bsc',
        title: 'Bachelor of Science in Statistics',
        organisation: 'University of Sydney',
        startMonth: '2023-03',
        endMonth: null,
        expectedEndMonth: '2026-11',
        current: false,
        details: [],
        technologies: [],
      },
    ],
  };
  const q = planInterview(p, interviewState([], p)).state.question;
  expect(q?.key).not.toMatch(/^education:/);
});

// CFS-155: the interview never ends a turn without a question, and says when the profile is complete.
it('asks for an experience again even after asking once, and offers review once nothing is empty', () => {
  const start = {
    ...empty,
    goals: 'Graduate data analyst',
    skills: ['SQL'],
    location: 'Sydney',
    workArrangement: 'Hybrid',
    employmentType: 'Full-time',
  };
  const state = { ...interviewState([], start), addressed: ['inventory:0'] };
  expect(planInterview(start, state).state.question?.key).toBe('inventory:0');
  const full = { ...start, workExperiences: [story] };
  const plan = planInterview(full, interviewState([], full));
  expect(plan.state.question).toBeNull();
  expect(plan.hint).toContain('Your profile now has everything it needs');
});

// CFS-158: an introduction is not an overview; the interview asks what the experience was about.
it('asks what an experience was about when its description only introduces it', () => {
  const intro = {
    id: 'bike',
    title: 'Sydney Bike Share Demand Dashboard',
    organisation: 'University of Sydney',
    startMonth: '2026-08',
    endMonth: '2026-10',
    current: false,
    details: [],
    technologies: [],
    overview:
      'I also participated an university project: Sydney Bike Share Demand Dashboard, a team project in my data visualisation unit, August to October 2026.',
  };
  expect(substantiveOverview(intro)).toBe(false);
  expect(
    substantiveOverview({
      ...intro,
      overview: 'Team of four. I owned the data pipeline and built the demand charts in Tableau.',
    }),
  ).toBe(true);
  expect(
    substantiveOverview({
      title: 'Booking website',
      organisation: "my sister's yoga studio",
      overview: "I built a booking website for my sister's yoga studio with React and Supabase.",
    }),
  ).toBe(true);
  // A story with a situation and an action already says what the experience was about.
  expect(
    substantiveOverview({
      ...intro,
      starStory: {
        situation: 'Riders saw empty docks.',
        task: '',
        action: 'I modelled demand.',
        result: '',
      },
    }),
  ).toBe(true);
  const p = { ...empty, goals: 'Graduate data analyst', projects: [intro] };
  const q = planInterview(p, interviewState([], p)).state.question;
  expect(q?.key).toMatch(/:overview$/);
  expect(q?.text).toContain('What was Sydney Bike Share Demand Dashboard about');
});
