import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { digest, json, type MissionData, ownedMission } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { z } from 'zod';
import { approvedResumeText } from '../../../packages/contracts/src/resume-document.js';
export const applicationRecordSchema = z.object({
  status: z.enum(['opened_official_site', 'submitted_self_reported']),
  contextHash: z.string().min(1),
  confirmed: z.boolean().default(false),
  reference: z.string().max(1000).default(''),
});
function packet(m: any, resume: any) {
  const d = m.data as MissionData;
  const job = d.selectedJob?.job;
  if ((!job?.source?.liveVacancy && !job?.source?.externalListing) || !job?.applicationUrl)
    throw new AppError(
      409,
      'REAL_JOB_REQUIRED',
      'Select an API-retrieved job or a supported external listing first.',
    );
  const u = new URL(job.applicationUrl);
  if (u.protocol !== 'https:' || u.username || u.password)
    throw new AppError(422, 'INVALID_DESTINATION', 'Invalid official application destination.');
  const c = resume.content as any;
  const contextHash = digest({
    mission: m.id,
    job: job.id,
    profile: m.profileId,
    resume: resume.id,
    hash: resume.draftHash,
    destination: u.href,
  });
  return {
    missionId: m.id,
    jobId: job.id,
    company: job.company,
    title: job.title,
    destination: u.href,
    approvedResumeId: resume.id,
    profileVersion: m.profile.version,
    contextHash,
    resumeText: approvedResumeText(c),
    submissionSupported: false,
    notice:
      'No application is sent here. Review/download your approved resume and submit on the official site. A later confirmation is user-reported, not API-verified.',
  };
}
export async function prepareApplication(userId: string, id: string) {
  const m = await ownedMission(userId, id);
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.profileVersion !== m.profile.version)
    throw new AppError(409, 'STALE_PROFILE', 'Prepare a new mission using your current profile.');
  const d = m.data as MissionData;
  const resume = requireValue(
    await db.approvedResume.findFirst({
      where: { id: d.approvedResumeId || '', userId, missionId: id },
    }),
  );
  return packet(m, resume);
}
export async function recordApplication(
  userId: string,
  id: string,
  input: z.infer<typeof applicationRecordSchema>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
    const m = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    if (m.user.profileVersion !== m.profile.version)
      throw new AppError(409, 'STALE_PROFILE', 'Your approved profile changed.');
    const d = m.data as MissionData;
    const resume = requireValue(
      await tx.approvedResume.findFirst({
        where: { id: d.approvedResumeId || '', userId, missionId: id },
      }),
    );
    const p = packet(m, resume);
    if (input.contextHash !== p.contextHash)
      throw new AppError(
        409,
        'STALE_APPLICATION',
        'Prepare and review the current application package again.',
      );
    if (input.status === 'submitted_self_reported' && !input.confirmed)
      throw new AppError(
        422,
        'CONFIRMATION_REQUIRED',
        'Confirm that you personally submitted on the official site.',
      );
    const history = d.applicationHistory || [];
    const duplicate = history.find(
      (h: any) => h.status === 'submitted_self_reported' && h.contextHash === p.contextHash,
    );
    if (input.status === 'submitted_self_reported' && duplicate) return duplicate;
    const record = {
      id: randomUUID(),
      status: input.status,
      contextHash: p.contextHash,
      jobId: p.jobId,
      company: p.company,
      title: p.title,
      approvedResumeId: resume.id,
      reference: input.reference,
      at: new Date().toISOString(),
      verification:
        input.status === 'submitted_self_reported'
          ? 'User-reported; not API-confirmed'
          : 'Official page handoff only; not submitted',
    };
    await tx.mission.update({
      where: { id },
      data: {
        data: json({ ...d, applicationHistory: [...history, record] }),
        events: json([
          ...(m.events as any[]),
          {
            at: record.at,
            agent: 'Job Seeker',
            action: record.status,
            detail: record.verification,
          },
        ]),
      },
    });
    return record;
  });
}
