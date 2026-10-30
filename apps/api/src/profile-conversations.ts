import type { Express } from 'express';
import { labelledExperience } from './labelled-experience.js';
import {
  interviewState,
  interviewIntent,
  planInterview,
  transitionInterview,
  experiences,
  closedExperience,
  type InterviewAction,
} from '../../../packages/contracts/src/profile-interview.js';
import {
  sourceStatements,
  careerTitle,
} from '../../../packages/contracts/src/conversation-source.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { digest, json } from './domain.js';
import { AppError, requireValue } from './errors.js';
import { prepareProfileBuilderDraft, citeExactUserValues } from './profile-builder.js';
import { retrieveEvidence } from './career-memory.js';
import {
  blankProfile,
  profileSchema,
  profileBuilderDraftSchema,
} from '../../../packages/contracts/src/index.js';
import { nextProfileQuestions } from '../../../packages/contracts/src/career-evidence.js';
import { recordKeys, recordSchema } from '../../../packages/contracts/src/profile-records.js';
import {
  importedRecordSchema,
  dateSupported,
  groundImportedRecords,
} from '../../../packages/agents/src/import-model.js';
import { generate, configuredMode } from '../../../packages/agents/src/provider.js';

const formSchema = z.object({
  ...profileSchema.shape,
  name: z.string().max(100),
  goals: z.string().max(2000),
});
const owner = (userId: string, id: string) =>
  db.profileThread.findFirst({ where: { id, userId } }).then(requireValue);
// PostgreSQL JSONB reorders object keys. Compare values, not serialization order.
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
const fieldDigest = (value: unknown) => digest(canonical(value ?? []));
const hasQuote = (text: string, quote: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').includes(quote.toLowerCase().replace(/\s+/g, ' '));
const interviewProfile = (t: any, profile = t.workingForm) =>
  Object.assign(
    {},
    profile,
    ...(t.proposals as any[])
      .filter(
        (p) => p.status === 'PENDING' && fieldDigest(profile[p.field]) === fieldDigest(p.before),
      )
      .map((p) => ({ [p.field]: p.after })),
  );
// Never resend nested evidence and organised copies of the same answers to the model.
// Source messages below are authoritative; the profile is only a compact identity/context index.
export const conversationModelProfile = (profile: any) => ({
  ...Object.fromEntries(
    Object.entries(profile).filter(([key]) => !recordKeys.includes(key as any)),
  ),
  ...Object.fromEntries(
    recordKeys.map((key) => [
      key,
      (profile[key] || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        organisation: r.organisation,
        location: r.location,
        startMonth: r.startMonth,
        endMonth: r.endMonth,
        current: r.current,
        technologies: r.technologies,
        details: (r.details || []).slice(0, 4).map((s: string) => s.slice(0, 160)),
      })),
    ]),
  ),
});
const publicThread = (t: any) => ({
  ...t,
  busyToken: undefined,
  busyUntil: undefined,
  interview: interviewState(t.messages, interviewProfile(t)),
  hasUnfiledExperience: interviewState(t.messages, interviewProfile(t)).closed.some(
    (key) => !experiences(interviewProfile(t)).some((r) => closedExperience([key], r.key)),
  ),
  interviewRecords: [
    ...experiences(interviewProfile(t)).map((r) => ({ key: r.key, title: r.title })),
    ...interviewState(t.messages, interviewProfile(t))
      .closed.filter(
        (key) => !experiences(interviewProfile(t)).some((r) => closedExperience([key], r.key)),
      )
      .map((key) => ({ key, title: key.split(':')[1], historical: true })),
  ],
  processing: !!t.busyToken && t.busyUntil > new Date(),
});
const conversationRecordSchema = importedRecordSchema.extend({
  evidence: z
    .array(z.object({ page: z.number().int().min(1).max(30), quote: z.string().min(1).max(6000) }))
    .min(1)
    .max(10),
});
const assistantSchema = z.object({
  builder: profileBuilderDraftSchema,
  records: z.array(conversationRecordSchema).max(10),
  reply: z.string().max(1500).optional(),
});

async function controlInterview(
  userId: string,
  id: string,
  input: {
    currentProfile: any;
    revision: number;
    action: InterviewAction;
    recordKey?: string;
    text?: string;
  },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const t = requireValue(await tx.profileThread.findFirst({ where: { id, userId } }));
    if (t.revision !== input.revision || (t.busyToken && t.busyUntil && t.busyUntil > new Date()))
      throw new AppError(
        409,
        'THREAD_BUSY',
        'Conversation changed or is processing. Reload before changing the interview.',
      );
    const p = interviewProfile(t, input.currentProfile),
      state = interviewState(t.messages as any[], p);
    if (input.recordKey && !experiences(p).some((r) => r.key === input.recordKey))
      throw new AppError(422, 'INVALID_RECORD', 'Choose an experience from this conversation.');
    transitionInterview(state, input.action, p, input.recordKey);
    const plan = planInterview(p, state);
    const messages = [
      ...(t.messages as any[]),
      {
        id: randomUUID(),
        role: 'user',
        kind: 'interview-control',
        text:
          input.text ||
          {
            finish_experience: 'Finish this experience',
            next_experience: 'Add another experience',
            finish_interview: 'Finish interview and review',
            skip_question: 'Skip this question',
            resume: 'Resume interview',
            keep_current_draft: 'Keep my current draft',
          }[input.action],
        at: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        role: 'assistant',
        text:
          input.action === 'finish_experience' || input.action === 'next_experience'
            ? 'This experience is finished for now. Its content and pending suggestions are retained; I will not ask more about it unless you reopen it.'
            : plan.hint,
        questions: plan.state.question ? [plan.state.question.text] : [],
        interviewState: plan.state,
        at: new Date().toISOString(),
      },
    ];
    const proposals = (t.proposals as any[]).map((p) =>
      input.action === 'keep_current_draft' && p.status === 'PENDING'
        ? { ...p, status: 'REJECTED' }
        : p,
    );
    const updated = await tx.profileThread.updateMany({
      where: {
        id,
        userId,
        revision: input.revision,
        OR: [{ busyToken: null }, { busyUntil: { lt: new Date() } }],
      },
      data: {
        messages: json(messages),
        proposals: json(proposals),
        workingForm: json(input.currentProfile),
        busyToken: null,
        busyUntil: null,
        revision: { increment: 1 },
      },
    });
    if (!updated.count)
      throw new AppError(
        409,
        'THREAD_BUSY',
        'The interview changed while this control was being saved. Reload before continuing.',
      );
    return publicThread(await tx.profileThread.findUniqueOrThrow({ where: { id } }));
  });
}
export function registerProfileConversations(app: Express) {
  app.get('/api/profile-threads', async (req, res) =>
    res.json(
      await db.profileThread.findMany({
        where: { userId: req.actor!.id },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { id: true, title: true, updatedAt: true },
      }),
    ),
  );
  app.get('/api/profile-threads/:id', async (req, res) =>
    res.json(publicThread(await owner(req.actor!.id, String(req.params.id)))),
  );
  app.post('/api/profile-threads', async (req, res) => {
    const input = z
      .object({
        currentProfile: formSchema,
        title: z.string().trim().min(1).max(100).default('Career profile conversation'),
      })
      .parse(req.body);
    const userId = req.actor!.id;
    if ((await db.profileThread.count({ where: { userId } })) >= 30)
      throw new AppError(409, 'THREAD_LIMIT', 'This workspace supports 30 saved conversations.');
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const firstPlan = planInterview(input.currentProfile, interviewState([], input.currentProfile));
    res.status(201).json(
      publicThread(
        await db.profileThread.create({
          data: {
            userId,
            title: input.title,
            profileVersion: user.profileVersion,
            workingForm: json(input.currentProfile),
            proposals: [],
            messages: json([
              {
                id: randomUUID(),
                role: 'assistant',
                at: new Date().toISOString(),
                text: 'Let’s start with your direction. You can use course projects, personal projects, volunteering or work; no resume is required.',
                questions: firstPlan.state.question ? [firstPlan.state.question.text] : [],
                interviewState: firstPlan.state,
              },
            ]),
          },
        }),
      ),
    );
  });
  app.post('/api/profile-threads/:id/controls', async (req, res) => {
    const input = z
      .object({
        currentProfile: formSchema,
        revision: z.number().int(),
        action: z.enum([
          'finish_experience',
          'next_experience',
          'finish_interview',
          'skip_question',
          'resume',
          'keep_current_draft',
        ]),
        recordKey: z.string().optional(),
      })
      .parse(req.body);
    res.json(await controlInterview(req.actor!.id, String(req.params.id), input));
  });
  app.post('/api/profile-threads/:id/messages', async (req, res) => {
    const input = z
      .object({
        text: z.string().trim().min(1).max(4000),
        currentProfile: formSchema,
        revision: z.number().int(),
        consent: z.literal(true),
        retryMessageId: z.string().uuid().optional(),
        recoverSavedAnswers: z.literal(true).optional(),
      })
      .parse(req.body);
    const userId = req.actor!.id,
      t = await owner(userId, String(req.params.id));
    const messages = t.messages as any[];
    const action = interviewIntent(input.text);
    if (action && !input.retryMessageId && !input.recoverSavedAnswers) {
      res.json(await controlInterview(userId, t.id, { ...input, action }));
      return;
    }
    const previousState = interviewState(messages, interviewProfile(t, input.currentProfile));
    const lastAnswer = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && m.kind !== 'interview-control' && !interviewIntent(m.text));
    if (
      input.retryMessageId &&
      (lastAnswer?.id !== input.retryMessageId ||
        !messages.at(-1)?.failed ||
        lastAnswer.text !== input.text)
    )
      throw new AppError(409, 'STALE_RETRY', 'Only the latest failed saved answer can be retried.');
    if (input.recoverSavedAnswers && (previousState.phase !== 'review' || !lastAnswer))
      throw new AppError(
        409,
        'RECOVERY_STAGE',
        'Finish the interview before organising saved answers.',
      );
    if (previousState.phase === 'review' && !input.retryMessageId && !input.recoverSavedAnswers)
      throw new AppError(
        409,
        'INTERVIEW_FINISHED',
        'Resume the interview before sending another answer.',
      );
    if (!input.retryMessageId && !input.recoverSavedAnswers && previousState.question)
      previousState.addressed = [
        ...new Set([...previousState.addressed, previousState.question.key]),
      ];

    if (
      !input.retryMessageId &&
      !input.recoverSavedAnswers &&
      messages.filter((m) => m.role === 'user' && m.kind !== 'interview-control').length >= 30
    )
      throw new AppError(409, 'TURN_LIMIT', 'Start a new conversation after 30 turns.');
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const token = randomUUID(),
      message = {
        id: randomUUID(),
        role: 'user',
        text: input.text,
        answerTag: input.recoverSavedAnswers
          ? undefined
          : interviewState(messages, interviewProfile(t, input.currentProfile)).question?.key,
        experienceKey: previousState.active,
        fieldTags: input.text
          .split('\n')
          .flatMap((line) => /^([A-Za-z ]+):/.exec(line)?.[1]?.toLowerCase() || []),
        at: new Date().toISOString(),
      };
    const updatedMessages =
      input.retryMessageId || input.recoverSavedAnswers ? messages : [...messages, message];
    const answerId = input.retryMessageId || message.id;
    const acquired = await db.profileThread.updateMany({
      where: {
        id: t.id,
        userId,
        revision: input.revision,
        OR: [{ busyToken: null }, { busyUntil: { lt: new Date() } }],
      },
      data: {
        busyToken: token,
        busyUntil: new Date(Date.now() + 90000),
        revision: { increment: 1 },
        workingForm: json(input.currentProfile),
        messages: json(updatedMessages),
        profileVersion: user.profileVersion,
      },
    });
    if (!acquired.count)
      throw new AppError(
        409,
        'THREAD_BUSY',
        'Conversation changed or is processing. Reload before sending again.',
      );
    let response: any;
    let processingStage = 'model-response';
    try {
      const sourceMessages: any[] = [];
      let sourceSize = 0;
      for (const item of updatedMessages
        .filter(
          (m) => m.role === 'user' && m.kind !== 'interview-control' && !interviewIntent(m.text),
        )
        .slice(-30)
        .reverse()) {
        // Keep a contiguous recent window, including the current/retried answer.
        // The full conversation remains saved in updatedMessages.
        if (sourceSize + item.text.length > 18000) break;
        sourceMessages.unshift(item);
        sourceSize += item.text.length;
      }
      const pages = sourceMessages.map((m, i) => ({
        page: i + 1,
        text: m.text,
        route: 'text' as const,
        method: 'plain-text' as const,
      }));
      const modelNotes: string[] = [];
      let modelNoteSize = 0;
      for (let i = sourceMessages.length - 1; i >= 0; i--) {
        const text = `Message ${i + 1}: ${sourceMessages[i].text}`;
        if (modelNoteSize + text.length > 9000) break;
        modelNotes.unshift(text);
        modelNoteSize += text.length;
      }
      const notes = modelNotes.join('\n');
      const evidence = await retrieveEvidence(
        userId,
        input.recoverSavedAnswers ? input.currentProfile.goals : input.text,
      );
      const answerPage = sourceMessages.findIndex((m) => m.id === answerId) + 1;
      const labelled =
        !input.recoverSavedAnswers && answerPage > 0
          ? labelledExperience(input.text, answerPage)
          : null;
      const result = labelled
        ? {
            builder: profileBuilderDraftSchema.parse({
              draft: {},
              proposedChanges: [],
              followUpQuestions: [],
            }),
            records: [conversationRecordSchema.parse(labelled)],
            reply:
              'Your labelled answers are ready for review. Finish this experience to organise the story and save a draft memory.',
          }
        : await generate(
            'conversation',
            {
              goal: input.recoverSavedAnswers
                ? 'Prepare complete structured profile/project records from the saved user answers. Include finished experiences that are missing from the current draft. Do not ask questions. Do not approve or apply changes.'
                : 'Build an editable career profile through a sustained interview.',
              prepareSavedAnswers: Boolean(input.recoverSavedAnswers),
              facts: [],
              profileNotes: notes,
              profileBase: conversationModelProfile(input.currentProfile),
              interviewControl: previousState,
              conversationHistory: updatedMessages
                .filter((m) => m.role === 'assistant')
                .slice(-4)
                .map((m) => ({
                  role: m.role,
                  text: typeof m.text === 'string' ? m.text.slice(0, 400) : '',
                  questions: m.questions || [],
                })),
              retrievedEvidence: evidence.hits
                .map((h) => ({ id: h.id, text: h.text.slice(0, 800) }))
                .slice(0, 2),
            },
            assistantSchema,
            configuredMode(),
            { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
          );
      processingStage = 'field-grounding';
      const groundingNotes = [
        notes,
        ...evidence.hits
          .filter((h) => h.kind !== 'advisory-feedback')
          .map((h) => h.text.slice(0, 2000)),
      ].join('\n');
      const prepared = await prepareProfileBuilderDraft({
        notes: groundingNotes,
        currentProfile: input.currentProfile,
        mode: configuredMode(),
        preparedResult: citeExactUserValues(
          result.builder,
          sourceMessages.map((m) => m.text),
        ),
      });
      processingStage = 'record-grounding';
      const explicitTitles: string[] = [];
      let namingQuestion = false;
      for (const entry of updatedMessages) {
        if (entry.role === 'assistant') {
          namingQuestion = [...(entry.questions || []), entry.text || ''].some((q) =>
            /(?:what|which).*(?:title|name).*(?:project|experience)|项目.*(?:名称|名字)/i.test(q),
          );
        } else if (entry.role === 'user') {
          if (namingQuestion && entry.text.length <= 200 && !interviewIntent(entry.text))
            explicitTitles.push(entry.text.trim());
          namingQuestion = false;
        }
      }
      const titleBase = (title: string) => careerTitle(title).replace(/ based on .+$/, '');
      const citedRecords = result.records.map((candidate) => {
        // A selected title is a source fact. Keep the user's literal spelling;
        // model spelling corrections belong in later wording suggestions.
        const named = [...explicitTitles]
          .reverse()
          .find((title) => titleBase(title) === titleBase(candidate.title));
        const r = named ? { ...candidate, title: named } : candidate;

        // Resolve provenance from the user's real messages, rather than asking
        // the model to count chat turns or reproduce every excerpt perfectly.
        const lower = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
        const anchors = pages.filter((p) => lower(p.text).includes(lower(r.title)));
        if (!r.title || !anchors.length) return r;
        const chosen = [...anchors];
        const add = (page: (typeof pages)[number] | undefined) => {
          if (page && !chosen.some((p) => p.page === page.page)) chosen.push(page);
        };
        for (const value of [r.organisation, r.location, r.url].filter(Boolean))
          add(pages.find((p) => lower(p.text).includes(lower(value))));
        if (r.startMonth) add(pages.find((p) => dateSupported(r.startMonth, p.text.toLowerCase())));
        if (r.endMonth) add(pages.find((p) => dateSupported(r.endMonth, p.text.toLowerCase())));
        if (r.current)
          add(pages.find((p) => /\bpresent\b|\bcurrent\b|至今/.test(p.text.toLowerCase())));
        for (const e of r.evidence) add(pages.find((p) => p.text.includes(e.quote)));
        for (const value of [...r.technologies, ...r.details].filter(Boolean))
          add(pages.find((p) => lower(p.text).includes(lower(value))));
        return {
          ...r,
          evidence: chosen.slice(0, 10).map((p) => ({ page: p.page, quote: p.text })),
        };
      });
      const grounded = groundImportedRecords({ records: citedRecords, questions: [] }, pages, {
        salvageOptional: true,
      });
      const changes = [...new Set(prepared.proposedChanges.map((c) => c.field))]
        .filter(
          (field) =>
            !(
              field === 'education' &&
              (input.currentProfile.educations?.length ||
                grounded.records.some((r) => r.section === 'educations'))
            ) &&
            !(
              field === 'experience' &&
              (input.currentProfile.workExperiences?.length ||
                input.currentProfile.projects?.length ||
                grounded.records.some((r) => r.section !== 'educations'))
            ),
        )
        .map((field) => ({
          id: randomUUID(),
          field,
          before: (input.currentProfile as any)[field],
          after: (prepared.data as any)[field],
          evidence: prepared.proposedChanges
            .filter((c) => c.field === field)
            .map((c) => ({
              quote: c.evidence,
              messageId: sourceMessages.find((m) => hasQuote(m.text, c.evidence))?.id || null,
              memoryRef:
                evidence.hits.find(
                  (h) =>
                    h.kind === 'confirmed-memory' && hasQuote(h.text.slice(0, 2000), c.evidence),
                )?.id || null,
              profileRef:
                evidence.hits.find(
                  (h) => h.kind === 'approved-profile' && hasQuote(h.text, c.evidence),
                )?.id || null,
            })),
          status: 'PENDING',
        }));
      for (const section of recordKeys) {
        const records = grounded.records
          .filter(
            (r) =>
              r.section === section &&
              r.evidence.every((e) => sourceMessages[e.page - 1]?.text.includes(e.quote)),
          )
          .map(({ section: _, evidence, ...r }) => {
            const existingExperiences = [
              ...(input.currentProfile.workExperiences || []),
              ...(input.currentProfile.projects || []),
            ];
            const previous = [...messages].reverse().find((m) => m.role === 'assistant');
            const question = (previous?.questions || []).join(' ');
            const focused =
              question.toLowerCase().includes(careerTitle(r.title)) ||
              (existingExperiences.length === 1 &&
                careerTitle(existingExperiences[0].title) === careerTitle(r.title) &&
                /your (?:own|specific|personal)|responsibilit|outcome|result|situation|action|contribution|what did you/i.test(
                  question,
                ));
            const originals =
              section === 'educations'
                ? []
                : sourceStatements(
                    r.title,
                    [
                      ...grounded.records.map((r) => r.title),
                      ...recordKeys.flatMap((k) =>
                        (input.currentProfile[k] || []).map((r) => r.title),
                      ),
                    ],
                    sourceMessages,
                    focused ? answerId : undefined,
                    Boolean(
                      input.recoverSavedAnswers &&
                      previousState.closed.filter(
                        (key) =>
                          !experiences(input.currentProfile).some((record) =>
                            closedExperience([key], record.key),
                          ),
                      ).length === 1 &&
                      closedExperience(
                        previousState.closed,
                        `${section}:${careerTitle(r.title)}:${r.organisation.toLowerCase()}`,
                      ) &&
                      grounded.records.filter(
                        (record) =>
                          record.section !== 'educations' &&
                          closedExperience(
                            previousState.closed,
                            `${record.section}:${careerTitle(record.title)}:${record.organisation.toLowerCase()}`,
                          ),
                      ).length === 1,
                    ),
                  );
            return recordSchema.parse({
              ...r,
              // Only the deterministic labelled-answer path supplies a type.
              // Keep it after grounding; the model cannot invent a category.
              ...(labelled ? { experienceType: labelled.experienceType } : {}),
              organisedStory: undefined,
              id: randomUUID(),
              details: originals.length ? originals.map((line) => line.text) : r.details,
              evidence: [],
              conversationEvidence: [
                ...evidence.map((e) => ({
                  threadId: t.id,
                  messageId: sourceMessages[e.page - 1].id,
                  quote: e.quote,
                })),
                ...originals.map((line) => ({
                  threadId: t.id,
                  messageId: line.messageId,
                  quote: line.text,
                })),
              ]
                .filter(
                  (e, i, all) =>
                    all.findIndex((x) => x.messageId === e.messageId && x.quote === e.quote) === i,
                )
                .slice(0, 10),
            });
          });
        if (records.length) {
          const merged = structuredClone(input.currentProfile[section] || []);
          const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
          for (const record of records) {
            const comparableTitle = careerTitle;
            const candidates = merged
              .map((old, index) => ({ old, index }))
              .filter(
                ({ old }) =>
                  comparableTitle(old.title) === comparableTitle(record.title) &&
                  (!old.organisation ||
                    !record.organisation ||
                    norm(old.organisation) === norm(record.organisation)) &&
                  (!old.startMonth || !record.startMonth || old.startMonth === record.startMonth) &&
                  (!old.endMonth || !record.endMonth || old.endMonth === record.endMonth),
              );
            if (candidates.length > 1)
              throw new AppError(
                409,
                'AMBIGUOUS_RECORD',
                'More than one experience matches. Clarify its organisation and dates.',
              );
            const index = candidates[0]?.index ?? -1;
            if (index < 0) {
              if (merged.length < (section === 'educations' ? 10 : 20)) merged.push(record);
            } else {
              const old = merged[index];
              merged[index] = {
                ...old,
                experienceType: record.experienceType || old.experienceType,
                organisation: record.organisation || old.organisation,
                location: record.location || old.location,
                startMonth: record.startMonth || old.startMonth,
                endMonth: record.endMonth || old.endMonth,
                current: record.endMonth ? false : record.current || old.current,
                details: [...new Set([...old.details, ...record.details])],
                technologies: [...new Set([...old.technologies, ...record.technologies])],
                conversationEvidence: [
                  ...(old.conversationEvidence || []),
                  ...(record.conversationEvidence || []),
                ]
                  .filter(
                    (e, i, all) =>
                      all.findIndex((x) => x.messageId === e.messageId && x.quote === e.quote) ===
                      i,
                  )
                  .slice(-10),
              };
            }
          }
          merged.forEach((r) => recordSchema.parse(r));
          if (fieldDigest(merged) !== fieldDigest(input.currentProfile[section] || []))
            changes.push({
              id: randomUUID(),
              field: section as any,
              before: (input.currentProfile[section] || []) as any,
              after: merged as any,
              evidence: records.flatMap((r) =>
                (r.conversationEvidence || []).map((e) => ({
                  quote: e.quote,
                  messageId: e.messageId,
                  memoryRef: null,
                  profileRef: null,
                })),
              ),
              status: 'PENDING',
            });
        }
      }
      const plan = planInterview(
        Object.assign(
          {},
          prepared.data,
          ...(t.proposals as any[])
            .filter(
              (p) =>
                p.status === 'PENDING' &&
                fieldDigest(input.currentProfile[p.field as keyof typeof input.currentProfile]) ===
                  fieldDigest(p.before),
            )
            .map((p) => ({ [p.field]: p.after })),
          ...changes.map((p) => ({ [p.field]: p.after })),
        ),
        previousState,
      );
      const questions = plan.state.question ? [plan.state.question.text] : [];
      response = {
        id: randomUUID(),
        role: 'assistant',
        at: new Date().toISOString(),
        text:
          (input.recoverSavedAnswers
            ? changes.length
              ? `Prepared ${changes.length} draft update(s). Review the suggested details and choose Use these details in my draft. Your draft has not changed yet.`
              : 'No source-supported draft updates were prepared. Your draft is unchanged. See the preparation details below; do not approve the old draft expecting this experience to be included.'
            : null) ||
          (!questions.length ? plan.hint : null) ||
          (result.reply &&
          /\b(?:I['’]ve|I have|I)\s+(?:added|saved|updated|approved|confirmed|applied)\b/i.test(
            result.reply,
          )
            ? 'I have prepared a suggested update. Review it before adding it to your working draft.'
            : result.reply) ||
          (changes.length
            ? 'I have organised the details you shared. Review them and update your working draft below.'
            : 'Your message is saved. I will keep unknown details open and will not invent facts.'),
        questions,
        interviewState: plan.state,
        retrieved: evidence.hits.map((h) => ({ id: h.id, text: h.text, score: h.score })),
        insufficientRecall: evidence.insufficientRecall,
        discarded: [...prepared.discardedFields, ...grounded.rejected],
        mode: configuredMode(),
        preparation: input.recoverSavedAnswers
          ? {
              status: changes.length ? 'ready' : 'no_changes',
              changes: changes.length,
              modelRecords: result.records.length,
              acceptedRecords: grounded.records.length,
              rejectedRecords: grounded.rejectedDetails,
              repairedRecords: grounded.repairs,
              discardedFields: prepared.discardedFields,
            }
          : undefined,
      };
      await db.profileThread.updateMany({
        where: { id: t.id, userId, busyToken: token },
        data: {
          messages: json([...updatedMessages, response]),
          proposals: json([
            ...(t.proposals as any[]).map((p) =>
              p.status === 'PENDING' && changes.some((c) => c.field === p.field)
                ? { ...p, status: 'SUPERSEDED' }
                : p,
            ),
            ...changes,
          ]),
          busyToken: null,
          busyUntil: null,
          revision: { increment: 1 },
        },
      });
    } catch (error) {
      const failure = error as any;
      response = {
        id: randomUUID(),
        role: 'assistant',
        at: new Date().toISOString(),
        text: 'Your message was saved, but model processing failed. No fields or approved facts changed. You can retry in a new turn or continue manually.',
        questions: [],
        interviewState: previousState,
        failed: true,
        diagnostic: {
          stage: processingStage,
          kind: failure?.name || 'Error',
          code: failure?.code || null,
          status: failure?.status || null,
          issues:
            error instanceof z.ZodError
              ? error.issues.map((i) => ({
                  path: i.path.join('.'),
                  code: i.code,
                  message: i.message,
                }))
              : [],
        },
      };
      await db.profileThread.updateMany({
        where: { id: t.id, userId, busyToken: token },
        data: {
          messages: json([...updatedMessages, response]),
          busyToken: null,
          busyUntil: null,
          revision: { increment: 1 },
        },
      });
    }
    res.json(publicThread(await owner(userId, t.id)));
  });
  app.post('/api/profile-threads/:id/proposals', async (req, res) => {
    const input = z
      .object({ currentProfile: formSchema, revision: z.number().int(), reviewed: z.literal(true) })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor!.id} FOR UPDATE`;
        const t = requireValue(
          await tx.profileThread.findFirst({
            where: { id: String(req.params.id), userId: req.actor!.id },
          }),
        );
        const user = await tx.user.findUniqueOrThrow({ where: { id: t.userId } });
        if (
          t.busyToken ||
          t.revision !== input.revision ||
          t.profileVersion !== user.profileVersion
        )
          throw new AppError(
            409,
            'STALE_PROPOSAL',
            'Conversation or approved profile changed. Reload and ask again.',
          );
        const proposals = structuredClone(t.proposals) as any[];
        const pending = proposals.filter((p) => p.status === 'PENDING');
        if (!pending.length)
          throw new AppError(409, 'NO_PROPOSALS', 'No pending details to apply.');
        const form = { ...input.currentProfile } as any;
        for (const p of pending) {
          if (fieldDigest(form[p.field]) !== fieldDigest(p.before))
            throw new AppError(
              409,
              'FIELD_CHANGED',
              'Your manual edit was kept. Ask again before applying these details.',
            );
          for (const source of p.evidence) {
            if (!source.memoryRef) continue;
            const [, id, revision] = source.memoryRef.split(':');
            if (
              !(await tx.careerMemory.findFirst({
                where: { id, userId: t.userId, status: 'CONFIRMED', revision: Number(revision) },
              }))
            )
              throw new AppError(
                409,
                'STALE_MEMORY_SOURCE',
                'A cited memory changed. Ask again for current evidence.',
              );
          }
          form[p.field] = p.after;
          p.status = 'APPLIED_TO_FORM';
        }
        await tx.profileThread.update({
          where: { id: t.id },
          data: { workingForm: json(form), proposals: json(proposals), revision: { increment: 1 } },
        });
        return {
          thread: publicThread(await tx.profileThread.findUniqueOrThrow({ where: { id: t.id } })),
          fields: pending.map((p) => p.field),
          data: form,
        };
      }),
    );
  });
  app.post('/api/profile-threads/:id/proposals/:proposalId', async (req, res) => {
    const input = z
      .object({
        decision: z.enum(['apply', 'reject']),
        revision: z.number().int(),
        currentProfile: formSchema,
      })
      .parse(req.body);
    res.json(
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.actor!.id} FOR UPDATE`;
        const t = requireValue(
          await tx.profileThread.findFirst({
            where: { id: String(req.params.id), userId: req.actor!.id },
          }),
        );
        const proposals = structuredClone(t.proposals) as any[],
          p = requireValue(proposals.find((p) => p.id === req.params.proposalId));
        const user = await tx.user.findUniqueOrThrow({ where: { id: t.userId } });
        if (
          t.busyToken ||
          t.revision !== input.revision ||
          p.status !== 'PENDING' ||
          t.profileVersion !== user.profileVersion
        )
          throw new AppError(
            409,
            'STALE_PROPOSAL',
            'Reload the conversation and review suggestions against your current profile.',
          );
        if (input.decision === 'apply')
          for (const source of p.evidence) {
            if (!source.memoryRef) continue;
            const [, id, revision] = source.memoryRef.split(':');
            const memory = await tx.careerMemory.findFirst({
              where: { id, userId: t.userId, status: 'CONFIRMED', revision: Number(revision) },
            });
            if (!memory)
              throw new AppError(
                409,
                'STALE_MEMORY_SOURCE',
                'A cited memory was corrected or deleted. Ask for a fresh suggestion.',
              );
          }
        if (
          input.decision === 'apply' &&
          fieldDigest((input.currentProfile as any)[p.field]) !== fieldDigest(p.before)
        )
          throw new AppError(
            409,
            'FIELD_CHANGED',
            'This field was edited after the suggestion. Keep your manual edit or ask again.',
          );
        p.status = input.decision === 'apply' ? 'APPLIED_TO_FORM' : 'REJECTED';
        const form = {
          ...input.currentProfile,
          ...(input.decision === 'apply' ? { [p.field]: p.after } : {}),
        };
        const saved = await tx.profileThread.updateMany({
          where: { id: t.id, userId: t.userId, revision: input.revision, busyToken: null },
          data: { proposals: json(proposals), workingForm: json(form), revision: { increment: 1 } },
        });
        if (!saved.count)
          throw new AppError(409, 'STALE_PROPOSAL', 'Conversation changed; reload it.');
        return {
          thread: publicThread(await tx.profileThread.findUniqueOrThrow({ where: { id: t.id } })),
          field: p.field,
          value: p.after,
          applied: input.decision === 'apply',
        };
      }),
    );
  });
}
