import type { Express } from 'express';
import { db } from './db.js';
import { ownedMission } from './domain.js';
import type { ProviderSpan } from '../../../packages/agents/src/provider.js';

export type SpanOwner = { userId: string; missionId?: string; sweepId?: string; agent?: string };

// Party member names exactly as mission events and the Battle log avatars use them.
// The Evaluator posts its events as the Interview Coach, so its spans do too.
const agentNames: Record<string, string> = {
  coach: 'Career Coach',
  matching: 'Job Matcher',
  resume: 'Evidence Selector',
  rewrite: 'Rewriter',
  critic: 'Critic',
  questions: 'Interview Coach',
  feedback: 'Interview Coach',
  evaluator: 'Interview Coach',
  negotiation: 'Interview Coach',
  'job-page': 'Scout',
};
export const agentForRole = (role: string) => agentNames[role] || role;

/** Stores one span. Tracing is diagnostic, so a failed insert is logged and never rethrown. */
export async function recordSpan(owner: SpanOwner, span: ProviderSpan) {
  try {
    await db.traceSpan.create({
      data: {
        userId: owner.userId,
        missionId: owner.missionId || null,
        sweepId: owner.sweepId || null,
        agent: owner.agent || agentForRole(span.role),
        role: span.role,
        model: span.model,
        mode: span.mode,
        startedAt: new Date(span.startedAt),
        durationMs: Math.max(0, Math.round(span.durationMs)),
        attempts: span.attempts,
        inputTokens: span.inputTokens,
        outputTokens: span.outputTokens,
        status: span.status,
        error: span.error?.slice(0, 40) || null,
      },
    });
  } catch (error) {
    console.error('Trace span was not stored:', (error as Error).message);
  }
}

export const spanHook = (owner: SpanOwner) => (span: ProviderSpan) => recordSpan(owner, span);

type Row = {
  agent: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: string;
};
export function traceTotals(spans: Row[]) {
  return spans.reduce(
    (t, s) => ({
      calls: t.calls + 1,
      inputTokens: t.inputTokens + s.inputTokens,
      outputTokens: t.outputTokens + s.outputTokens,
      durationMs: t.durationMs + s.durationMs,
      errors: t.errors + (s.status === 'error' ? 1 : 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, errors: 0 },
  );
}

/** Spans for one owned mission (oldest first, capped) with totals and a per-agent breakdown. */
export async function missionTrace(userId: string, missionId: string) {
  const spans = await db.traceSpan.findMany({
    where: { userId, missionId },
    orderBy: { startedAt: 'asc' },
    take: 300,
    select: {
      id: true,
      agent: true,
      role: true,
      model: true,
      mode: true,
      startedAt: true,
      durationMs: true,
      attempts: true,
      inputTokens: true,
      outputTokens: true,
      status: true,
      error: true,
    },
  });
  const groups = new Map<string, Row[]>();
  for (const s of spans) groups.set(s.agent, [...(groups.get(s.agent) || []), s]);
  return {
    spans,
    totals: traceTotals(spans),
    byAgent: [...groups].map(([agent, rows]) => {
      const { calls, inputTokens, outputTokens, durationMs, errors } = traceTotals(rows);
      const attempts = rows.reduce((n, r) => n + r.attempts, 0);
      return { agent, calls, attempts, inputTokens, outputTokens, durationMs, errors };
    }),
  };
}

export function registerTrace(app: Express) {
  app.get('/api/missions/:id/trace', async (req, res) => {
    const id = String(req.params.id);
    // Ownership first: a stranger gets the same 404 as a missing mission.
    await ownedMission(req.actor!.id, id);
    res.json(await missionTrace(req.actor!.id, id));
  });
}
