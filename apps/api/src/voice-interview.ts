import type { Express } from 'express';
import { db } from './db.js';
import { json, ownedMission, type MissionData } from './domain.js';
import { AppError } from './errors.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { rolePreamble } from '../../../packages/agents/src/personas.js';

// Live voice interviewer (CFS-136, speech phase 2). The server issues a short-lived client secret
// for one realtime session that already carries the panel's instructions and this run's questions;
// the browser then talks to the model over WebRTC. No audio reaches or stays on our server: the
// browser sends each answer's transcript to the normal interview rounds, where the Evaluator
// scores it as for typed answers. Live mode only.

export const VOICE_SESSIONS_PER_RUN = 3;
export const VOICE_LIMIT_SECONDS = 600;
const OPENAI = 'https://api.openai.com/v1';

type Question = { id: string; question: string; focus?: string };

/** What the realtime panel is told: persona, the exact questions, and its limits. */
export function voiceInstructions(
  job: { title?: string; company?: string },
  questions: Question[],
) {
  return (
    rolePreamble('questions') +
    `This is a spoken mock interview for ${job.title || 'the role'}${job.company ? ` at ${job.company}` : ''}. ` +
    'Speak in short, natural sentences. Greet the candidate in one sentence, then ask the questions below in order, one at a time. ' +
    'Start every main question with the words "Question" and its number, for example "Question 1." ' +
    'After each answer you may ask at most one short follow-up about something they actually said, then move on. ' +
    'Do not score, praise at length, coach or give feedback; the written evaluation comes afterwards. ' +
    'Never state facts about the candidate that they did not say. ' +
    'After the last question, thank them in one sentence and say the panel will now score the answers. ' +
    `Questions:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}`
  );
}

export async function createVoiceSession(
  userId: string,
  missionId: string,
  fetcher: typeof fetch = fetch,
) {
  if (configuredMode() === 'fixture')
    throw new AppError(409, 'LIVE_ONLY', 'The voice interviewer works in live mode only.');
  const key = process.env.OPENAI_NATIVE_API_KEY?.trim();
  if (!key)
    throw new AppError(503, 'VOICE_UNAVAILABLE', 'The voice interviewer is not configured here.');
  const m = await ownedMission(userId, missionId);
  const d = m.data as MissionData;
  const questions: Question[] = d.questions || [];
  if (m.status !== 'AWAITING_INTERVIEW' || !questions.length)
    throw new AppError(
      409,
      'INTERVIEW_NOT_READY',
      'Open the interview once its questions are ready.',
    );
  const used: string[] = d.voiceSessions || [];
  if (used.length >= VOICE_SESSIONS_PER_RUN)
    throw new AppError(
      429,
      'VOICE_LIMIT',
      `This practice run has used its ${VOICE_SESSIONS_PER_RUN} voice sessions. Type your answers, or start another practice run.`,
    );
  const model = process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1';
  let response: Response;
  try {
    response = await fetcher(`${OPENAI}/realtime/client_secrets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The secret only opens a session within a minute; the session itself is time-boxed below.
        expires_after: { anchor: 'created_at', seconds: 60 },
        session: {
          type: 'realtime',
          model,
          instructions: voiceInstructions(d.selectedJob?.job || {}, questions),
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: { type: 'semantic_vad' },
            },
            output: { voice: 'marin' },
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError(
      503,
      'VOICE_UNAVAILABLE',
      'The voice service could not be reached. Type your answers instead.',
    );
  }
  if (!response.ok)
    throw new AppError(
      502,
      'VOICE_UNAVAILABLE',
      `The voice service refused the session (${response.status}). Type your answers instead.`,
    );
  const secret = (await response.json()) as { value?: string; expires_at?: number };
  if (!secret.value)
    throw new AppError(502, 'VOICE_UNAVAILABLE', 'The voice service sent no session key.');
  await db.mission.update({
    where: { id: m.id },
    data: { data: json({ ...d, voiceSessions: [...used, new Date().toISOString()] }) },
  });
  return {
    clientSecret: secret.value,
    expiresAt: secret.expires_at ?? null,
    model,
    callsUrl: `${OPENAI}/realtime/calls`,
    limitSeconds: VOICE_LIMIT_SECONDS,
    questions: questions.map((q) => ({ id: q.id, question: q.question })),
    remaining: VOICE_SESSIONS_PER_RUN - used.length - 1,
  };
}

export function registerVoiceInterview(app: Express) {
  app.post('/api/missions/:id/voice-session', async (req, res) =>
    res.json(await createVoiceSession(req.actor!.id, String(req.params.id))),
  );
}
