import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { digest, json, validateResumeClaims, includeRecordHeaders } from './domain.js';
import { applyResumeEdits, resumeEditSchema } from './resume-edits.js';
import { resumeObjective } from '../../../packages/contracts/src/resume-layout.js';
import { generate, type Mode } from '../../../packages/agents/src/provider.js';
import { checkResumeWording } from '../../../packages/contracts/src/resume-grounding.js';
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
        'This draft has reached its editing limit. Tailor this role again from the Quest log.',
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
      resumeEditSchema,
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
                'This run has reached its editing limit.',
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
    )
      .then((result) => resumeEditSchema.parse(result))
      .catch((error) => {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          throw new AppError(
            502,
            'RESUME_EDIT_INVALID_RESPONSE',
            'The AI returned an incomplete edit. Your draft is unchanged. Please try again with a shorter request.',
          );
        if (error?.status === 429)
          throw new AppError(
            429,
            'AI_RATE_LIMIT',
            'The AI provider rate limit was reached. Your draft is unchanged. Please wait before trying again.',
          );
        throw error;
      });
    // Only the lines the AI returned change; every other line stays as it was (CFS-100).
    const claims = applyResumeEdits(d.resumeDraft.claims, result, facts);
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
    const content = {
      ...old,
      claims,
      summary: resumeObjective(old.jobTitle, claims),
      editRevision: (old.editRevision || 0) + 1,
    };
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
            ? `${wordingChanges ? `Refined wording in ${wordingChanges} ${wordingChanges === 1 ? 'item' : 'items'}. ` : ''}${selectionChanged ? 'Updated the selected resume content. ' : ''}Review the preview before saving.`
            : /cannot|can't|unsupported|not supported|not in|no evidence|unverified|would invent|missing evidence/i.test(
                  result.message,
                )
              ? `No changes were applied. ${result.message}`
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
  app.post('/api/missions/:id/resume-agent/manual', async (req, res) => {
    const input = z
      .object({
        draftHash: z.string(),
        factId: z.string().min(1),
        text: z.string().trim().min(1).max(5000),
      })
      .parse(req.body);
    const id = String(req.params.id),
      userId = req.actor!.id;
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Mission" WHERE id=${id} FOR UPDATE`;
      const m = requireValue(
        await tx.mission.findFirst({
          where: { id, userId },
          include: { profile: true, user: true },
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
      requireValue(d.resumeDraft.claims.find((c: any) => c.factId === input.factId));
      const fact = requireValue(
        (m.profile.facts as unknown as Fact[]).find((f) => f.id === input.factId),
      );
      const reason = checkResumeWording(fact.text, input.text);
      if (reason)
        throw new AppError(
          422,
          'UNSUPPORTED_WORDING',
          'This wording changes or adds a fact. Keep the original facts, or update and approve My profile first.',
        );
      const claims = d.resumeDraft.claims.map((c: any) =>
        c.factId === input.factId ? { ...c, factText: fact.text, text: input.text } : c,
      );
      const { hash: _, ...old } = d.resumeDraft;
      const content = {
        ...old,
        claims,
        summary: resumeObjective(old.jobTitle, claims),
        editRevision: (old.editRevision || 0) + 1,
      };
      const resumeDraft = { ...content, hash: digest(content) };
      await tx.mission.update({
        where: { id },
        data: {
          data: json({
            ...d,
            resumeDraft,
            resumeChanges: resumeChanges(
              d.resumeDraft.claims,
              claims,
              pendingResumeChanges(d.resumeDraft, d.resumeChanges),
            ),
          }),
          events: json([
            ...(m.events as any[]),
            {
              at: new Date().toISOString(),
              agent: 'Resume Tailor',
              action: 'manual_wording_edit',
              detail: 'User edited draft wording; fresh resume approval required.',
            },
          ]),
        },
      });
      return { resumeDraft };
    });
    res.json(result);
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
      const content = {
        ...old,
        claims,
        summary: resumeObjective(old.jobTitle, claims),
        editRevision: (old.editRevision || 0) + 1,
      };
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
