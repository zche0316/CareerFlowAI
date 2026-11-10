import { MISSION_MODEL_CALL_LIMIT } from '../../../packages/contracts/src/mission-limits.js';
import type { Express } from 'express';
import { db } from './db.js';
import { AppError, requireValue } from './errors.js';
import { json, ownedMission, type Event, type MissionData } from './domain.js';
import { mergeInterviewAnswer, type InterviewQuestion } from './interview.js';
import {
  interviewRoundInputSchema,
  roundEvaluationSchema,
  type RoundEvaluation,
} from '../../../packages/contracts/src/index.js';
import { generate, type Mode } from '../../../packages/agents/src/provider.js';
import { spanHook } from './trace.js';

export type InterviewRound = {
  questionId: string;
  kind: 'answer' | 'follow_up';
  prompt: string;
  answer: string;
  evaluation: RoundEvaluation;
  reviewer: 'rules' | 'model';
  at: string;
};

// Runs a function on the locked mission row while it is still the current interview.
async function locked<T>(
  userId: string,
  id: string,
  work: (data: MissionData, events: Event[], tx: any) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Mission" WHERE id = ${id} FOR UPDATE`;
    const m = requireValue(
      await tx.mission.findFirst({ where: { id, userId }, include: { profile: true, user: true } }),
    );
    if (m.status !== 'AWAITING_INTERVIEW' || m.profile.version !== m.user.profileVersion)
      throw new AppError(
        409,
        'INTERVIEW_NOT_READY',
        'This interview is no longer accepting answers.',
      );
    return work(m.data as MissionData, m.events as unknown as Event[], tx);
  });
}

const save = (tx: any, id: string, data: MissionData, events?: Event[]) =>
  tx.mission.update({
    where: { id },
    data: { data: json(data), ...(events ? { events: json(events) } : {}) },
  });

/**
 * One boss-battle round: the Evaluator scores the answer against STAR and may ask one follow-up.
 * Practice answers are saved as answers (so final feedback still sees them), never as facts.
 */
export async function playInterviewRound(userId: string, id: string, input: unknown) {
  const round = interviewRoundInputSchema.parse(input);
  const mission = await ownedMission(userId, id);

  const prompt = await locked(userId, id, async (data, _events, tx) => {
    const question = (data.questions || []).find((q: any) => q.id === round.questionId);
    if (!question)
      throw new AppError(422, 'INVALID_QUESTION', 'Choose a question from this interview.');
    if (data.interviewRun?.status === 'RUNNING')
      throw new AppError(409, 'ROUND_RUNNING', 'The panel is still scoring your last answer.');
    if ((data.apiCalls || 0) >= MISSION_MODEL_CALL_LIMIT)
      throw new AppError(409, 'BUDGET_REACHED', 'This quest reached its model-call budget.');
    const rounds: InterviewRound[] = data.rounds || [];
    const main = rounds.find((r) => r.questionId === round.questionId && r.kind === 'answer');
    let text = question.question;
    if (round.followUp) {
      if (!main?.evaluation.followUp)
        throw new AppError(409, 'NO_FOLLOW_UP', 'The panel has no follow-up for this question.');
      if (rounds.some((r) => r.questionId === round.questionId && r.kind === 'follow_up'))
        throw new AppError(409, 'FOLLOW_UP_DONE', 'This follow-up was already answered.');
      text = main.evaluation.followUp;
    }
    await save(tx, id, {
      ...data,
      interviewRun: { status: 'RUNNING', startedAt: new Date().toISOString() },
    });
    return { question, text };
  });

  try {
    const evaluation = await generate(
      'evaluator',
      {
        goal: mission.goal,
        facts: [],
        job: {
          title: (mission.data as MissionData).selectedJob?.job.title || '',
          description: '',
        },
        question: { ...prompt.question, question: prompt.text },
        candidateAnswer: round.answer,
        isFollowUp: round.followUp,
      },
      roundEvaluationSchema,
      mission.mode as Mode,
      {
        onCall: () =>
          locked(userId, id, async (data, _e, tx) => {
            if ((data.apiCalls || 0) >= MISSION_MODEL_CALL_LIMIT)
              throw new AppError(
                409,
                'BUDGET_REACHED',
                'This quest reached its model-call budget.',
              );
            await save(tx, id, { ...data, apiCalls: (data.apiCalls || 0) + 1 });
          }),
        onTool: async () => {},
        onUsage: (input, output) =>
          locked(userId, id, (data, _e, tx) =>
            save(tx, id, {
              ...data,
              inputTokens: (data.inputTokens || 0) + input,
              outputTokens: (data.outputTokens || 0) + output,
            }),
          ),
        onSpan: spanHook({ userId, missionId: id }),
      },
    );

    await locked(userId, id, async (data, events, tx) => {
      const at = new Date().toISOString();
      const saved: InterviewRound = {
        questionId: round.questionId,
        kind: round.followUp ? 'follow_up' : 'answer',
        prompt: prompt.text,
        answer: round.answer,
        evaluation: round.followUp ? { ...evaluation, followUp: '' } : evaluation,
        reviewer: mission.mode === 'fixture' ? 'rules' : 'model',
        at,
      };
      // A fresh answer to the main question replaces its earlier round and follow-up.
      const rounds = [
        ...((data.rounds || []) as InterviewRound[]).filter(
          (r) => r.questionId !== round.questionId || (round.followUp && r.kind === 'answer'),
        ),
        saved,
      ];
      const answers = round.followUp
        ? data.answers || []
        : mergeInterviewAnswer(data.questions as InterviewQuestion[], data.answers || [], {
            questionId: round.questionId,
            answer: round.answer,
          });
      const s = saved.evaluation.star;
      await save(tx, id, { ...data, rounds, answers, interviewRun: null }, [
        ...events,
        {
          at,
          agent: 'Interview Coach',
          action: 'evaluated',
          detail:
            `Evaluator scored ${round.followUp ? 'a follow-up' : 'an answer'}: situation ${s.situation}, task ${s.task}, action ${s.action}, result ${s.result}.` +
            (saved.evaluation.followUp ? ' The panel asked one follow-up.' : ''),
        },
      ]);
    });
    return ownedMission(userId, id);
  } catch (error) {
    await locked(userId, id, (data, _e, tx) => save(tx, id, { ...data, interviewRun: null })).catch(
      () => {},
    );
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      'ROUND_UNAVAILABLE',
      'The panel could not score this answer. Your saved answers are unchanged. Try again.',
    );
  }
}

export function registerInterviewRounds(app: Express) {
  app.post('/api/missions/:id/interview/rounds', async (req, res) =>
    res.json(await playInterviewRound(req.actor!.id, String(req.params.id), req.body)),
  );
}
