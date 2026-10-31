import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { digest, json, validateResumeClaims, includeRecordHeaders } from './domain.js';
import { composeSelection } from './resume-composition.js';
import { generate, type Mode } from '../../../packages/agents/src/provider.js';
import { checkWording } from '../../../packages/contracts/src/career-evidence.js';
import type { Fact } from '../../../packages/contracts/src/index.js';
import { searchProfileHistory } from './profile-context.js';
import { memoryText } from '../../../packages/contracts/src/career-evidence.js';
import {
  resumeChanges,
  visibleResumeText,
  pendingResumeChanges,
} from '../../../packages/contracts/src/resume-review.js';

export function registerResumeAgent(app: Express) {
  app.post('/api/missions/:id/resume-agent', async (req, res) => {
    const input = z
      .object({ draftHash: z.string(), message: z.string().trim().min(1).max(2000) })
      .parse(req.body);
    const id = String(req.params.id),
      userId = req.actor!.id;
    const m = requireValue(
      await db.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    const d = m.data as any;
    const current = (mission: any, data: any) => {
      if (
        mission.status !== 'AWAITING_APPROVAL' ||
        mission.user.profileVersion !== mission.profile.version ||
        data.resumeDraft?.hash !== input.draftHash
      )
        throw new AppError(
          409,
          'STALE_APPROVAL',
          'The draft changed. Review the current resume and try again.',
        );
    };
    current(m, d);
    if ((d.resumeChat || []).length >= 40)
      throw new AppError(
        429,
        'RESUME_EDIT_LIMIT',
        'This draft has reached its editing limit. Start a new mission to continue.',
      );
    const facts = (m.profile.facts as unknown as Fact[]).filter(
      (f) => ['skill', 'education', 'experience'].includes(f.kind) && !/^none yet$/i.test(f.text),
    );
    const result = await generate(
      'resume-edit',
      {
        goal: input.message,
        facts: facts.map(({ id, kind, text }) => ({ id, kind, text })) as Fact[],
        sourceText: JSON.stringify({
          currentDraft: d.resumeDraft.claims.map((c: any) => ({ factId: c.factId, text: c.text })),
          job: {
            title: d.resumeDraft.jobTitle,
            description: d.selectedJob?.job?.description?.slice(0, 6000),
          },
        }),
      },
      z.object({
        message: z.string().max(1200),
        claims: z
          .array(
            z.object({
              factId: z.string(),
              text: z.string().min(1).max(8000),
              reason: z.string().max(1000),
            }),
          )
          .min(1)
          .max(20),
      }),
      m.mode as Mode,
      {
        onCall: async () => {
          await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
            const latest = requireValue(await tx.mission.findFirst({ where: { id, userId } }));
            const data = latest.data as any;
            if ((data.resumeEditCalls || 0) >= 40)
              throw new AppError(
                429,
                'RESUME_EDIT_LIMIT',
                'This mission has reached its editing limit.',
              );
            await tx.mission.update({
              where: { id },
              data: { data: json({ ...data, resumeEditCalls: (data.resumeEditCalls || 0) + 1 }) },
            });
          });
        },
        onTool: async () => {},
        onUsage: async () => {},
        onSearchHistory: async (query, offset) => {
          const threads = await db.profileThread.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          });
          const memories = await db.careerMemory.findMany({
            where: { userId, status: 'CONFIRMED' },
            orderBy: { updatedAt: 'desc' },
            take: 30,
          });
          return searchProfileHistory(
            [
              ...memories.map((memory) => ({
                id: memory.id,
                text: `${memory.title}: ${memoryText(memory)}`,
              })),
              ...threads.flatMap((t) =>
                (t.messages as any[])
                  .filter((message) => message.role === 'user')
                  .map((message) => ({ id: message.id, text: message.text || '' })),
              ),
            ],
            query,
            offset,
          );
        },
      },
    );
    const claims = validateResumeClaims(
      composeSelection(result.claims, facts, d.selectedJob?.job?.description || ''),
      facts,
    ).map((c) => {
      const proposed = result.claims.find((p) => p.factId === c.factId);
      const previous = d.resumeDraft.claims.find((p: any) => p.factId === c.factId);
      return proposed && !checkWording(c.text, proposed.text)
        ? { ...c, factText: c.text, text: proposed.text }
        : previous && !checkWording(c.text, previous.text)
          ? { ...c, factText: c.text, text: previous.text }
          : c;
    });
    const { hash: _, ...old } = d.resumeDraft;
    const wordingChanges = claims.filter((c) =>
      d.resumeDraft.claims.some(
        (old: any) => old.factId === c.factId && visibleResumeText(old) !== visibleResumeText(c),
      ),
    ).length;
    const selectionChanged =
      JSON.stringify(claims.map((c) => c.factId)) !==
      JSON.stringify(d.resumeDraft.claims.map((c: any) => c.factId));
    const changed = wordingChanges > 0 || selectionChanged;
    const content = { ...old, claims, editRevision: (old.editRevision || 0) + 1 };
    const resumeDraft = changed ? { ...content, hash: digest(content) } : d.resumeDraft;
    const changes = resumeChanges(
      d.resumeDraft.claims,
      resumeDraft.claims,
      pendingResumeChanges(d.resumeDraft, d.resumeChanges),
    );
    const chat = [
      { role: 'user', text: input.message },
      {
        role: 'assistant',
        text:
          wordingChanges || selectionChanged
            ? `${wordingChanges ? `Refined wording in ${wordingChanges} ${wordingChanges === 1 ? 'item' : 'items'}. ` : ''}${selectionChanged ? 'Adjusted the content and ordering for this role. ' : ''}Review the preview before saving.`
            : 'No wording changes needed. The visible resume is unchanged.',
      },
    ];
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
      const latest = requireValue(
        await tx.mission.findFirst({
          where: { id, userId },
          include: { profile: true, user: true },
        }),
      );
      const latestData = latest.data as any;
      current(latest, latestData);
      await tx.mission.update({
        where: { id },
        data: {
          events: json([
            ...(latest.events as any[]),
            {
              at: new Date().toISOString(),
              agent: 'Resume Tailor',
              action: 'draft_edited',
              detail:
                'Updated the unapproved resume through conversation; fresh approval required.',
            },
          ]),
          data: json({
            ...latestData,
            resumeDraft,
            resumeChanges: changes,
            resumeChat: [...(latestData.resumeChat || []), ...chat],
          }),
        },
      });
    });
    res.json({ resumeDraft });
  });
  app.post('/api/missions/:id/resume-agent/restore', async (req, res) => {
    const input = z.object({ draftHash: z.string(), factId: z.string().min(1) }).parse(req.body);
    const id = String(req.params.id),
      userId = req.actor!.id;
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
      const m = requireValue(
        await tx.mission.findFirst({
          where: { id, userId },
          include: { user: true, profile: true },
        }),
      );
      const d = m.data as any;
      if (
        m.status !== 'AWAITING_APPROVAL' ||
        m.user.profileVersion !== m.profile.version ||
        d.resumeDraft?.hash !== input.draftHash
      )
        throw new AppError(
          409,
          'STALE_APPROVAL',
          'The draft changed. Review the current resume and try again.',
        );
      const pending = pendingResumeChanges(d.resumeDraft, d.resumeChanges);
      const change = requireValue(pending.find((c: any) => c.factId === input.factId));
      let claims = d.resumeDraft.claims.filter((c: any) => c.factId !== input.factId);
      if (change.beforeClaim) claims.splice(Math.max(0, change.beforeIndex), 0, change.beforeClaim);
      const facts = m.profile.facts as unknown as Fact[];
      const grounded = validateResumeClaims(includeRecordHeaders(claims, facts), facts);
      claims = grounded.map((c) => claims.find((old: any) => old.factId === c.factId) || c);
      const { hash: _, ...old } = d.resumeDraft;
      const content = { ...old, claims, editRevision: (old.editRevision || 0) + 1 };
      const resumeDraft = { ...content, hash: digest(content) };
      await tx.mission.update({
        where: { id },
        data: {
          data: json({
            ...d,
            resumeDraft,
            resumeChanges: pending.filter((c: any) => c.factId !== input.factId),
          }),
        },
      });
      return { resumeDraft };
    });
    res.json(result);
  });
}
