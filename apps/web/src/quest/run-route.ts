import { nextMissionStep } from '../mission-step.js';

// The steps a run actually has (CFS-121). The profile and career advice belong to the workspace
// (My profile, Coach), so they are not run steps. A search run starts at the shortlist; a run on
// a saved role starts at the resume review; a practice run is only the interview.

export type RunStep = { label: 'Shortlist' | 'Review' | 'Practice' | 'Apply'; phase: number };

const SHORTLIST: RunStep = { label: 'Shortlist', phase: 2 };
const REVIEW: RunStep = { label: 'Review', phase: 3 };
const PRACTICE: RunStep = { label: 'Practice', phase: 4 };
const APPLY: RunStep = { label: 'Apply', phase: 7 };

export function runKind(m: any): 'search' | 'role' | 'practice' {
  const d = m?.data || {};
  if (d.practiceOnly) return 'practice';
  if (d.preselected || d.scout) return 'role';
  return 'search';
}

export function runRoute(m: any): RunStep[] {
  const kind = runKind(m);
  if (kind === 'practice') return [PRACTICE, APPLY];
  if (kind === 'role') return [REVIEW, PRACTICE, APPLY];
  return [SHORTLIST, REVIEW, PRACTICE, APPLY];
}

/** The phase a run is at, never earlier than its first step. Complete runs are at Apply. */
export function reachedPhase(m: any) {
  if (m?.status === 'COMPLETE') return APPLY.phase;
  return Math.max(nextMissionStep(m), runRoute(m)[0].phase);
}

/** Old links to the profile (0) or analysis (1) step open the run's first step instead. */
export function runPhase(m: any, phase: number | null) {
  return phase === 0 || phase === 1 ? runRoute(m)[0].phase : phase;
}

/** Done, current or not yet reached, plus whether the step can be opened. */
export function stepState(m: any, step: RunStep) {
  const reached = reachedPhase(m);
  // Apply opens once a resume is approved, whatever the interview's state.
  const open = step.phase <= reached || (step === APPLY && Boolean(m?.data?.approvedResumeId));
  const done = m?.status === 'COMPLETE' ? step !== APPLY : step.phase < reached && step !== APPLY;
  const now = !done && step.phase === reached;
  return { state: done ? 'done' : now ? 'now' : 'todo', open } as const;
}
