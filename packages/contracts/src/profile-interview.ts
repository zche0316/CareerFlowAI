import { careerTitle } from './conversation-source.js';
import { experienceOverview } from './experience-view.js';
export type InterviewAction =
  | 'finish_experience'
  | 'next_experience'
  | 'finish_interview'
  | 'skip_question'
  | 'resume'
  | 'keep_current_draft';
export type InterviewState = {
  phase: 'collecting' | 'inventory' | 'review';
  active: string | null;
  closed: string[];
  addressed: string[];
  skipped?: string[];
  /** Questions set aside after repeated non-answers or frustration (CFS-144); also in skipped. */
  parked?: string[];
  outcomeReviewed?: string[];
  /** Set once the user was shown the empty fields before finishing (CFS-151). */
  closingChecked?: boolean;
  inventoryBaseline?: string[];
  question: { key: string; text: string } | null;
};
export const experiences = (p: any) =>
  ['workExperiences', 'projects'].flatMap((section) =>
    (p[section] || []).map((r: any) => ({
      ...r,
      key: `${section}:${careerTitle(r.title)}:${(r.organisation || '').toLowerCase()}`,
    })),
  );
export function interviewIntent(text: string): InterviewAction | null {
  const s = text.trim();
  if (
    s.length > 200 ||
    /\b(?:not|haven['’]t) (?:yet )?(?:enough|sufficient|done|finished)\b|don't think|还不够|没说完/i.test(
      s,
    )
  )
    return null;
  if (
    /^(?:(?:please )?(?:finish|end|stop) (?:the |this )?(?:interview|profile|conversation)(?: & review)?|(?:结束|完成)(?:整个)?(?:访谈|问答|对话)|(?:no|don't have any) (?:more|other) experiences?|that['’]?s (?:all|it)|i['’]?m (?:all )?done|nothing (?:else|more)|就这些|我说完了|没有了)[.!。！]?$/i.test(
      s,
    )
  )
    return 'finish_interview';
  if (
    /^(?:I (?:already )?answered this[,!. ]*)?(?:skip|pass)(?: this)?(?: question)?[.!]?$|^(?:跳过|先跳过|这题跳过)[。！]?$/i.test(
      s,
    )
  )
    return 'skip_question';
  if (
    /^(?:(?:please )?(?:next|another|add another)(?: work)? (?:experience|project)|(?:下一个|下一段|再加一个)(?:经历|项目))[.!。！]?$/i.test(
      s,
    )
  )
    return 'next_experience';
  if (/^(?:please )?(?:finish|end|stop) (?:this|the) (?:experience|project)[.!]?$/i.test(s))
    return 'finish_experience';
  if (
    /(?:content|information|details).*(?:enough|sufficient).*(?:project|experience)|(?:done|finished) (?:with )?(?:this|the) (?:project|experience)|(?:that's|that is) enough|(?:这个|这段)(?:项目|经历).*(?:够了|结束|说完)|先结束(?:这段|这个)?(?:经历|项目)/i.test(
      s,
    )
  )
    return 'finish_experience';
  return null;
}
export function interviewState(messages: any[], p: any): InterviewState {
  const saved = [...messages].reverse().find((m) => m.interviewState)?.interviewState;
  if (saved) {
    const state = structuredClone(saved);
    // Older versions conflated an arbitrary reply with an answered STAR field.
    // Recover intentional skips from actual control messages, without rewriting history.
    const skipped = new Set<string>(state.skipped || []);
    let question: string | undefined;
    for (const message of messages) {
      if (message.role === 'assistant' && message.interviewState)
        question = message.interviewState.question?.key;
      if (
        message.role === 'user' &&
        interviewIntent(message.text || '') === 'skip_question' &&
        question
      )
        skipped.add(question);
    }
    if (skipped.size) state.skipped = [...skipped];
    state.addressed = state.addressed.filter(
      (key: string) => !key.includes(':story:') || skipped.has(key),
    );
    return state;
  }
  const state: InterviewState = {
    phase: 'collecting',
    active: null,
    closed: [],
    addressed: [],
    question: null,
  };
  const records = experiences(p);
  // Migrate old histories without rewriting them: answered date questions and
  // explicit stop requests must also count after the feature is deployed.
  let previous: string[] = [];
  let lastNamedProject: string | undefined;
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.questions?.length && !m.failed) {
        previous = m.questions;
        lastNamedProject =
          previous
            .map((q) => /(?:for|to|in|was|about|of|did|on) (?:the )?(.+?project)\b/i.exec(q)?.[1])
            .find(Boolean) || lastNamedProject;
      }
      continue;
    }
    if (m.role !== 'user') continue;
    const referenced = records.filter((r) =>
      previous.some((q) => q.toLowerCase().includes(careerTitle(r.title))),
    );
    for (const r of referenced) {
      state.active = r.key;
      if (previous.some((q) => /start/i.test(q))) state.addressed.push(`${r.key}:start`);
      if (previous.some((q) => /end|ongoing/i.test(q))) state.addressed.push(`${r.key}:end`);
      if (previous.some((q) => /contribut|responsib|action/i.test(q)))
        state.addressed.push(`${r.key}:action`);
      if (previous.some((q) => /outcome|result/i.test(q))) state.addressed.push(`${r.key}:outcome`);
    }
    const action = interviewIntent(m.text || '');
    if (action && lastNamedProject && ['finish_experience', 'next_experience'].includes(action)) {
      state.active =
        records.find((r) => careerTitle(r.title) === careerTitle(lastNamedProject!))?.key ||
        `projects:${careerTitle(lastNamedProject)}:`;
    }
    if (action) transitionInterview(state, action, p);
  }
  state.addressed = [...new Set(state.addressed)];
  return state;
}
export const closedExperience = (closed: string[], key: string) =>
  closed.some((k) => {
    const [kind, title, org] = k.split(':');
    const [targetKind, targetTitle, targetOrg] = key.split(':');
    return (
      k === key ||
      (kind === targetKind &&
        title.replace(/ based on .+$/, '') === targetTitle.replace(/ based on .+$/, '') &&
        (!org || org === targetOrg))
    );
  });
export function transitionInterview(
  s: InterviewState,
  action: InterviewAction,
  p: any,
  recordKey?: string,
) {
  const records = experiences(p);
  if (action === 'finish_interview') {
    // The first request to finish lists the empty fields once; the second one finishes (CFS-151).
    if (s.phase !== 'review' && !s.closingChecked && missingFields(p, s).length) {
      s.closingChecked = true;
      s.question = null;
      return;
    }
    s.phase = 'review';
    s.question = null;
    return;
  }
  if (action === 'keep_current_draft') return;
  // A finished interview resumes only through an explicit resume action.
  if (s.phase === 'review' && action !== 'resume') return;
  if (action === 'skip_question') {
    if (s.question) {
      s.addressed = [...new Set([...s.addressed, s.question.key])];
      s.skipped = [...new Set([...(s.skipped || []), s.question.key])];
    }
  } else if (action === 'resume') {
    s.phase = 'collecting';
    if (recordKey && records.some((r) => r.key === recordKey)) {
      s.closed = s.closed.filter((k) => !closedExperience([k], recordKey));
      s.active = recordKey;
    }
  } else {
    const active = s.active;
    if (active) s.closed = [...new Set([...s.closed, active])];
    s.active = null;
    s.phase = 'inventory';
    s.inventoryBaseline = records.map((r) => r.key);
  }
  s.question = null;
}
// A quantitative result may be approximate. Explicitly unmeasured outcomes are valid too.
export function hasOutcomeDetail(text: string) {
  return (
    /unknown|unmeasured|not (?:formally )?measured|(?:did not|didn't|didn’t|never) (?:measure|track)|(?:don['’]t|do not) know|no (?:reliable |quantitative )?(?:data|measurement)|没有(?:测量|统计|数据)|不清楚|不知道/i.test(
      text,
    ) ||
    /(?:\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half)\s*(?:%|percent|hours?|minutes?|days?|weeks?|seconds?|orders?|users?|customers?|students?|cases?|people|reports?|dollars?|倍|小时|分钟|天|人|单)/i.test(
      text,
    )
  );
}

const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
/**
 * The profile fields the interview fills in, in the order it asks for them (CFS-151). A field
 * counts as filled when the working profile or a pending suggestion has a value; until then it
 * is asked again, however often it was asked before, unless the user skipped it. `after` fields
 * are asked once there is at least one experience, so the conversation starts with the story.
 */
export const coverageFields: {
  key: string;
  label: string;
  question: string;
  after?: 'experience';
  filled: (p: any) => boolean;
}[] = [
  {
    key: 'profile:goals',
    label: 'Career direction',
    question: 'Which role or career direction would you like to target?',
    filled: (p) => text(p.goals),
  },
  {
    key: 'profile:name',
    label: 'Name',
    question: 'What name would you like on your resume?',
    filled: (p) => text(p.name),
  },
  {
    key: 'profile:education',
    label: 'Education',
    question: 'What did you study, where, and when? You can skip this if it does not apply.',
    filled: (p) => text(p.education) || Boolean(p.educations?.length),
  },
  {
    key: 'profile:skills',
    label: 'Skills',
    question:
      'Which skills should your profile list? Tools, languages and methods you have used all count.',
    after: 'experience',
    filled: (p) => Boolean(p.skills?.length),
  },
  {
    key: 'profile:location',
    label: 'Preferred location',
    question: 'Where would you like to work? A city, a region or remote is fine.',
    after: 'experience',
    filled: (p) => text(p.location),
  },
  {
    key: 'profile:workArrangement',
    label: 'Work arrangement',
    question: 'Do you prefer on-site, hybrid or remote work?',
    after: 'experience',
    filled: (p) => text(p.workArrangement),
  },
  {
    key: 'profile:employmentType',
    label: 'Employment type',
    question: 'Are you looking for full-time, part-time, contract or graduate roles?',
    after: 'experience',
    filled: (p) => text(p.employmentType),
  },
];

/** Profile fields still empty and not skipped, plus a missing experience (CFS-151). */
export function missingFields(p: any, state: Partial<Pick<InterviewState, 'skipped' | 'closed'>>) {
  const skipped = state.skipped || [];
  const missing = coverageFields
    .filter((f) => !f.filled(p) && !skipped.includes(f.key))
    .map(({ key, label }) => ({ key, label }));
  // A finished experience counts even before its answers are organised into a record.
  if (!experiences(p).length && !state.closed?.length)
    missing.push({ key: 'experience', label: 'At least one experience' });
  return missing;
}

export function planInterview(p: any, current: InterviewState, latestText = '') {
  const state = structuredClone(current);
  const records = experiences(p).filter((r) => !closedExperience(state.closed, r.key));
  const questions: { key: string; text: string }[] = [];
  // `again` marks profile fields: they are asked until filled, not just until answered once.
  const add = (key: string, text: string, again = false) => {
    const skipped = (state.skipped || []).includes(key);
    if (!skipped && (again || !state.addressed.includes(key) || key.includes(':story:')))
      questions.push({ key, text });
  };
  const hasExperience = experiences(p).length > 0 || state.closed.length > 0;
  const addFields = (after?: 'experience') => {
    for (const f of coverageFields)
      if (f.after === after && !f.filled(p)) add(f.key, f.question, true);
  };
  if (state.phase === 'review')
    return {
      state: { ...state, question: null },
      hint: 'Interview finished. Review any pending suggestions, then review your profile. Nothing is approved automatically.',
    };
  if (state.active && !records.some((r) => r.key === state.active)) state.active = null;
  // A uniquely named experience in the latest answer changes the interview focus.
  // Keep the previous story open and preserve its answers; never reopen closed records.
  const normalise = (value: string) =>
    careerTitle(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const text = normalise(latestText);
  const mentions = (value: string) => value.length >= 3 && ` ${text} `.includes(` ${value} `);
  const titleMatches = records.filter((r) => mentions(normalise(r.title)));
  const named = titleMatches.length
    ? titleMatches
    : records.filter((r) => mentions(normalise(r.organisation || '')));
  const active =
    (named.length === 1 ? named[0] : undefined) ||
    records.find((r) => r.key === state.active) ||
    (state.phase === 'inventory'
      ? records
          .filter((r) => state.inventoryBaseline && !state.inventoryBaseline.includes(r.key))
          .at(-1)
      : records.at(-1));
  if (active) {
    state.active = active.key;
    state.phase = 'collecting';
  }
  if (state.phase !== 'inventory') {
    addFields();
    for (const r of p.educations || []) {
      const key = `education:${careerTitle(r.title)}`;
      if (!r.organisation) add(`${key}:institution`, `Which institution is ${r.title} with?`);
      if (!r.startMonth)
        add(`${key}:start`, `When did ${r.title} start? You can skip an unknown date.`);
      if (!r.current && !r.endMonth)
        add(`${key}:end`, `Is ${r.title} ongoing or completed, and when?`);
    }
  }
  if (active) {
    if (!active.startMonth)
      add(
        `${active.key}:start`,
        `When did ${active.title} start? Skip this question if you do not know.`,
      );
    if (!active.current && !active.endMonth)
      add(
        `${active.key}:end`,
        `When did ${active.title} end, or is it ongoing? You can skip this.`,
      );
    if (!active.organisation)
      add(
        `${active.key}:organisation`,
        `Which organisation, university, course or personal context was ${active.title} part of?`,
      );
    if (!experienceOverview(active))
      add(
        `${active.key}:overview`,
        `Briefly describe your role in ${active.title}: your usual responsibilities, tools and scope of work.`,
      );
    else if (!active.starStory?.situation)
      add(
        `${active.key}:story:situation`,
        // Lead with one concrete situation: the rest of the story hangs on it (CFS-152).
        `Pick one specific situation from ${active.title}: what was happening, and what problem, deadline or request made it matter? One example is enough. This example is optional; you can skip it or finish this experience.`,
      );
    else {
      const story = active.starStory;
      // Later questions point back to the user's own situation, so the story stays one story.
      const brief = story.situation.replace(/\s+/g, ' ').trim();
      const that = `that situation (“${brief.length > 70 ? `${brief.slice(0, 67).trimEnd()}…` : brief}”)`;
      if (!story.task)
        add(
          `${active.key}:story:task`,
          `In ${that}, what were you responsible for, or what goal did you set?`,
        );
      if (!story.action)
        add(
          `${active.key}:story:action`,
          `What did you personally do in ${that}? Walk me through the steps you took.`,
        );
      if (!story.result)
        add(
          `${active.key}:story:result`,
          `What changed after what you did in ${that}? An unknown or unmeasured result is fine.`,
        );
      else if (
        !hasOutcomeDetail(story.result) &&
        !(state.outcomeReviewed || []).includes(active.key)
      )
        add(
          `${active.key}:story:measurement`,
          `After that result in ${active.title}, was there a measurable change, such as time saved, fewer errors, people helped or work completed? A rough before-and-after estimate is fine. Was it measured or estimated, and was it your own or the team's result? If it was not measured or you do not know, say so.`,
        );
    }
    // Matching preferences come once the current story has nothing left to ask.
    addFields('experience');
  } else {
    state.phase = state.phase === 'inventory' ? 'inventory' : 'collecting';
    // After "next experience" the user wants to tell another story first.
    if (hasExperience && state.phase !== 'inventory') addFields('experience');
    add(
      `inventory:${state.closed.length}`,
      state.closed.length
        ? 'Would you like to add a different experience? Tell me its name, or finish the interview.'
        : 'Tell me about one work, course or personal project, volunteering or club experience. No formal employment is required.',
    );
  }
  state.question = questions[0] || null;
  const missing = missingFields(p, state);
  // Only on the turn that asked to finish: the transition cleared the question.
  if (current.closingChecked && !current.question && current.phase !== 'review' && missing.length)
    return {
      state,
      hint: `Before you finish, these are still empty: ${missing.map((m) => m.label).join(', ')}. Answer the question below, skip it, or finish again ("that's all" or Finish and review) to review your draft as it is.`,
    };
  return {
    state,
    hint:
      active && !state.question
        ? 'This experience has enough detail for now. Finish this experience, add another, or finish the interview.'
        : 'Continue at your pace. You can skip a question, finish this experience or finish the interview at any time.',
  };
}
