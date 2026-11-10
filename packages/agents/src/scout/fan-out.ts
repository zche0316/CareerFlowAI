import { Send } from '@langchain/langgraph';

// Map step of the Scout graph: one tailoring branch per shortlisted job, run in the same
// superstep. Each branch writes to a reducer channel, so branches never overwrite each other.
export type TailorTask = { sweepId: string; jobId: string };

export const MAX_PARALLEL_TAILORING = 3;

export function fanOutTailoring(sweepId: string, jobIds: string[], limit = MAX_PARALLEL_TAILORING) {
  return jobIds
    .slice(0, limit)
    .map((jobId) => new Send('tailor_job', { sweepId, jobId } satisfies TailorTask));
}
