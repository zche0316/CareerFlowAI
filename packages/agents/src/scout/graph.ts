import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { appendHandoffs, handoff, type Handoff } from '../orchestration/handoff.js';
import { fanOutTailoring, MAX_PARALLEL_TAILORING, type TailorTask } from './fan-out.js';

// Reverse job search: Scout collects new public roles, Job Matcher ranks them, then one resume
// team per shortlisted job starts in parallel (Send fan-out). Graph state holds routing data only:
// jobs, scores and packages are stored by the ports, never in checkpoints.

export type ScoutPackage = { jobId: string; missionId: string; title?: string };

export interface ScoutGraphPorts {
  /** Fetch the saved search, drop roles seen before, store the new job records. */
  collect(sweepId: string): Promise<{ fetched: number; fresh: number; failures: number }>;
  /** Score the new roles against the approved profile and store the shortlist. */
  rank(sweepId: string): Promise<{ jobId: string; score: number }[]>;
  /** Start one tailoring package for a shortlisted job. Must be idempotent per (sweep, job). */
  tailor(sweepId: string, jobId: string): Promise<ScoutPackage>;
  /** Whether this sweep starts resume teams itself (opt-in); otherwise it only discovers. */
  autoPackage?(sweepId: string): Promise<boolean>;
  /** Put shortlisted roles on the user's board without starting a resume team. */
  discover?(sweepId: string, jobIds: string[]): Promise<number>;
  /** Store the finished sweep with its packages and handoff log. */
  report(sweepId: string, packages: ScoutPackage[], handoffs: Handoff[]): Promise<void>;
}

export const ScoutState = Annotation.Root({
  sweepId: Annotation<string>(),
  shortlist: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  packages: Annotation<ScoutPackage[]>({
    reducer: (current, next) => [
      ...current,
      ...next.filter((p) => !current.some((c) => c.jobId === p.jobId)),
    ],
    default: () => [],
  }),
  handoffs: Annotation<Handoff[]>({ reducer: appendHandoffs, default: () => [] }),
});

export function buildScoutGraph(ports: ScoutGraphPorts, checkpointer?: BaseCheckpointSaver) {
  return new StateGraph(ScoutState)
    .addNode('scout', async (s) => {
      const r = await ports.collect(s.sweepId);
      return {
        handoffs: handoff(
          'scout',
          'job_matcher',
          `${r.fresh} new of ${r.fetched} fetched roles` +
            (r.failures ? `; ${r.failures} source(s) unavailable` : ''),
        ),
      };
    })
    .addNode('job_matcher', async (s) => {
      const ranked = await ports.rank(s.sweepId);
      const shortlist = ranked.slice(0, MAX_PARALLEL_TAILORING).map((r) => r.jobId);
      // Discover-first: the roles go on the board and the user decides what to spend on.
      if (ports.autoPackage && !(await ports.autoPackage(s.sweepId))) {
        const added = shortlist.length && ports.discover ? await ports.discover(s.sweepId, shortlist) : 0;
        return {
          shortlist: [],
          handoffs: handoff(
            'job_matcher',
            'report',
            shortlist.length
              ? `Put ${added} role(s) on your board as new from Scout; no resume team started`
              : 'No new role reached the minimum match score',
          ),
        };
      }
      return {
        shortlist,
        handoffs: handoff(
          'job_matcher',
          shortlist.length ? 'resume_team' : 'report',
          shortlist.length
            ? `Shortlisted ${shortlist.length} role(s); starting one resume team per role in parallel`
            : 'No new role reached the minimum match score',
        ),
      };
    })
    .addNode('tailor_job', async (task: unknown) => {
      const { sweepId, jobId } = task as TailorTask;
      const pack = await ports.tailor(sweepId, jobId);
      return {
        packages: [pack],
        handoffs: handoff(
          'resume_team',
          'human_review',
          `Draft under way for ${pack.title || 'job ' + jobId}`,
        ),
      };
    })
    .addNode('report', async (s) => {
      await ports.report(s.sweepId, s.packages, s.handoffs);
      return {};
    })
    .addEdge(START, 'scout')
    .addEdge('scout', 'job_matcher')
    .addConditionalEdges(
      'job_matcher',
      (s) => (s.shortlist.length ? fanOutTailoring(s.sweepId, s.shortlist) : 'report'),
      ['tailor_job', 'report'],
    )
    .addEdge('tailor_job', 'report')
    .addEdge('report', END)
    .compile({ checkpointer });
}
