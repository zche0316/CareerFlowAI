import express, { type Express } from 'express';
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
  const transcriber =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe';
  // The secret is issued even for a model the project cannot use; the call then fails with 403.
  // Check access first so the user gets a clear reason and the attempt is not counted (CFS-138).
  const missing = await missingModels([model, transcriber], key, fetcher);
  if (missing.length)
    throw new AppError(
      409,
      'VOICE_MODEL_UNAVAILABLE',
      `This OpenAI project has no access to ${missing.join(' and ')}. Enable ${missing.length > 1 ? 'them' : 'it'} for the project, or set OPENAI_REALTIME_MODEL / OPENAI_REALTIME_TRANSCRIBE_MODEL to models it can use. Type your answers meanwhile.`,
    );
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
              transcription: { model: transcriber },
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

/** Models the key cannot use, from GET /v1/models/{id}; an unreachable check blocks nothing. */
async function missingModels(ids: string[], key: string, fetcher: typeof fetch) {
  const out: string[] = [];
  for (const id of ids) {
    try {
      const r = await fetcher(`${OPENAI}/models/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404 || r.status === 403) out.push(id);
    } catch {
      // The session request below reports the provider being down.
    }
  }
  return out;
}

let statusCache: { at: number; value: { realtime: boolean; transcribe: boolean } } | null = null;

/** Which voice features this deployment's OpenAI project can use; cached for an hour. */
export async function voiceStatus(fetcher: typeof fetch = fetch) {
  const key = process.env.OPENAI_NATIVE_API_KEY?.trim();
  if (configuredMode() === 'fixture' || !key) return { realtime: false, transcribe: false };
  if (statusCache && Date.now() - statusCache.at < 3600_000) return statusCache.value;
  const realtime = process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1';
  const realtimeTranscriber =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe';
  const transcriber = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe';
  const missing = await missingModels([realtime, realtimeTranscriber, transcriber], key, fetcher);
  const value = {
    realtime: !missing.includes(realtime) && !missing.includes(realtimeTranscriber),
    transcribe: !missing.includes(transcriber),
  };
  statusCache = { at: Date.now(), value };
  return value;
}

export function registerVoiceInterview(app: Express) {
  app.get('/api/voice/status', async (_req, res) => res.json(await voiceStatus()));
  app.post('/api/missions/:id/voice-session', async (req, res) =>
    res.json(await createVoiceSession(req.actor!.id, String(req.params.id))),
  );
}

// ---- Recorded answers (CFS-139) ----------------------------------------------------------------
// One spoken answer, recorded in the browser, is sent here and forwarded to the transcription API.
// The audio stays in memory for that request only; the text goes back to the editable answer box.

export const TRANSCRIPTIONS_PER_RUN = 40;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const audioTypes = /^audio\/(webm|ogg|mp4|mpeg|mp3|m4a|wav|x-wav|x-m4a)(;.*)?$/i;

/** Checks one recording and sends it to the transcription API; nothing is stored. */
async function transcribeAudio(
  audio: Buffer,
  contentType: string,
  fetcher: typeof fetch,
  language?: string,
) {
  if (configuredMode() === 'fixture')
    throw new AppError(409, 'LIVE_ONLY', 'Recorded answers are transcribed in live mode only.');
  const key = process.env.OPENAI_NATIVE_API_KEY?.trim();
  if (!key)
    throw new AppError(503, 'TRANSCRIBE_UNAVAILABLE', 'Transcription is not configured here.');
  if (!audioTypes.test(contentType || ''))
    throw new AppError(
      415,
      'AUDIO_TYPE',
      'Send the recording as audio (webm, ogg, mp4, mp3 or wav).',
    );
  if (!audio.length) throw new AppError(422, 'AUDIO_EMPTY', 'The recording was empty.');
  if (audio.length > MAX_AUDIO_BYTES)
    throw new AppError(413, 'AUDIO_TOO_LARGE', 'Keep one answer under about five minutes.');
  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe';
  const ext = /wav/i.test(contentType)
    ? 'wav'
    : /mp4|m4a/i.test(contentType)
      ? 'm4a'
      : /mpeg|mp3/i.test(contentType)
        ? 'mp3'
        : /ogg/i.test(contentType)
          ? 'ogg'
          : 'webm';
  const form = new FormData();
  form.append('model', model);
  // Interview answers are in English; profile messages may be in any language the user speaks.
  if (language) form.append('language', language);
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: contentType.split(';')[0] }),
    `answer.${ext}`,
  );
  let response: Response;
  try {
    response = await fetcher(`${OPENAI}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new AppError(
      503,
      'TRANSCRIBE_UNAVAILABLE',
      'The transcription service could not be reached. Type your answer instead.',
    );
  }
  if (!response.ok)
    throw new AppError(
      502,
      'TRANSCRIBE_UNAVAILABLE',
      `The transcription service refused the recording (${response.status}). Type your answer instead.`,
    );
  const result = (await response.json()) as { text?: string; usage?: { seconds?: number } };
  return {
    text: String(result.text || '').trim(),
    seconds: result.usage?.seconds ?? null,
    model,
  };
}

export async function transcribeAnswer(
  userId: string,
  missionId: string,
  audio: Buffer,
  contentType: string,
  fetcher: typeof fetch = fetch,
) {
  const m = await ownedMission(userId, missionId);
  const d = m.data as MissionData;
  if (m.status !== 'AWAITING_INTERVIEW')
    throw new AppError(409, 'INTERVIEW_NOT_READY', 'Record answers while the interview is open.');
  const used = d.transcriptions || { count: 0, seconds: 0 };
  if (used.count >= TRANSCRIPTIONS_PER_RUN)
    throw new AppError(
      429,
      'TRANSCRIBE_LIMIT',
      'This practice run has reached its recording limit. Type your answers.',
    );
  const result = await transcribeAudio(audio, contentType, fetcher, 'en');
  await db.mission.update({
    where: { id: m.id },
    data: {
      data: json({
        ...d,
        transcriptions: {
          count: used.count + 1,
          seconds: used.seconds + Math.round(result.seconds || 0),
          model: result.model,
        },
      }),
    },
  });
  return {
    text: result.text,
    seconds: result.seconds,
    remaining: TRANSCRIPTIONS_PER_RUN - used.count - 1,
  };
}

// Spoken messages to the Profile Builder (CFS-143). Same rules as interview answers; a daily cap
// per user bounds cost. The count lives in memory, so a restart resets it.
export const PROFILE_TRANSCRIPTIONS_PER_DAY = 60;
const profileUse = new Map<string, number>();

export async function transcribeProfileMessage(
  userId: string,
  audio: Buffer,
  contentType: string,
  fetcher: typeof fetch = fetch,
  today = new Date().toISOString().slice(0, 10),
) {
  const key = `${userId}:${today}`;
  const used = profileUse.get(key) || 0;
  if (used >= PROFILE_TRANSCRIPTIONS_PER_DAY)
    throw new AppError(
      429,
      'TRANSCRIBE_LIMIT',
      "You have reached today's recording limit for the Profile Builder. Type your message.",
    );
  const result = await transcribeAudio(audio, contentType, fetcher);
  profileUse.set(key, used + 1);
  return {
    text: result.text,
    seconds: result.seconds,
    remaining: PROFILE_TRANSCRIPTIONS_PER_DAY - used - 1,
  };
}

export function registerTranscription(app: Express) {
  app.post(
    '/api/missions/:id/transcribe',
    express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }),
    async (req, res) =>
      res.json(
        await transcribeAnswer(
          req.actor!.id,
          String(req.params.id),
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          String(req.headers['content-type'] || ''),
        ),
      ),
  );
  app.post(
    '/api/profile/transcribe',
    express.raw({ type: 'audio/*', limit: MAX_AUDIO_BYTES }),
    async (req, res) =>
      res.json(
        await transcribeProfileMessage(
          req.actor!.id,
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          String(req.headers['content-type'] || ''),
        ),
      ),
  );
}
