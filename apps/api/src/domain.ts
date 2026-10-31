import { createHash } from 'node:crypto';
import {
  recordKeys,
  hasCareerContent,
  recordText,
  orderedRecords,
} from '../../../packages/contracts/src/profile-records.js';
import { Prisma, type Mission } from '@prisma/client';
import { z } from 'zod';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import {
  getInterviewCompletion,
  mergeInterviewAnswer,
  type InterviewQuestion,
} from './interview.js';
import {
  profileSchema,
  type CareerProfile,
  type Fact,
  type decisionSchema,
} from '../../../packages/contracts/src/index.js';

export const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export type Event = { at: string; agent: string; action: string; detail: string };

export type MissionData = {
  [key: string]: any;
  apiCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  answers?: { questionId: string; answer: string }[];
};

// Evidence IDs are stable within a profile version; the owning mission pins that version.
export function buildFacts(p: CareerProfile): Fact[] {
  return [
    ...p.skills.map((s, i) => ({
      id: `skill-${i + 1}`,
      kind: 'skill',
      text: s,
      source: 'User-reviewed career profile',
    })),
    ...(hasCareerContent(p.education) && !p.educations?.length
      ? [
          {
            id: 'education-1',
            kind: 'education',
            text: p.education,
            source: 'User-reviewed education',
          },
        ]
      : []),
    ...(hasCareerContent(p.experience) && !p.workExperiences?.length && !p.projects?.length
      ? [
          {
            id: 'experience-1',
            kind: 'experience',
            text: p.experience,
            source: 'User-reviewed experience',
          },
        ]
      : []),
    ...recordKeys.flatMap((key) =>
      orderedRecords(p[key]).flatMap((r) => {
        const id = `${key}-${r.id}`;
        const common = {
          kind: key === 'educations' ? 'education' : 'experience',
          section:
            r.experienceType === 'volunteer'
              ? 'volunteering'
              : r.experienceType === 'club'
                ? 'activities'
                : key,
          recordId: r.id,
          evidence: r.evidence,
          conversationEvidence: r.conversationEvidence,
          memoryEvidence: r.memoryEvidence,
          source:
            'User-reviewed career record; complete original statements and source links retained',
        };
        return [
          { ...common, id, text: recordText({ ...r, details: [], relevantCoursework: [] }) },
          ...(key === 'educations'
            ? (r.relevantCoursework || []).map((course, index) => ({
                ...common,
                id: `${id}-coursework-${index + 1}`,
                text: `Relevant coursework: ${course}`,
                recordHeaderId: id,
              }))
            : []),
          ...r.details.flatMap((text, index) =>
            key === 'educations' &&
            r.relevantCoursework?.some((course) =>
              text.toLowerCase().includes(course.toLowerCase()),
            )
              ? []
              : [
                  {
                    ...common,
                    id: `${id}-detail-${index + 1}`,
                    text,
                    recordHeaderId: id,
                  },
                ],
          ),
        ];
      }),
    ),
    ...p.interests.map((s, i) => ({
      id: `interest-${i + 1}`,
      kind: 'interest',
      text: s,
      source: 'User-reviewed interests',
    })),
  ];
}

async function validateMemorySources(userId: string, data: CareerProfile, client: any = db) {
  for (const key of recordKeys)
    for (const record of data[key] || [])
      for (const e of record.memoryEvidence || []) {
        const memory = await client.careerMemory.findFirst({
          where: { id: e.memoryId, userId, revision: e.revision, status: 'CONFIRMED' },
        });
        if (
          !memory ||
          (memory.source as any).kind === 'interview' ||
          !(memory.source as any).quote?.includes(e.quote)
        )
          throw new AppError(
            422,
            'STALE_STORY_SOURCE',
            'A story was corrected, deleted or is unconfirmed. Review the current story source before approving this profile.',
          );
      }
}

export async function createDraft(userId: string, input: unknown) {
  const data = profileSchema.parse(input);
  await validateMemorySources(userId, data);
  for (const key of recordKeys)
    for (const record of data[key] || [])
      for (const evidence of record.conversationEvidence || []) {
        const thread = await db.profileThread.findFirst({
          where: { id: evidence.threadId, userId },
        });
        const message = (thread?.messages as any[] | undefined)?.find(
          (m) => m.id === evidence.messageId && m.role === 'user',
        );
        if (!message?.text.includes(evidence.quote))
          throw new AppError(
            422,
            'INVALID_CONVERSATION_EVIDENCE',
            'Conversation evidence must cite your own saved message.',
          );
      }
  for (const key of recordKeys)
    for (const record of data[key] || [])
      for (const evidence of record.evidence) {
        const source = await db.profileImport.findFirst({
          where: { id: evidence.importId, userId },
        });
        const page = (source?.pages as any[])?.find((p) => p.page === evidence.page);
        const normal = (s: string) => s.replace(/\s+/g, ' ').trim();
        if (!page || !normal(page.text).includes(normal(evidence.quote)))
          throw new AppError(
            422,
            'INVALID_IMPORT_EVIDENCE',
            'Import evidence must refer to your own saved source page.',
          );
      }
  const u = requireValue(await db.user.findUnique({ where: { id: userId } }));
  return db.profileDraft.create({
    data: {
      userId,
      baseVersion: u.profileVersion,
      data: json(data),
      facts: json(buildFacts(data)),
    },
  });
}

export async function approveProfile(userId: string, draftId: string) {
  return db.$transaction(async (tx) => {
    const draft = requireValue(await tx.profileDraft.findFirst({ where: { id: draftId, userId } }));
    if (draft.status !== 'DRAFT')
      throw new AppError(409, 'DRAFT_USED', 'This draft has already been approved or discarded.');

    // Claim this exact draft before changing the approved version. Discard uses the
    // same conditional state transition, so cancellation and approval cannot both win.
    // This claim rolls back with the rest of the transaction if persistence fails.
    const claimed = await tx.profileDraft.updateMany({
      where: { id: draft.id, userId, status: 'DRAFT' },
      data: { status: 'APPROVED' },
    });
    if (claimed.count !== 1)
      throw new AppError(409, 'DRAFT_USED', 'This draft has already been approved or discarded.');

    // Compare-and-increment prevents two drafts based on the same version from both being approved.
    const changed = await tx.user.updateMany({
      where: { id: userId, profileVersion: draft.baseVersion },
      data: { profileVersion: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new AppError(
        409,
        'STALE_DRAFT',
        'Your profile changed. Review a new draft before approving.',
      );
    await validateMemorySources(userId, draft.data as unknown as CareerProfile, tx);
    const profile = await tx.profile.create({
      data: {
        userId,
        version: draft.baseVersion + 1,
        data: draft.data as Prisma.InputJsonValue,
        facts: draft.facts as Prisma.InputJsonValue,
      },
    });

    const approvedData = draft.data as unknown as CareerProfile;
    for (const key of recordKeys)
      for (const record of approvedData[key] || []) {
        await tx.careerMemory.updateMany({
          where: {
            userId,
            status: { in: ['DRAFT', 'CONFIRMED'] },
            source: { path: ['id'], equals: `working-record:${record.id}` },
          },
          data: { recordId: record.id },
        });
      }

    // Invalidate unfinished work while retaining historical profiles and approved documents.
    await tx.mission.updateMany({
      where: { userId, status: { notIn: ['CANCELLED', 'STALE', 'COMPLETE'] } },
      data: {
        status: 'STALE',
        leaseToken: null,
        leaseExpiresAt: null,
        error:
          'The approved profile changed. Start a new mission; previous approved documents are preserved.',
      },
    });
    return profile;
  });
}

export async function ownedMission(userId: string, id: string) {
  return requireValue(
    await db.mission.findFirst({ where: { id, userId }, include: { profile: true } }),
  );
}

export async function freshMission(id: string) {
  const m = requireValue(
    await db.mission.findUnique({ where: { id }, include: { profile: true, user: true } }),
  );
  if (m.user.profileVersion !== m.profile.version || m.status === 'STALE')
    throw new AppError(409, 'STALE_PROFILE', 'The approved profile changed. Start a new mission.');
  return m;
}

export async function mutateRun(
  id: string,
  lease: string,
  operation: (tx: Prisma.TransactionClient, m: Mission) => Promise<void>,
) {
  return db.$transaction(async (tx) => {
    // Row lock serialises cancellation, profile changes and all worker side effects.
    const rows = await tx.$queryRaw<
      { userId: string }[]
    >`SELECT "userId" FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Mission unavailable.');
    const m = requireValue(await tx.mission.findUnique({ where: { id } }));
    const user = requireValue(await tx.user.findUnique({ where: { id: m.userId } }));
    const p = requireValue(await tx.profile.findUnique({ where: { id: m.profileId } }));
    if (m.status !== 'RUNNING' || m.leaseToken !== lease || user.profileVersion !== p.version)
      throw new AppError(409, 'RUN_SUPERSEDED', 'This run was cancelled, changed, or superseded.');
    await operation(tx, m);
  });
}

export async function patchRun(
  id: string,
  lease: string,
  patch: MissionData,
  agent: string,
  action: string,
  detail: string,
) {
  await mutateRun(id, lease, async (tx, m) => {
    const data = { ...(m.data as MissionData), ...patch };
    const events = [
      ...(m.events as unknown as Event[]),
      { at: new Date().toISOString(), agent, action, detail },
    ];
    await tx.mission.update({ where: { id }, data: { data: json(data), events: json(events) } });
  });
}

export async function appendUsage(id: string, lease: string, input: number, output: number) {
  await mutateRun(id, lease, async (tx, m) => {
    const d = m.data as MissionData;
    await tx.mission.update({
      where: { id },
      data: {
        data: json({
          ...d,
          inputTokens: (d.inputTokens || 0) + input,
          outputTokens: (d.outputTokens || 0) + output,
        }),
      },
    });
  });
}

// Reserve before calling the provider so concurrent work cannot overspend the mission budget.
export async function reserveCall(id: string, lease: string) {
  await mutateRun(id, lease, async (tx, m) => {
    const d = m.data as MissionData;
    if ((d.apiCalls || 0) >= 12)
      throw new AppError(
        409,
        'BUDGET_REACHED',
        'The mission reached its 12-call budget. Review it before starting further work.',
      );
    await tx.mission.update({
      where: { id },
      data: { data: json({ ...d, apiCalls: (d.apiCalls || 0) + 1 }) },
    });
  });
}

// The model selects evidence; candidate wording comes only from the approved facts.
export function deduplicateResumeClaims(claims: { factId: string; reason: string }[]) {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    if (seen.has(claim.factId)) return false;
    seen.add(claim.factId);
    return true;
  });
}

export function includeRecordHeaders(claims: { factId: string; reason: string }[], facts: Fact[]) {
  const output: { factId: string; reason: string }[] = [],
    seen = new Set<string>();
  for (const claim of claims) {
    const fact = facts.find((f) => f.id === claim.factId);
    if (fact?.recordHeaderId && !seen.has(fact.recordHeaderId)) {
      output.push({
        factId: fact.recordHeaderId,
        reason: 'Role, organisation and date context for the selected statement.',
      });
      seen.add(fact.recordHeaderId);
    }
    if (!seen.has(claim.factId)) {
      output.push(claim);
      seen.add(claim.factId);
    }
  }
  return output;
}

export function validateResumeClaims(claims: { factId: string; reason: string }[], facts: Fact[]) {
  const ids = new Set<string>();
  return claims.map((c) => {
    const fact = facts.find((f) => f.id === c.factId);
    if (
      !fact ||
      !['skill', 'education', 'experience'].includes(fact.kind) ||
      /^none yet$/i.test(fact.text) ||
      ids.has(fact.id)
    )
      throw new AppError(
        422,
        'UNSUPPORTED_CLAIM',
        'The resume contains a duplicate or unsupported candidate claim.',
      );
    ids.add(fact.id);
    return {
      ...c,
      text: fact.text,
      kind: fact.kind,
      ...(fact.recordHeaderId ? { recordHeaderId: fact.recordHeaderId } : {}),
      source: fact.source,
      ...(fact.section
        ? {
            section: fact.section,
            recordId: fact.recordId,
            evidence: fact.evidence,
            ...(fact.memoryEvidence ? { memoryEvidence: fact.memoryEvidence } : {}),
            ...(fact.conversationEvidence
              ? { conversationEvidence: fact.conversationEvidence }
              : {}),
          }
        : {}),
    };
  });
}

// Validate decisions against current persisted state, never against client-supplied workflow data.
export async function queueDecision(
  userId: string,
  id: string,
  decision: z.infer<typeof decisionSchema>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const m = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    const d = m.data as MissionData;
    if (m.profile.version !== m.user.profileVersion)
      throw new AppError(409, 'STALE_PROFILE', 'Your profile changed. Start a new mission.');

    // Each human decision is accepted only at its corresponding pause point.
    const expected = {
      job: 'AWAITING_JOB',
      resume: 'AWAITING_APPROVAL',
      interview: 'AWAITING_INTERVIEW',
    }[decision.kind];
    if (m.status !== expected)
      throw new AppError(
        409,
        'DECISION_NOT_EXPECTED',
        'This decision has already been handled or the mission is not waiting for it.',
      );
    if (decision.kind === 'job' && !d.matches?.some((r: any) => r.job.id === decision.jobId))
      throw new AppError(422, 'INVALID_JOB', 'Choose a job from this mission’s ranked results.');

    // Approval authorises this exact draft, not a later revision shown in another tab.
    if (decision.kind === 'resume' && d.resumeDraft?.hash !== decision.draftHash)
      throw new AppError(409, 'STALE_APPROVAL', 'The draft changed. Review the current version.');
    if (decision.kind === 'resume' && decision.decision === 'revise' && (d.revisions || 0) >= 2)
      throw new AppError(
        409,
        'REVISION_LIMIT',
        'Two revisions have been reached. Start a new mission with revised inputs.',
      );
    let persistedDecision = decision;
    if (decision.kind === 'interview') {
      const completion = getInterviewCompletion(
        (d.questions || []) as InterviewQuestion[],
        d.answers || [],
      );
      if (!completion.answeredCount)
        throw new AppError(
          422,
          'ANSWER_REQUIRED',
          'Save at least one interview response before requesting feedback.',
        );
      persistedDecision = { ...decision, endedEarly: completion.endedEarly };
    }
    return tx.mission.update({
      where: { id },
      data: { status: 'QUEUED', pendingDecision: json(persistedDecision), error: null },
    });
  });
}

export async function saveInterviewAnswer(
  userId: string,
  id: string,
  answer: { questionId: string; answer: string },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const m = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    const d = m.data as MissionData;
    if (m.status !== 'AWAITING_INTERVIEW' || m.user.profileVersion !== m.profile.version)
      throw new AppError(
        409,
        'INTERVIEW_NOT_READY',
        'This interview is no longer accepting responses.',
      );
    if (!d.questions?.some((q: any) => q.id === answer.questionId))
      throw new AppError(422, 'INVALID_QUESTION', 'Choose a question from this interview.');

    // Replace one response under the row lock without losing or reordering other answers.
    const answers = mergeInterviewAnswer(
      d.questions as InterviewQuestion[],
      d.answers || [],
      answer,
    );
    await tx.mission.update({ where: { id }, data: { data: json({ ...d, answers }) } });
    return { answers };
  });
}

// Revoking the lease also prevents a slow provider response from committing after cancellation.
export async function cancelMission(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const m = requireValue(await tx.mission.findFirst({ where: { id, userId } }));
    if (['COMPLETE', 'CANCELLED', 'STALE', 'NO_MATCHES'].includes(m.status))
      throw new AppError(409, 'TERMINAL_MISSION', 'This mission is already finished or outdated.');
    await tx.mission.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        leaseToken: null,
        leaseExpiresAt: null,
        pendingDecision: Prisma.DbNull,
        events: json([
          ...(m.events as unknown as Event[]),
          {
            at: new Date().toISOString(),
            agent: 'Job Seeker',
            action: 'cancelled',
            detail: 'Cancelled further work. Previously approved documents remain unchanged.',
          },
        ]),
      },
    });
    return { ok: true };
  });
}
