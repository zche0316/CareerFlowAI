import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { digest, json } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { profileSchema } from '../../../packages/contracts/src/index.js';
import {
  recordKeys,
  recordSchema,
  storyFingerprint,
} from '../../../packages/contracts/src/profile-records.js';
import { generate, configuredMode } from '../../../packages/agents/src/provider.js';

export const storyLabels = {
  background: 'Background',
  responsibility: 'Personal responsibility',
  action: 'Personal actions',
  result: 'Outcomes (individual or team as stated)',
  reflection: 'Learning & reflection',
  other: 'Additional context',
};
const storySchema = z.object({
  groups: z
    .array(
      z.object({
        category: z.enum([
          'background',
          'responsibility',
          'action',
          'result',
          'reflection',
          'other',
        ]),
        items: z
          .array(
            z.object({ sourceIndices: z.array(z.number().int().min(0).max(19)).min(1).max(20) }),
          )
          .max(20),
      }),
    )
    .max(6),
});
export function validateStory(result: z.infer<typeof storySchema>, details: string[]) {
  const categories = new Set<string>();
  const groups = result.groups.map((group) => {
    if (categories.has(group.category))
      throw new AppError(422, 'DUPLICATE_CATEGORY', 'Each story category should appear once.');
    categories.add(group.category);
    return {
      ...group,
      items: group.items.map((item) => {
        if (
          !item.sourceIndices.length ||
          item.sourceIndices.some((i) => !Number.isInteger(i) || !details[i])
        )
          throw new AppError(
            422,
            'UNSUPPORTED_STORY',
            'An organised statement does not match its original answer. Your draft is unchanged.',
          );
        // Model selects and groups source indices; it cannot rewrite facts. Strip only field-label scaffolding.
        const excerpts = [...new Set(item.sourceIndices)].map((i) =>
          details[i].replace(
            /^(?:Background|Personal responsibility|Personal actions|Team outcomes|Outcomes|Tools|Reflection):\s*/i,
            '',
          ),
        );
        const normal = (s: string) =>
          s
            .toLowerCase()
            .replace(/^i /, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
        const text = excerpts
          .filter(
            (s, i) =>
              !excerpts.some(
                (other, j) =>
                  j !== i &&
                  normal(s).length >= 6 &&
                  normal(other).length > normal(s).length &&
                  normal(other).includes(normal(s)),
              ),
          )
          .join(' ');
        return { text, sourceIndices: item.sourceIndices };
      }),
    };
  });
  if (!groups.some((g) => g.items.length))
    throw new AppError(
      422,
      'EMPTY_STORY',
      'No organised details were returned. Your original answers are unchanged.',
    );
  return { groups };
}
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
const hash = (v: any) => digest(canonical(v ?? []));
export function registerExperienceOrganisation(app: Express) {
  app.post('/api/profile-threads/:id/organise', async (req, res) => {
    const input = z
      .object({
        revision: z.number().int(),
        recordId: z.string().min(1).max(80),
        recordSection: z.enum(['workExperiences', 'projects']),
        consent: z.literal(true),
        currentProfile: z.object({
          ...profileSchema.shape,
          name: z.string().max(100),
          goals: z.string().max(2000),
        }),
      })
      .parse(req.body);
    const userId = req.actor!.id,
      id = String(req.params.id);
    const t = requireValue(await db.profileThread.findFirst({ where: { id, userId } }));
    if (t.revision !== input.revision || (t.busyUntil && t.busyUntil > new Date()))
      throw new AppError(409, 'THREAD_BUSY', 'The conversation changed. Reload before organising.');
    const pending = (t.proposals as any[]).filter(
      (p) =>
        p.status === 'PENDING' && hash((input.currentProfile as any)[p.field]) === hash(p.before),
    );
    const working: any = Object.assign(
      {},
      input.currentProfile,
      ...pending.map((p) => ({ [p.field]: p.after })),
    );
    const section = input.recordSection;
    if (!section)
      throw new AppError(422, 'INVALID_RECORD', 'Choose an experience from the current draft.');
    if ((section as string) === 'educations')
      throw new AppError(
        422,
        'EDUCATION_STORY',
        'Education needs qualification fields, not a contribution story.',
      );
    const record = (working[section] || []).find((r: any) => r.id === input.recordId);
    if (!record)
      throw new AppError(422, 'INVALID_RECORD', 'Choose an experience from the current draft.');
    if (!record.details.length)
      throw new AppError(
        422,
        'NO_ANSWERS',
        'Add your background and contribution before organising.',
      );
    // Validate all owned references before transmitting to the configured provider.
    for (const ref of record.conversationEvidence || []) {
      const source = await db.profileThread.findFirst({ where: { id: ref.threadId, userId } });
      if (
        !(source?.messages as any[] | undefined)?.some(
          (m) => m.id === ref.messageId && m.role === 'user' && m.text.includes(ref.quote),
        )
      )
        throw new AppError(422, 'INVALID_SOURCE', 'A conversation source no longer matches.');
    }
    if ((await db.careerMemory.count({ where: { userId } })) >= 500)
      throw new AppError(409, 'MEMORY_LIMIT', 'This workspace supports 500 memory versions.');
    const hasStar = Object.values(record.starStory || {}).some(Boolean);
    let result;
    try {
      const starGroups = hasStar
        ? (['situation', 'task', 'action', 'result'] as const)
            .filter((part) => record.starStory[part])
            .map((part) => ({
              category: (
                {
                  situation: 'background',
                  task: 'responsibility',
                  action: 'action',
                  result: 'result',
                } as const
              )[part],
              items: [
                {
                  sourceIndices: record.details.flatMap((line: string, index: number) =>
                    record.starStory[part].includes(line) || line.includes(record.starStory[part])
                      ? [index]
                      : [],
                  ),
                },
              ],
            }))
        : [];
      result = validateStory(
        starGroups.length && starGroups.every((g) => g.items[0].sourceIndices.length)
          ? { groups: starGroups }
          : await generate(
              'organiser',
              {
                goal: 'Group complete experience answers with source-linked labels, without resume compression.',
                facts: [],
                sourceText: JSON.stringify(record.details),
                profileBase: {
                  title: record.title,
                  organisation: record.organisation,
                  startMonth: record.startMonth,
                  endMonth: record.endMonth,
                  technologies: record.technologies,
                },
              },
              storySchema,
              configuredMode(),
              { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
            ),
        record.details,
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        503,
        'ORGANISATION_FAILED',
        'Could not organise this experience. Your original answers and draft are unchanged. Retry explicitly.',
      );
    }
    const sourceHash = storyFingerprint(record.details),
      story = { sourceHash, groups: result.groups };
    const organised = { ...record, organisedStory: story };
    const after = working[section].map((r: any) => (r.id === record.id ? organised : r));
    const refs = record.conversationEvidence || [],
      first = refs[0];
    const text = [
      `${record.title}\n${record.organisation}\n${record.startMonth || 'Unknown start'} – ${record.current ? 'Present' : record.endMonth || 'Unknown end'}`,
      ...result.groups
        .filter((g) => g.items.length)
        .map((g) => `${storyLabels[g.category]}\n${g.items.map((i) => '- ' + i.text).join('\n')}`),
      record.technologies.length ? 'Technologies: ' + record.technologies.join(', ') : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (text.length > 4000)
      throw new AppError(
        422,
        'MEMORY_SIZE',
        'The organised story exceeds the memory limit. Original answers remain available.',
      );
    res.json(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
        const live = requireValue(await tx.profileThread.findFirst({ where: { id, userId } }));
        if (live.revision !== input.revision || (live.busyUntil && live.busyUntil > new Date()))
          throw new AppError(
            409,
            'THREAD_BUSY',
            'The draft changed during organisation. Retry using the current draft.',
          );
        const source = first
          ? {
              kind: 'conversation',
              id: `${first.threadId}/${first.messageId}`,
              quote: first.quote,
              references: refs,
              organisationKey: `${id}/${section}/${record.id}/${sourceHash}`,
            }
          : {
              kind: 'user',
              id: record.id,
              quote: record.details.join('\n').slice(0, 10000),
              organisationKey: `${id}/${section}/${record.id}/${sourceHash}`,
            };
        const existing = (
          await tx.careerMemory.findMany({ where: { userId, status: 'DRAFT' } })
        ).find((m) => (m.source as any).organisationKey === source.organisationKey);
        const memory = existing
          ? existing.text === text
            ? existing
            : await tx.careerMemory.update({
                where: { id: existing.id },
                data: {
                  text,
                  ...(hasStar ? { kind: 'STAR', star: json(record.starStory) } : {}),
                  revision: { increment: 1 },
                },
              })
          : await tx.careerMemory.create({
              data: {
                userId,
                kind: hasStar ? 'STAR' : 'NOTE',
                recordId: record.id,
                title: (hasStar ? 'Example: ' + record.title : record.title).slice(0, 180),
                text,
                star: json(record.starStory || { situation: '', task: '', action: '', result: '' }),
                source: json(source),
              },
            });
        const proposal = {
          id: randomUUID(),
          field: section,
          before: (input.currentProfile as any)[section],
          after,
          evidence: refs.map((e: any) => ({ ...e, memoryRef: null, profileRef: null })),
          status: 'PENDING',
        };
        const updated = await tx.profileThread.update({
          where: { id },
          data: {
            revision: { increment: 1 },
            workingForm: json(input.currentProfile),
            proposals: json([
              ...(live.proposals as any[]).map((p) =>
                p.field === section && p.status === 'PENDING' ? { ...p, status: 'SUPERSEDED' } : p,
              ),
              proposal,
            ]),
            messages: json([
              ...(live.messages as any[]),
              {
                id: randomUUID(),
                role: 'assistant',
                text: `Organised ${record.title} into labelled sections and saved a draft memory. Review the suggested details before using them. Original answers are retained.`,
                questions: [],
                at: new Date().toISOString(),
                memoryDraftId: memory.id,
                interviewState: [...(live.messages as any[])]
                  .reverse()
                  .find((m) => m.interviewState)?.interviewState,
              },
            ]),
          },
        });
        return { memoryId: memory.id, revision: updated.revision };
      }),
    );
  });
}
