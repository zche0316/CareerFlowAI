import { z } from 'zod';
import { recordKeys, recordText } from './profile-records.js';

export const starSchema = z.object({
  situation: z.string().max(2000).default(''),
  task: z.string().max(2000).default(''),
  action: z.string().max(2000).default(''),
  result: z.string().max(2000).default(''),
});
export const memorySchema = z
  .object({
    kind: z.enum(['NOTE', 'STAR']),
    title: z.string().trim().min(1).max(180),
    text: z.string().trim().max(4000).default(''),
    star: starSchema.default({ situation: '', task: '', action: '', result: '' }),
    source: z.object({
      kind: z.enum(['user', 'conversation', 'profile', 'import', 'interview']),
      id: z.string().max(180).default(''),
      quote: z.string().trim().min(1).max(10000),
      references: z
        .array(
          z.object({
            threadId: z.string().uuid(),
            messageId: z.string().uuid(),
            quote: z.string().min(1).max(6000),
          }),
        )
        .max(40)
        .optional(),
    }),
    recordId: z.string().max(80).nullable().default(null),
    missionId: z.string().uuid().nullable().default(null),
    supersedesId: z.string().uuid().nullable().default(null),
  })
  .superRefine((m, c) => {
    if (m.kind === 'NOTE' && !m.text)
      c.addIssue({ code: 'custom', path: ['text'], message: 'Enter a memory.' });
    if (m.kind === 'STAR' && !Object.values(m.star).some((s) => s.trim()))
      c.addIssue({
        code: 'custom',
        path: ['star'],
        message: 'Add what you know about this story. Unknown results may remain blank.',
      });
  });
export const memoryText = (m: { text: string; star: unknown; kind: string }) =>
  m.kind === 'STAR'
    ? ['situation', 'task', 'action', 'result']
        .map((k) => `${k}: ${(m.star as Record<string, string>)[k] || ''}`)
        .join('\n')
    : m.text;

export function matchingProfileView(p: any) {
  const month = new Date().toISOString().slice(0, 7);
  const completedEducation = (p.educations || [])
    .filter((r: any) => !r.current && r.endMonth && r.endMonth <= month && !r.expectedEndMonth)
    .map(recordText);
  return {
    ...p,
    skills: [
      ...new Set([
        ...(p.skills || []),
        ...recordKeys.flatMap((k) => (p[k] || []).flatMap((r: any) => r.technologies || [])),
      ]),
    ],
    education: [
      p.educations?.length || /(?:studying|expected|enrolled|pursuing)/i.test(p.education || '')
        ? ''
        : p.education,
      ...completedEducation,
    ]
      .filter(Boolean)
      .join('\n'),
    goals: [p.goals, ...recordKeys.flatMap((k) => (p[k] || []).map(recordText))]
      .filter(Boolean)
      .join('\n'),
    // Course/volunteer/club duration is never added to paid employment years.
    experienceYears: p.experienceYears,
    approved: true,
  };
}

// Unicode words plus CJK bigrams provide an inspectable multilingual baseline.
export function terms(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}+#]+/gu) || [];
  const cjk = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  return [
    ...new Set([
      ...words,
      ...cjk.flatMap((s) =>
        Array.from(s)
          .slice(0, -1)
          .map((_, i) =>
            Array.from(s)
              .slice(i, i + 2)
              .join(''),
          ),
      ),
    ]),
  ];
}
export function rankEvidence<
  T extends { id: string; text: string; recordId?: string | null; missionId?: string | null },
>(rows: T[], query: string, scope: { recordId?: string; missionId?: string } = {}) {
  const stop = new Set(
    'i my me the a an and or to for of in on with is are was it this that please'.split(' '),
  );
  const queryTerms = terms(query)
    .filter((t) => !stop.has(t))
    .slice(0, 40);
  return rows
    .filter(
      (r) =>
        (!scope.recordId || r.recordId === scope.recordId) &&
        (scope.missionId ? !r.missionId || r.missionId === scope.missionId : !r.missionId),
    )
    .map((row) => {
      const words = new Set(terms(row.text));
      const matched = queryTerms.filter((t) => words.has(t));
      return { ...row, score: matched.length / Math.max(queryTerms.length, 1), matched };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 8);
}

export function nextProfileQuestions(p: any) {
  const q: string[] = [];
  if (!p.name) q.push('What name would you like on your resume?');
  if (!p.goals) q.push('Which role or career direction would you like to target?');
  if (!p.skills?.length) q.push('Which skills have you used, and in which project or role?');
  if (!p.education && !p.educations?.length)
    q.push('What did you study, where, and when? State none yet if applicable.');
  if (!p.experience && !p.projects?.length && !p.workExperiences?.length)
    q.push('Describe one project or work experience, your own contribution and the actual result.');
  for (const key of recordKeys)
    for (const r of p[key] || []) {
      if (!r.startMonth) q.push(`When did ${r.title} start (YYYY-MM)?`);
      if (!r.current && !r.endMonth) q.push(`When did ${r.title} end, or is it ongoing?`);
      if (key === 'educations') {
        if (!r.organisation) q.push(`Which institution is ${r.title} with?`);
      } else if (!r.details?.length) q.push(`What was your own contribution to ${r.title}?`);
    }
  if (!p.location) q.push('Which locations or work arrangements would you prefer?');
  return q.slice(0, 4);
}

// Constrained editing, not a semantic truth detector. Unsupported rewrites require
// a factual profile correction instead of bypassing review with fluent wording.
export function checkWording(before: string, after: string) {
  const numbers = (s: string) => [...new Set(s.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) || [])].sort();
  if (JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after)))
    return 'Keep all original numbers and dates exactly.';
  const qualifiers =
    /\b(no|not|never|assisted|supported|learning|planned|team|approximately|expected|intern|junior|student)\b/gi;
  if ((before.match(qualifiers) || []).some((q) => !new RegExp(`\\b${q}\\b`, 'i').test(after)))
    return 'Keep scope, uncertainty, seniority and contribution qualifiers.';
  const stem = (s: string) => s.replace(/(?:ing|ed|s)$/, '');
  const permitted = new Set(terms(before).map(stem));
  const style = new Set(
    'a an the and or for of to in on at by with as from using i my was were is are responsible'
      .split(' ')
      .map(stem),
  );
  const afterTerms = new Set(terms(after).map(stem));
  if (terms(before).some((t) => !style.has(stem(t)) && !afterTerms.has(stem(t))))
    return 'Keep the source facts and technical terms; remove only first-person filler.';
  if (terms(after).some((t) => !permitted.has(stem(t)) && !style.has(stem(t))))
    return 'Use only source-supported words; correct factual evidence separately for new claims.';
  return null;
}

export const profileRecordSources = (p: any) =>
  recordKeys.flatMap((k) => (p[k] || []).map((r: any) => ({ id: r.id, text: recordText(r) })));
