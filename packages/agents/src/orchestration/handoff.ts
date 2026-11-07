// A handoff is the visible unit of collaboration: who passed work to whom, and why.
// Handoffs live in graph state (checkpointed) and are mirrored to mission data for the UI.
export type Handoff = { at: string; from: string; to: string; reason: string };

export const MAX_HANDOFFS = 60;

export const handoff = (from: string, to: string, reason: string): Handoff => ({
  at: new Date().toISOString(),
  from,
  to,
  reason: reason.slice(0, 300),
});

// LangGraph reducer: append and keep a bounded history so long missions stay small.
export function appendHandoffs(current: Handoff[], next: Handoff | Handoff[]): Handoff[] {
  return [...current, ...(Array.isArray(next) ? next : [next])].slice(-MAX_HANDOFFS);
}

export const agentLabels: Record<string, string> = {
  gap_analyzer: 'Gap Analyzer',
  selector: 'Evidence Selector',
  rewriter: 'Rewriter',
  critic: 'Critic',
  human_review: 'You',
  end: 'Approved',
};
