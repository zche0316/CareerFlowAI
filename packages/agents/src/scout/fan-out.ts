import { Send } from '@langchain/langgraph';

// SCAFFOLD (plan milestone M2). Map-reduce over the Scout shortlist: one resume-team run per job
// in parallel, then a single batch review interrupt where the user approves, edits or discards
// each package. Usage inside a mission graph:
//
//   .addConditionalEdges('shortlist', (s) => fanOutTailoring(s.missionId, s.shortlist), ['tailor_job'])
//   .addNode('tailor_job', tailorOneJob)       // resume team keyed by (missionId, jobId)
//   .addEdge('tailor_job', 'batch_review')     // waits for all branches, then interrupt()
//
// Each branch writes to a reducer channel keyed by jobId, so branches never overwrite each other.
export type TailorTask = { missionId: string; jobId: string };

export const MAX_PARALLEL_TAILORING = 3;

export function fanOutTailoring(
  missionId: string,
  shortlist: { job: { id: string } }[],
  limit = MAX_PARALLEL_TAILORING,
) {
  return shortlist
    .slice(0, limit)
    .map((item) => new Send('tailor_job', { missionId, jobId: item.job.id } satisfies TailorTask));
}
