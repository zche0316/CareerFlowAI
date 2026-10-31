import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { json } from './domain.js';
import { publicThread } from './profile-conversations.js';
import { AppError, requireValue } from './errors.js';
import { profileSchema } from '../../../packages/contracts/src/index.js';
import { checkWording } from '../../../packages/contracts/src/career-evidence.js';
import { configuredMode, generate } from '../../../packages/agents/src/provider.js';

// Wording is proposed against an exact working snapshot, never silently approved.
export function registerProfilePolish(app: Express) {
  app.post('/api/profile-threads/:id/polish', async (req, res) => {
    const input = z
      .object({
        currentProfile: profileSchema,
        revision: z.number().int(),
        consent: z.literal(true),
      })
      .parse(req.body);
    const userId = req.actor!.id,
      id = String(req.params.id),
      token = randomUUID();
    const sources: {
      key: string;
      text: string;
      field: string;
      recordId?: string;
      line?: number;
    }[] = [];
    for (const field of ['goals', 'education', 'experience'] as const) {
      const text = input.currentProfile[field];
      if (text.trim()) sources.push({ key: field, text, field });
    }
    for (const field of ['workExperiences', 'projects', 'educations'] as const)
      for (const record of input.currentProfile[field] || [])
        record.details.forEach((text, line) =>
          sources.push({
            key: `${field}:${record.id}:${line}`,
            text,
            field,
            recordId: record.id,
            line,
          }),
        );
    let size = 0;
    const selected = sources
      .filter((source) => {
        if (size + source.text.length > 10000) return false;
        size += source.text.length;
        return true;
      })
      .slice(0, 12);
    if (!selected.length)
      throw new AppError(
        422,
        'NO_PROFILE_TEXT',
        'Add a career goal or experience before polishing.',
      );
    const thread = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const t = requireValue(await tx.profileThread.findFirst({ where: { id, userId } }));
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (t.busyToken || t.revision !== input.revision || t.profileVersion !== user.profileVersion)
        throw new AppError(
          409,
          'STALE_PROPOSAL',
          'Your profile or conversation changed. Start a new edit conversation.',
        );
      if ((t.proposals as any[]).some((p) => p.status === 'PENDING'))
        throw new AppError(
          409,
          'PENDING_PROPOSALS',
          'Review the current suggestions before polishing again.',
        );
      const messages = t.messages as any[];
      if (messages.filter((m) => m.kind === 'profile-polish').length >= 10)
        throw new AppError(
          429,
          'POLISH_LIMIT',
          'Start a new edit conversation before requesting more polish.',
        );
      await tx.profileThread.update({
        where: { id },
        data: {
          busyToken: token,
          busyUntil: new Date(Date.now() + 90000),
          revision: { increment: 1 },
        },
      });
      return t;
    });
    try {
      const result = await generate(
        'profile-polish',
        {
          goal: 'Conservative profile wording review',
          facts: [],
          sourceText: JSON.stringify(selected.map(({ key, text }) => ({ key, text }))),
        },
        z.object({
          edits: z
            .array(z.object({ key: z.string(), text: z.string().trim().min(1).max(4000) }))
            .max(12),
        }),
        configuredMode(),
        { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
      );
      const after = structuredClone(input.currentProfile) as any,
        changed = new Map<string, typeof selected>();
      const seen = new Set<string>();
      let blocked = 0;
      for (const edit of result.edits) {
        const source = selected.find((s) => s.key === edit.key);
        if (!source || seen.has(edit.key)) continue;
        seen.add(edit.key);
        if (checkWording(source.text, edit.text)) {
          blocked++;
          continue;
        }
        if (source.text === edit.text) continue;
        if (source.recordId) {
          const record = after[source.field].find((r: any) => r.id === source.recordId);
          record.details[source.line!] = edit.text;
          if (record.overview?.includes(source.text))
            record.overview = record.overview.replace(source.text, edit.text);
          if (record.starStory)
            for (const part of ['situation', 'task', 'action', 'result'])
              if (record.starStory[part]?.includes(source.text))
                record.starStory[part] = record.starStory[part].replace(source.text, edit.text);
          delete record.organisedStory;
        } else after[source.field] = edit.text;
        changed.set(source.field, [...(changed.get(source.field) || []), source]);
      }
      const messageId = randomUUID();
      const proposals = [...changed].map(([field, items]) => ({
        id: randomUUID(),
        field,
        before: (input.currentProfile as any)[field],
        after: after[field],
        status: 'PENDING',
        evidence: items.map((source) => ({
          quote: source.text,
          messageId,
          memoryRef: null,
          profileRef: null,
        })),
      }));
      const now = new Date().toISOString();
      const reply = proposals.length
        ? `Prepared wording changes for ${proposals.length} profile block${proposals.length === 1 ? '' : 's'}. Review them before saving.`
        : 'No supported wording changes were needed. Your profile is unchanged.';
      const messages = [
        ...(thread.messages as any[]),
        {
          id: messageId,
          role: 'user',
          text: 'Polish my profile.',
          kind: 'profile-polish',
          profileSnapshot: input.currentProfile,
          at: now,
        },
        {
          id: randomUUID(),
          role: 'assistant',
          text:
            reply +
            (blocked
              ? ' Some rewrites were left out because they changed the source wording too far.'
              : '') +
            (selected.length < sources.length
              ? ` Reviewed ${selected.length} of ${sources.length} text blocks; the others are unchanged.`
              : ''),
          questions: [],
          at: now,
        },
      ];
      const saved = await db.profileThread.updateMany({
        where: { id, userId, busyToken: token },
        data: {
          messages: json(messages),
          proposals: json([...(thread.proposals as any[]), ...proposals]),
          workingForm: json(input.currentProfile),
          busyToken: null,
          busyUntil: null,
          revision: { increment: 1 },
        },
      });
      if (!saved.count)
        throw new AppError(
          409,
          'STALE_PROPOSAL',
          'Conversation changed. Reload before continuing.',
        );
      // Reuse the public thread projection rather than exposing processing fields.
      const t = requireValue(await db.profileThread.findFirst({ where: { id, userId } }));
      res.json(publicThread(t));
    } catch (error) {
      await db.profileThread.updateMany({
        where: { id, userId, busyToken: token },
        data: { busyToken: null, busyUntil: null, revision: { increment: 1 } },
      });
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'POLISH_UNAVAILABLE',
        'Could not polish your profile. Your profile is unchanged. Start a new edit conversation and retry.',
      );
    }
  });
}
