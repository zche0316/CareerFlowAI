import { z } from 'zod';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { json, ownedMission, type Event, type MissionData } from './domain.js';
import {
  negotiationDecisionSchema,
  negotiationInputSchema,
  negotiationOutputSchema,
  type CareerProfile,
  type Fact,
} from '../../../packages/contracts/src/index.js';
import { generate, type Mode } from '../../../packages/agents/src/provider.js';

type NegotiationInput = z.infer<typeof negotiationInputSchema>;
type NegotiationDecision = z.infer<typeof negotiationDecisionSchema>;

async function negotiationMission(userId: string, id: string) {
  const mission = requireValue(
    await db.mission.findFirst({
      where: { id, userId },
      include: { profile: true, user: true },
    }),
  );
  if (mission.status !== 'COMPLETE')
    throw new AppError(
      409,
      'NEGOTIATION_NOT_READY',
      'Complete an interview and receive feedback before practising salary negotiation.',
    );
  if (mission.profile.version !== mission.user.profileVersion)
    throw new AppError(
      409,
      'STALE_PROFILE',
      'Your approved profile changed. Start a new mission before practising negotiation.',
    );
  const data = mission.data as MissionData;
  if (!data.selectedJob || !data.feedback)
    throw new AppError(
      409,
      'NEGOTIATION_NOT_READY',
      'An interview feedback record is required before practising salary negotiation.',
    );
  return { mission, data };
}

async function reserveNegotiationCall(userId: string, id: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const mission = requireValue(
      await tx.mission.findFirst({
        where: { id, userId },
        include: { profile: true, user: true },
      }),
    );
    if (mission.status !== 'COMPLETE' || mission.profile.version !== mission.user.profileVersion)
      throw new AppError(409, 'RUN_SUPERSEDED', 'This practice is no longer current.');
    const data = mission.data as MissionData;
    if ((data.apiCalls || 0) >= 12)
      throw new AppError(
        409,
        'BUDGET_REACHED',
        'This mission reached its model-call budget. Start another practice mission.',
      );
    await tx.mission.update({
      where: { id },
      data: { data: json({ ...data, apiCalls: (data.apiCalls || 0) + 1 }) },
    });
  });
}

async function appendNegotiationUsage(userId: string, id: string, input: number, output: number) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const mission = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, select: { data: true } }),
    );
    const data = mission.data as MissionData;
    await tx.mission.update({
      where: { id },
      data: {
        data: json({
          ...data,
          inputTokens: (data.inputTokens || 0) + input,
          outputTokens: (data.outputTokens || 0) + output,
        }),
      },
    });
  });
}

async function failNegotiationRun(userId: string, id: string, error: string) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const mission = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, select: { data: true } }),
    );
    const data = mission.data as MissionData;
    await tx.mission.update({
      where: { id },
      data: {
        data: json({
          ...data,
          negotiationRun: {
            ...(data.negotiationRun || {}),
            status: 'FAILED',
            error,
          },
        }),
      },
    });
  });
}

export async function runNegotiationPractice(userId: string, id: string, input: unknown) {
  const parsed = negotiationInputSchema.parse(input);
  const { mission, data } = await negotiationMission(userId, id);

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const current = requireValue(
      await tx.mission.findFirst({
        where: { id, userId },
        include: { profile: true, user: true },
      }),
    );
    const currentData = current.data as MissionData;
    if (current.status !== 'COMPLETE' || current.profile.version !== current.user.profileVersion)
      throw new AppError(409, 'RUN_SUPERSEDED', 'This practice is no longer current.');
    if (currentData.negotiationRun?.status === 'RUNNING')
      throw new AppError(409, 'NEGOTIATION_RUNNING', 'A negotiation practice is already running.');
    if ((currentData.apiCalls || 0) >= 11)
      throw new AppError(
        409,
        'BUDGET_REACHED',
        'There are not enough remaining model calls for another practice.',
      );
    await tx.mission.update({
      where: { id },
      data: {
        data: json({
          ...currentData,
          negotiationRun: {
            status: 'RUNNING',
            startedAt: new Date().toISOString(),
            input: parsed,
          },
        }),
      },
    });
  });

  try {
    const result = await generate(
      'negotiation',
      {
        goal: mission.goal,
        facts: (mission.profile.facts as unknown as Fact[]).map(({ id, kind, text }) => ({
          id,
          kind,
          text,
        })),
        job: { title: data.selectedJob.job.title, description: data.selectedJob.job.description },
        offerSalary: parsed.offerSalary,
        targetSalary: parsed.targetSalary,
        currency: parsed.currency,
        candidateMessage: parsed.candidateMessage,
      },
      negotiationOutputSchema,
      mission.mode as Mode,
      {
        onCall: () => reserveNegotiationCall(userId, id),
        onTool: async () => {},
        onUsage: (inputTokens, outputTokens) =>
          appendNegotiationUsage(userId, id, inputTokens, outputTokens),
      },
    );

    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
      const current = requireValue(
        await tx.mission.findFirst({
          where: { id, userId },
          include: { profile: true, user: true },
        }),
      );
      if (current.status !== 'COMPLETE' || current.profile.version !== current.user.profileVersion)
        throw new AppError(409, 'RUN_SUPERSEDED', 'This practice is no longer current.');
      const currentData = current.data as MissionData;
      if (currentData.negotiationRun?.status !== 'RUNNING')
        throw new AppError(409, 'NEGOTIATION_RUN_SUPERSEDED', 'This practice was superseded.');
      const negotiation = {
        ...parsed,
        ...result,
        status: 'REVIEW',
        practicedAt: new Date().toISOString(),
      };
      await tx.mission.update({
        where: { id },
        data: {
          data: json({ ...currentData, negotiation, negotiationRun: null }),
          events: json([
            ...(current.events as unknown as Event[]),
            {
              at: new Date().toISOString(),
              agent: 'Interview Coach',
              action: 'negotiation_practised',
              detail:
                'Simulated one fictional salary negotiation and provided practice feedback. No real offer was accepted.',
            },
          ]),
        },
      });
    });
    return ownedMission(userId, id);
  } catch (error) {
    // Log diagnostic categories only: never profile, provider response or credentials.
    console.error('Negotiation practice failed', {
      missionId: id,
      type: error instanceof Error ? error.name : 'UnknownError',
      status: (error as { status?: number })?.status,
      validation:
        error instanceof z.ZodError
          ? error.issues.map(({ path, code }) => ({ path, code }))
          : undefined,
    });
    const message = error instanceof Error ? error.message : 'Negotiation practice failed.';
    const publicMessage = /Live AI requires|budget|profile changed|superseded|sharing/i.test(
      message,
    )
      ? message
      : 'Negotiation practice could not be completed. Your interview feedback and approved data are unchanged. Retry the practice.';
    await failNegotiationRun(userId, id, publicMessage).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError(503, 'NEGOTIATION_UNAVAILABLE', publicMessage);
  }
}

export async function decideNegotiationPractice(userId: string, id: string, input: unknown) {
  const decision = negotiationDecisionSchema.parse(input);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const mission = requireValue(
      await tx.mission.findFirst({
        where: { id, userId },
        include: { profile: true, user: true },
      }),
    );
    if (mission.status !== 'COMPLETE' || mission.profile.version !== mission.user.profileVersion)
      throw new AppError(409, 'STALE_PROFILE', 'This mission no longer uses your current profile.');
    const data = mission.data as MissionData;
    if (!data.negotiation || data.negotiation.status !== 'REVIEW')
      throw new AppError(
        409,
        'NEGOTIATION_DECISION_NOT_READY',
        'Complete a negotiation practice before recording your decision.',
      );
    await tx.mission.update({
      where: { id },
      data: {
        data: json({
          ...data,
          negotiation: {
            ...data.negotiation,
            status: 'DECIDED',
            userDecision: decision.decision,
            decidedAt: new Date().toISOString(),
          },
        }),
        events: json([
          ...(mission.events as unknown as Event[]),
          {
            at: new Date().toISOString(),
            agent: 'Job Seeker',
            action: 'negotiation_decision',
            detail: `Recorded a practice-only decision to ${decision.decision} the hypothetical offer.`,
          },
        ]),
      },
    });
  });
  return ownedMission(userId, id);
}
