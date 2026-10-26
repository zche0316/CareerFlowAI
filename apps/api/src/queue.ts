import { JobSourceError } from '../../../packages/recruitment/src/repository.js';
import { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db, databaseUrl, portablePool } from './db.js';
import { json, mutateRun, type Event } from './domain.js';
import { createWorkflow } from '../../../packages/agents/src/workflow.js';

const QUEUE = 'careerflow-missions';

let boss: PgBoss | undefined;

let workflow: Awaited<ReturnType<typeof createWorkflow>> | undefined;

let recovery: ReturnType<typeof setInterval> | undefined;

const active = new Map<string, AbortController>();

export const abortRun = (id: string) => active.get(id)?.abort();

export async function initQueue(withWorker: boolean) {
  boss = new PgBoss(
    portablePool
      ? {
          db: { executeSql: (text, values) => portablePool!.query(text, values) },
          useListenNotify: false,
        }
      : { connectionString: databaseUrl },
  );
  boss.on('error', (e) => console.error('Queue error:', e.message));
  await boss.start();
  await boss.createQueue(QUEUE, { retryLimit: 2, retryDelay: 10, expireInSeconds: 300 });
  if (withWorker) {
    workflow = await createWorkflow();
    await boss.work<{ missionId: string }>(QUEUE, { localConcurrency: 3 }, async (jobs) => {
      for (const job of jobs) await executeMission(job.data.missionId);
    });
    await recover();
    recovery = setInterval(() => {
      void recover().catch((e) => console.error('Recovery:', e.message));
    }, 15000);
    recovery.unref();
  }
}

export async function enqueue(missionId: string) {
  if (!boss) throw Error('Queue not initialised');
  await boss.send(QUEUE, { missionId }, { singletonKey: missionId, singletonSeconds: 1 });
}

// Reclaim abandoned leases after a worker crash; paused human decisions are not re-enqueued.
async function recover() {
  await db.mission.updateMany({
    where: { status: 'RUNNING', leaseExpiresAt: { lt: new Date() } },
    data: { status: 'QUEUED', leaseToken: null, leaseExpiresAt: null },
  });
  const queued = await db.mission.findMany({
    where: { status: 'QUEUED' },
    select: { id: true },
    take: 100,
  });
  for (const m of queued) await enqueue(m.id);
}

async function executeMission(id: string) {
  if (!workflow) return;
  const lease = randomUUID();

  // Atomic claiming makes duplicate queue deliveries harmless to an already claimed mission.
  const claimed = await db.mission.updateMany({
    where: { id, status: 'QUEUED' },
    data: {
      status: 'RUNNING',
      leaseToken: lease,
      leaseExpiresAt: new Date(Date.now() + 180000),
      error: null,
    },
  });
  if (!claimed.count) return;
  const controller = new AbortController();
  active.set(id, controller);

  // Renew ownership while running, and abort local generation if another action revoked the lease.
  const heartbeat = setInterval(() => {
    void db.mission
      .updateMany({
        where: { id, status: 'RUNNING', leaseToken: lease },
        data: { leaseExpiresAt: new Date(Date.now() + 180000) },
      })
      .then((r) => {
        if (!r.count) controller.abort();
      })
      .catch(() => controller.abort());
  }, 15000);
  heartbeat.unref();
  try {
    const m = await db.mission.findUniqueOrThrow({ where: { id } });
    const result = await workflow.run(id, lease, m.pendingDecision, controller.signal);

    // LangGraph interrupts release the worker while PostgreSQL retains continuation state.
    const waiting = (result as any).__interrupt__?.[0]?.value?.kind as string | undefined;
    let status =
      waiting === 'job'
        ? 'AWAITING_JOB'
        : waiting === 'resume'
          ? 'AWAITING_APPROVAL'
          : waiting === 'interview'
            ? 'AWAITING_INTERVIEW'
            : 'COMPLETE';
    await mutateRun(id, lease, async (tx, current) => {
      if (
        !waiting &&
        Array.isArray((current.data as any).matches) &&
        !(current.data as any).matches.length
      )
        status = 'NO_MATCHES';
      await tx.mission.update({
        where: { id },
        data: {
          status,
          leaseToken: null,
          leaseExpiresAt: null,
          pendingDecision: Prisma.DbNull,
          events: json([
            ...(current.events as unknown as Event[]),
            {
              at: new Date().toISOString(),
              agent: 'Orchestrator',
              action: waiting ? 'waiting' : 'completed',
              detail: waiting
                ? `Waiting for your ${waiting} decision.`
                : 'Career mission completed; interview feedback is available.',
            },
          ]),
        },
      });
    });
  } catch (e) {
    const m = await db.mission.findUnique({ where: { id } });
    if (m?.leaseToken === lease && m.status === 'RUNNING') {
      const message = e instanceof Error ? e.message : 'Task failed.';

      // Preserve useful domain errors without exposing raw provider or database errors to the UI.
      const publicMessage =
        e instanceof JobSourceError
          ? e.message
          : /Live AI requires|Job source|sharing|budget|profile changed|unsupported|evidence|revision limit|Mission unavailable/i.test(
                message,
              )
            ? message
            : 'The specialist could not complete this step. Your approved data and saved answers are preserved. Retry the step or check provider availability.';
      await db.mission.updateMany({
        where: { id, status: 'RUNNING', leaseToken: lease },
        data: {
          status: 'FAILED',
          leaseToken: null,
          leaseExpiresAt: null,
          error: publicMessage,
          events: json([
            ...(m.events as unknown as Event[]),
            {
              at: new Date().toISOString(),
              agent: 'Orchestrator',
              action: 'failed',
              detail: publicMessage,
            },
          ]),
        },
      });
      console.error('Mission step failed:', id, message);
    }
  } finally {
    clearInterval(heartbeat);
    active.delete(id);
  }
}

export async function closeQueue() {
  if (recovery) clearInterval(recovery);
  for (const c of active.values()) c.abort();
  await boss?.stop({ graceful: true, timeout: 10000 });
  await workflow?.close();
  boss = undefined;
  workflow = undefined;
}
