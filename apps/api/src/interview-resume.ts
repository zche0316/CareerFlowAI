import { db } from './db.js';
import { resumeText, type ResumeView } from '../../../packages/contracts/src/resume-layout.js';

// The interview panel reads the resume version this run approved (CFS-171), not the whole
// profile: it is what the candidate would hand to this employer. A run without one gets none.
export async function approvedResumeText(
  userId: string,
  missionId: string,
  approvedResumeId?: string | null,
) {
  if (!approvedResumeId) return '';
  const saved = await db.approvedResume.findFirst({
    where: { id: approvedResumeId, userId, missionId },
  });
  return saved ? resumeText(saved.content as unknown as ResumeView).slice(0, 6000) : '';
}
