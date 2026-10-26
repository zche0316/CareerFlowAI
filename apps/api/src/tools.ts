import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { ownedMission, json, type MissionData } from './domain.js';
import { AppError, requireValue } from './errors.js';
export const toolCommand = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('status'),
    status: z.enum(['applied', 'interview', 'rejected', 'offer']),
  }),
  z.object({
    kind: z.literal('reminder'),
    title: z.string().trim().min(1).max(500),
    category: z.enum(['application', 'interview', 'follow-up']),
    dueAt: z.iso.datetime(),
  }),
  z.object({ kind: z.literal('letter') }),
  z.object({
    kind: z.literal('negotiation'),
    offer: z.string().trim().min(1).max(2000),
    response: z.string().trim().min(1).max(4000),
  }),
]);
export function buildLetter(profile: any, facts: any[], job: any) {
  return {
    text: `Dear hiring team,\n\nI am interested in the ${job.title} role at ${job.company}.\n\n${facts
      .filter((f) => ['skill', 'education', 'experience'].includes(f.kind) && f.text !== 'none yet')
      .map((f) => f.text)
      .join(
        '\n',
      )}\n\nI would welcome the opportunity to discuss how my approved experience relates to this role.\n\nKind regards,\n${profile.name}`,
    mode: 'local-template',
    limitations: [
      'Uses verbatim approved facts. Review relevance and wording before sharing; nothing is sent.',
    ],
  };
}
export function calendarFile(r: any) {
  const clean = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const date = (s: string) =>
    new Date(s)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareerFlow//Stage2//EN',
    'BEGIN:VEVENT',
    'UID:' + r.id + '@careerflow.local',
    'DTSTAMP:' + date(r.createdAt),
    'DTSTART:' + date(r.dueAt),
    'SUMMARY:' + clean(r.title),
    'DESCRIPTION:' + clean(r.category + ' reminder'),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:CareerFlow reminder',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
export function summarizeTools(missions: any[]) {
  const applications = missions.flatMap((m) => {
    const status = m.data.optionalTools?.status;
    return status
      ? [
          {
            missionId: m.id,
            title: m.data.selectedJob?.job.title,
            status: status.value,
            updatedAt: status.at,
          },
        ]
      : [];
  });
  const n = applications.length,
    interviews = applications.filter((a) => ['interview', 'offer'].includes(a.status)).length,
    rejected = applications.filter((a) => a.status === 'rejected').length;
  const counts: Record<string, number> = {};
  for (const r of missions.find((m) => m.data.matches)?.data.matches || [])
    for (const gap of r.gaps) counts[gap] = (counts[gap] || 0) + 1;
  return {
    applications,
    total: n,
    interviewCount: interviews,
    rejected,
    interviewRate: n ? interviews / n : null,
    rejectionRate: n ? rejected / n : null,
    recurringGaps: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    reminders: missions.flatMap((m) =>
      (m.data.optionalTools?.reminders || []).map((r: any) => ({ ...r, missionId: m.id })),
    ),
    limitations: [
      'Statuses are self-reported, not verified by employers. Rates use current status only; an offer counts as interview reached. One application record per mission. Latest persisted matching run supplies gap counts.',
    ],
  };
}
export async function toolsDashboard(userId: string) {
  return summarizeTools(
    await db.mission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  );
}
export async function runTool(userId: string, id: string, input: z.infer<typeof toolCommand>) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
    const m = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    if (m.user.profileVersion !== m.profile.version)
      throw new AppError(409, 'STALE_PROFILE', 'Start a mission with the latest approved profile.');
    const d = m.data as MissionData;
    const job = d.selectedJob?.job;
    if (!job) throw new AppError(409, 'TARGET_REQUIRED', 'Select a target job first.');
    const old = d.optionalTools || {};
    let patch: any = {},
      result: any;
    const now = new Date().toISOString();
    if (input.kind === 'status') {
      result = { value: input.status, at: now };
      patch = { status: result };
    } else if (input.kind === 'letter') {
      result = buildLetter(m.profile.data, m.profile.facts as any[], job);
      patch = { letter: { ...result, at: now, profileVersion: m.profile.version } };
    } else if (input.kind === 'reminder') {
      result = {
        id: randomUUID(),
        title: input.title,
        category: input.category,
        dueAt: input.dueAt,
        createdAt: now,
        jobId: job.id,
      };
      patch = { reminders: [...(old.reminders || []), result] };
    } else {
      result = {
        mode: 'local-roleplay',
        reply:
          'Thank you for explaining your priorities. Which part of the offer would you like to clarify: responsibilities, compensation, benefits or review timing?',
        feedback: [
          input.response.length < 100
            ? 'Explain your priorities and evidence more specifically.'
            : 'Check that factual claims are supported by your experience.',
          'Ask an open question and confirm terms in writing.',
        ],
        limitations: [
          'Scripted practice; no salary estimate, employer prediction or external message.',
        ],
      };
      patch = { negotiation: { ...result, offer: input.offer, response: input.response, at: now } };
    }
    await tx.mission.update({
      where: { id },
      data: {
        data: json({ ...d, optionalTools: { ...old, ...patch } }),
        events: json([
          ...(m.events as any[]),
          {
            at: now,
            agent: 'Career Data Service',
            action: 'optional_' + input.kind,
            detail: 'User-requested local tool; no external communication.',
          },
        ]),
      },
    });
    return result;
  });
}
export async function exportReminder(userId: string, id: string, reminderId: string) {
  const m = await ownedMission(userId, id);
  const d = m.data as MissionData;
  const r = requireValue(d.optionalTools?.reminders?.find((r: any) => r.id === reminderId));
  return { filename: 'careerflow-reminder.ics', content: calendarFile(r) };
}
