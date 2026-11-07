// SCAFFOLD (plan milestone M3, docs/MULTI_AGENT_PLAN.md). Not wired into workflow.ts yet.
// A supervisor picks the next team from mission state instead of fixed edges. Kept as a pure
// rule function first so every routing decision is explainable and unit-testable; a model
// planner can later propose a plan that the user approves before these rules execute it.

export type MissionTeam =
  | 'career_coach'
  | 'job_matching'
  | 'scout'
  | 'select_job'
  | 'resume_team'
  | 'interview'
  | 'end';

export type SupervisorView = {
  hasAnalysis: boolean;
  matches: number | null; // null = matching has not run
  selectedJob: boolean;
  approvedResume: boolean;
  interviewComplete: boolean;
  // Scheduled Scout sweeps provide a shortlist instead of an on-demand search.
  scoutShortlist?: number;
  // Matcher found the selected job weakly supported; the coach should plan gaps first.
  weakCoverage?: boolean;
};

export function nextTeam(v: SupervisorView): { team: MissionTeam; reason: string } {
  if (!v.hasAnalysis) return { team: 'career_coach', reason: 'No career analysis yet.' };
  if (v.matches === null)
    return v.scoutShortlist
      ? { team: 'select_job', reason: `Scout shortlisted ${v.scoutShortlist} new job(s).` }
      : { team: 'job_matching', reason: 'No ranked jobs yet.' };
  if (!v.matches) return { team: 'end', reason: 'No job met the minimum score.' };
  if (!v.selectedJob) return { team: 'select_job', reason: 'Waiting for the user to choose.' };
  if (v.weakCoverage && !v.approvedResume)
    return { team: 'career_coach', reason: 'Selected job is weakly supported; plan gaps first.' };
  if (!v.approvedResume) return { team: 'resume_team', reason: 'No approved resume for this job.' };
  if (!v.interviewComplete) return { team: 'interview', reason: 'Interview practice pending.' };
  return { team: 'end', reason: 'Mission complete.' };
}
