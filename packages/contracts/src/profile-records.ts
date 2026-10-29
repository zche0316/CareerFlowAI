import { z } from 'zod';
const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.')
  .nullable()
  .default(null);
export const recordSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
    title: z.string().trim().min(1).max(200),
    experienceType: z.enum(['work', 'course', 'personal', 'volunteer', 'club']).optional(),
    organisation: z.string().trim().max(200).default(''),
    location: z.string().trim().max(120).default(''),
    startMonth: month,
    endMonth: month,
    expectedEndMonth: month.optional(),
    current: z.boolean().default(false),
    details: z
      .array(z.string().trim().max(2000))
      .max(20)
      .transform((lines) => lines.filter(Boolean))
      .default([]),
    organisedStory: z
      .object({
        sourceHash: z.string().min(1).max(100),
        groups: z
          .array(
            z.object({
              category: z.enum([
                'background',
                'responsibility',
                'action',
                'result',
                'reflection',
                'other',
              ]),
              items: z
                .array(
                  z.object({
                    text: z.string().min(1).max(2000),
                    sourceIndices: z.array(z.number().int().min(0).max(19)).min(1).max(20),
                  }),
                )
                .max(20),
            }),
          )
          .max(6),
      })
      .optional(),
    technologies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    url: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .max(500)
          .refine((s) => /^https?:\/\//.test(s), 'Use HTTP or HTTPS.'),
      ])
      .default(''),
    evidence: z
      .array(
        z.object({
          importId: z.string().uuid(),
          page: z.number().int().min(1).max(10),
          quote: z.string().min(1).max(6000),
        }),
      )
      .max(10)
      .default([]),
    conversationEvidence: z
      .array(
        z.object({
          threadId: z.string().uuid(),
          messageId: z.string().uuid(),
          quote: z.string().min(1).max(6000),
        }),
      )
      .max(10)
      .optional(),
    memoryEvidence: z
      .array(
        z.object({
          memoryId: z.string().uuid(),
          revision: z.number().int().positive(),
          quote: z.string().min(1).max(10000),
        }),
      )
      .max(10)
      .optional(),
  })
  .superRefine((r, c) => {
    if (r.current && r.endMonth)
      c.addIssue({
        code: 'custom',
        path: ['endMonth'],
        message: 'A current record must have no end month.',
      });
    if (r.startMonth && r.expectedEndMonth && r.expectedEndMonth < r.startMonth)
      c.addIssue({
        code: 'custom',
        path: ['expectedEndMonth'],
        message: 'Expected completion must not precede start month.',
      });
    if (r.startMonth && r.endMonth && r.endMonth < r.startMonth)
      c.addIssue({
        code: 'custom',
        path: ['endMonth'],
        message: 'End month must not precede start month.',
      });
  });
export type ProfileRecord = z.infer<typeof recordSchema>;
export const recordKeys = ['workExperiences', 'projects', 'educations'] as const;
export type RecordKey = (typeof recordKeys)[number];
export function recordText(r: ProfileRecord) {
  return [
    r.title,
    r.organisation,
    r.location,
    [r.startMonth, r.current ? 'Present' : r.endMonth].filter(Boolean).join(' – '),
    r.expectedEndMonth ? 'Expected completion: ' + r.expectedEndMonth : '',
    ...r.details,
    r.technologies.length ? 'Technologies: ' + r.technologies.join(', ') : '',
    r.url,
  ]
    .filter(Boolean)
    .join('\n');
}
export function orderedRecords(records: ProfileRecord[] = []) {
  return [...records].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      (b.endMonth || b.startMonth || '').localeCompare(a.endMonth || a.startMonth || ''),
  );
}

// Absence markers are useful intake answers, never qualifications or resume claims.
export const hasCareerContent = (value: string | undefined) =>
  !!value?.trim() &&
  !/^(?:none(?: yet)?|n\/a|no(?:ne)? (?:formal )?(?:work )?experience(?: yet)?|no education(?: yet)?|暂无|无|没有)[.!。]?$/i.test(
    value.trim(),
  );

// Non-security fingerprint: invalidates a presentation grouping when its source answers change.
export function storyFingerprint(details: string[]) {
  let hash = 2166136261;
  for (const c of JSON.stringify(details)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
