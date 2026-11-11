// The journey step a mission should open at, from its status and saved data.
export function nextMissionStep(m: any): number {
  if (m.status === 'COMPLETE') return 4;
  if (['QUEUED', 'RUNNING'].includes(m.status) && m.pendingDecision?.kind === 'job') return 3;
  if (['QUEUED', 'RUNNING'].includes(m.status) && m.pendingDecision?.kind === 'resume') return 4;
  if (m.status === 'AWAITING_APPROVAL' || (m.data?.resumeDraft && !m.data?.approvedResumeId))
    return 3;
  if (m.status === 'AWAITING_INTERVIEW' || m.data?.approvedResumeId) return 4;
  if (m.data?.selectedJob) return 3;
  if (m.status === 'AWAITING_JOB' || m.data?.matches?.length || m.status === 'NO_MATCHES') return 2;
  return 1;
}
