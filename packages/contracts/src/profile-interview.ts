import { careerTitle } from './conversation-source.js';
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
    /\bnot (?:yet )?(?:enough|sufficient|done|finished)\b|don't think|还不够|没说完/i.test(s)
  )
    return null;
  if (
    /^(?:finish|end|stop) (?:the |this )?(?:interview|profile)|(?:结束|完成)(?:整个)?(?:访谈|问答)|(?:no|don't have any) (?:more|other) experiences?/i.test(
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
    /^(?:next|another|add another)(?: work)? (?:experience|project)|^(?:下一个|下一段|再加一个)(?:经历|项目)/i.test(
      s,
    )
  )
    return 'next_experience';
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
  if (saved) return structuredClone(saved);
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
    s.phase = 'review';
    s.question = null;
    return;
  }
  if (action === 'keep_current_draft') return;
  if (action === 'skip_question') {
    if (s.question) s.addressed = [...new Set([...s.addressed, s.question.key])];
  } else if (action === 'resume') {
    s.phase = 'collecting';
    if (recordKey && records.some((r) => r.key === recordKey)) {
      s.closed = s.closed.filter((k) => !closedExperience([k], recordKey));
      s.active = recordKey;
    }
  } else {
    const active =
      s.active || records.filter((r) => !closedExperience(s.closed, r.key)).at(-1)?.key;
    if (active) s.closed = [...new Set([...s.closed, active])];
    s.active = null;
    s.phase = 'inventory';
    s.inventoryBaseline = records.map((r) => r.key);
  }
  s.question = null;
}
export function planInterview(p: any, current: InterviewState) {
  const state = structuredClone(current);
  const records = experiences(p).filter((r) => !closedExperience(state.closed, r.key));
  const questions: { key: string; text: string }[] = [];
  const add = (key: string, text: string) => {
    if (!state.addressed.includes(key)) questions.push({ key, text });
  };
  if (state.phase === 'review')
    return {
      state: { ...state, question: null },
      hint: 'Interview finished. Review any pending suggestions, then review your profile. Nothing is approved automatically.',
    };
  if (state.active && !records.some((r) => r.key === state.active)) state.active = null;
  const active =
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
    if (!p.goals) add('profile:goals', 'Which role or career direction would you like to target?');
    if (!p.name) add('profile:name', 'What name would you like on your resume?');
    if (!p.education && !p.educations?.length)
      add(
        'profile:education',
        'What did you study, where, and when? You can skip this if it does not apply.',
      );
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
    const details = (active.details || []).join(' ');
    if (!active.organisation)
      add(
        `${active.key}:organisation`,
        `Which organisation, university, course or personal context was ${active.title} part of?`,
      );
    if (!details)
      add(
        `${active.key}:background`,
        `What was the purpose or problem in ${active.title}? Describe the context first.`,
      );
    if (
      !/responsib|my role|I (?:was|handled|built|setup|set up|wrote|implemented)|职责|负责/i.test(
        details,
      )
    )
      add(
        `${active.key}:responsibility`,
        `What were you personally responsible for in ${active.title}, separate from the team?`,
      );
    if (!details || !/\bI\b|\bmy\b|我/.test(details))
      add(
        `${active.key}:action`,
        `What did you personally do in ${active.title}? Describe your part separately from the team's work.`,
      );
    if (!/outcome|result|unknown|not known|成果|结果|未知/i.test(details))
      add(
        `${active.key}:outcome`,
        `What happened after your work on ${active.title}? An unknown outcome is fine; you can finish this experience now.`,
      );
    if (!active.technologies?.length)
      add(`${active.key}:tools`, `Which tools or technologies did you use in ${active.title}?`);
    if (!/learn|realiz|realis|reflect|importance|学到|反思/i.test(details))
      add(
        `${active.key}:reflection`,
        `What did you learn from ${active.title}, or what would you do differently? You can skip this optional question.`,
      );
  } else {
    state.phase = state.phase === 'inventory' ? 'inventory' : 'collecting';
    add(
      `inventory:${state.closed.length}`,
      state.closed.length
        ? 'Would you like to add a different experience? Tell me its name, or finish the interview.'
        : 'Tell me about one work, course or personal project, volunteering or club experience. No formal employment is required.',
    );
  }
  state.question = questions[0] || null;
  return {
    state,
    hint:
      active && !state.question
        ? 'This experience has enough detail for now. Finish this experience, add another, or finish the interview.'
        : 'Continue at your pace. You can skip a question, finish this experience or finish the interview at any time.',
  };
}
