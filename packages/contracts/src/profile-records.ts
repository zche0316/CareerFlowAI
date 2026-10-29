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
