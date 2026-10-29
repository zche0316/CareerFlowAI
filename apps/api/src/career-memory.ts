import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { json } from './domain.js';
import { AppError, requireValue } from './errors.js';
import {
  memorySchema,
  memoryText,
  profileRecordSources,
  rankEvidence,
} from '../../../packages/contracts/src/career-evidence.js';

export async function retrieveEvidence(
  userId: string,
  query: string,
  scope: { recordId?: string; missionId?: string; includeMemories?: boolean } = {},
) {
  const [profile, memories] = await Promise.all([
    db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } }),
    db.careerMemory.findMany({
      where: { userId, status: 'CONFIRMED' },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const rows = [
    ...((profile?.facts as any[] | undefined) || []).map((f) => ({
      id: `profile:${profile!.version}:${f.id}`,
      text: f.text as string,
      recordId: f.recordId || null,
      missionId: null,
      source: f.source,
      kind: 'approved-profile',
    })),
    ...(scope.includeMemories === false ? [] : memories).map((m) => ({
      id: `memory:${m.id}:${m.revision}`,
      text: `${m.title}\n${memoryText(m)}`,
      recordId: m.recordId,
      missionId: m.missionId,
      source: m.source,
      kind: (m.source as any)?.kind === 'interview' ? 'advisory-feedback' : 'confirmed-memory',
    })),
  ];
  const hits = rankEvidence(rows, query, scope);
  return {
    strategy: 'owner-scoped-keyword-v1',
    query,
    hits,
    insufficientRecall: hits.length === 0,
    searched: rows.length,
    notice: hits.length
      ? 'Confirmed memories are user-attested, not independently verified qualifications.'
      : 'No keyword match. Try another term or add evidence; no facts were invented.',
  };
}

export async function validateMemorySource(
  userId: string,
  input: z.infer<typeof memorySchema>,
  client: any = db,
) {
  const source = input.source;
  let text = '';
  if (source.kind === 'user') text = source.quote; // Explicitly user-attested source, not external verification.
  if (source.kind === 'conversation') {
    const [threadId, messageId] = source.id.split('/');
    const thread = requireValue(
      await client.profileThread.findFirst({ where: { id: threadId, userId } }),
    );
    text =
      (thread.messages as any[]).find((m) => m.id === messageId && m.role === 'user')?.text || '';
  }
  if (source.kind === 'interview') {
    const m = requireValue(await client.mission.findFirst({ where: { id: source.id, userId } }));
    const feedback = (m.data as any).feedback;
    text = feedback
      ? [...feedback.strengths, ...feedback.improvements, ...feedback.nextSteps].join('\n')
      : '';
  }
  if (source.kind === 'profile') {
    const p = requireValue(await client.profile.findFirst({ where: { id: source.id, userId } }));
    text = [
      ...(p.facts as any[]).map((f) => f.text),
      ...Object.values(p.data as any).filter((v) => typeof v === 'string'),
    ].join('\n');
  }
  if (source.kind === 'import') {
    const p = requireValue(
      await client.profileImport.findFirst({ where: { id: source.id, userId } }),
    );
    text = (p.pages as any[]).map((p) => p.text).join('\n');
  }
  if (!text.includes(source.quote))
    throw new AppError(
      422,
      'INVALID_MEMORY_SOURCE',
      'Source quote must occur in your own saved source.',
    );
  for (const ref of source.references || []) {
    const thread = requireValue(
      await client.profileThread.findFirst({ where: { id: ref.threadId, userId } }),
    );
    if (
      !(thread.messages as any[]).some(
        (m) => m.id === ref.messageId && m.role === 'user' && m.text.includes(ref.quote),
      )
    )
      throw new AppError(
        422,
        'INVALID_MEMORY_SOURCE',
        'A supporting conversation source is unavailable.',
      );
  }
  if (input.missionId)
    requireValue(await client.mission.findFirst({ where: { id: input.missionId, userId } }));
  if (input.recordId) {
    const p = requireValue(
      await client.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } }),
    );
    if (!profileRecordSources(p.data).some((r) => r.id === input.recordId))
      throw new AppError(
        422,
        'INVALID_RECORD',
        'Select a record from your current approved profile.',
      );
  }
}

export function registerCareerMemory(app: Express) {
  app.get('/api/career-memories', async (req, res) => {
    const userId = req.actor!.id;
    const [memories, profile, missions] = await Promise.all([
      db.careerMemory.findMany({
        where: { userId, status: { not: 'DELETED' } },
        orderBy: { createdAt: 'desc' },
      }),
      db.profile.findFirst({ where: { userId }, orderBy: { version: 'desc' } }),
      db.mission.findMany({
        where: { userId },
        select: { id: true, goal: true },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);
    res.json({ memories, records: profileRecordSources(profile?.data || {}), missions });
  });
  app.post('/api/career-memories', async (req, res) => {
    const userId = req.actor!.id,
      input = memorySchema.parse(req.body);
    await validateMemorySource(userId, input);
    if ((await db.careerMemory.count({ where: { userId } })) >= 500)
      throw new AppError(409, 'MEMORY_LIMIT', 'This workspace supports 500 memory versions.');
    res.status(201).json(
      await db.$transaction(async (tx) => {
        if (input.supersedesId) {
          const prior = requireValue(
            await tx.careerMemory.findFirst({ where: { id: input.supersedesId, userId } }),
          );
          if (!['DRAFT', 'CONFIRMED'].includes(prior.status))
            throw new AppError(
              409,
              'STALE_MEMORY',
              'This memory was already corrected or deleted.',
            );
        }
        return tx.careerMemory.create({
          data: { ...input, userId, star: json(input.star), source: json(input.source) },
        });
      }),
    );
  });
  app.patch('/api/career-memories/:id', async (req, res) => {
    const input = z
      .object({ revision: z.number().int(), reviewed: z.literal(true) })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        const m = requireValue(
          await tx.careerMemory.findFirst({
            where: { id: String(req.params.id), userId: req.actor!.id },
          }),
        );
        // Lock before all source checks so concurrent corrections cannot both win.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${m.userId} FOR UPDATE`;
        if (m.status !== 'DRAFT' || m.revision !== input.revision)
          throw new AppError(409, 'STALE_MEMORY', 'Review the current draft memory.');
        if (
          m.kind === 'STAR' &&
          ['situation', 'task', 'action'].some((k) => !(m.star as any)[k]?.trim())
        )
          throw new AppError(
            422,
            'STAR_CONTEXT_REQUIRED',
            'Add the situation, task and your own action before confirming. The result may remain unknown.',
          );
        await validateMemorySource(
          m.userId,
          memorySchema.parse({ ...m, source: m.source, star: m.star }),
          tx,
        );
        let predecessor = m.supersedesId;
        const visited = new Set([m.id]);
        while (predecessor) {
          if (visited.has(predecessor))
            throw new AppError(409, 'MEMORY_CYCLE', 'Invalid correction ancestry.');
          visited.add(predecessor);
          const prior = requireValue(
            await tx.careerMemory.findFirst({ where: { id: predecessor, userId: m.userId } }),
          );
          if (!['DRAFT', 'CONFIRMED'].includes(prior.status))
            throw new AppError(
              409,
              'STALE_MEMORY',
              'Another correction already replaced or deleted this memory.',
            );
          await tx.careerMemory.update({
            where: { id: prior.id },
            data: { status: 'SUPERSEDED', revision: { increment: 1 } },
          });
          if (prior.status === 'CONFIRMED') break;
          predecessor = prior.supersedesId;
        }
        const changed = await tx.careerMemory.updateMany({
          where: { id: m.id, userId: m.userId, revision: input.revision, status: 'DRAFT' },
          data: { status: 'CONFIRMED', revision: { increment: 1 } },
        });
        if (!changed.count) throw new AppError(409, 'STALE_MEMORY', 'Memory changed; reload it.');
        return tx.careerMemory.findUniqueOrThrow({ where: { id: m.id } });
      }),
    );
  });
  app.delete('/api/career-memories/:id', async (req, res) => {
    const revision = z.number().int().parse(req.body.revision);
    const changed = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor!.id} FOR UPDATE`;
      return tx.careerMemory.updateMany({
        where: {
          id: String(req.params.id),
          userId: req.actor!.id,
          revision,
          status: { not: 'DELETED' },
        },
        data: {
          status: 'DELETED',
          revision: { increment: 1 },
          title: 'Deleted memory',
          text: '',
          star: {},
          source: {},
        },
      });
    });
    if (!changed.count)
      throw new AppError(409, 'STALE_MEMORY', 'Memory changed or is unavailable.');
    res.json({
      ok: true,
      notice:
        'Removed from future retrieval. Previously approved profile/document snapshots remain historical records.',
    });
  });
  app.get('/api/career-evidence', async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().min(1).max(500),
        recordId: z.string().max(80).optional(),
        missionId: z.string().uuid().optional(),
      })
      .parse(req.query);
    if (q.missionId)
      requireValue(
        await db.mission.findFirst({ where: { id: q.missionId, userId: req.actor!.id } }),
      );
    res.json(await retrieveEvidence(req.actor!.id, q.q, q));
  });
}
