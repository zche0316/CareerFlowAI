import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import {
  createVoiceSession,
  transcribeAnswer,
  transcribeProfileMessage,
  PROFILE_TRANSCRIPTIONS_PER_DAY,
  voiceStatus,
  voiceInstructions,
  VOICE_SESSIONS_PER_RUN,
} from '../apps/api/src/voice-interview.js';
import { questionNumber } from '../apps/web/src/quest/voice-interviewer.js';

// CFS-136: the server issues a short-lived realtime key carrying the panel's instructions and
// this run's questions. No real network: the OpenAI call is injected.

let userId = '';
let missionId = '';
const questions = [
  { id: 'q1', question: 'Tell me about a report you built.', focus: 'SQL' },
  { id: 'q2', question: 'How do you check data quality?', focus: 'Quality' },
];

beforeAll(async () => {
  const u = await db.user.create({
    data: {
      email: `qa-voice-${crypto.randomUUID()}@careerflow.test`,
      name: 'Voice QA',
      passwordHash: 'x',
    },
  });
  userId = u.id;
  const p = await db.profile.create({
    data: { userId, version: 1, data: json({}), facts: json([]) },
  });
  const m = await db.mission.create({
    data: {
      userId,
      profileId: p.id,
      goal: 'Practise',
      status: 'AWAITING_INTERVIEW',
      mode: 'openai',
      events: [],
      data: json({
        questions,
        selectedJob: { job: { title: 'Data Analyst', company: 'Example' } },
      }),
    },
  });
  missionId = m.id;
});
afterAll(async () => {
  process.env.PROVIDER_MODE = 'fixture';
  delete process.env.OPENAI_NATIVE_API_KEY;
  await db.mission.deleteMany({ where: { userId } });
  await db.profile.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

it('tells the realtime panel its persona, the questions in order and not to score', () => {
  const text = voiceInstructions({ title: 'Data Analyst', company: 'Example' }, questions);
  expect(text).toContain('the Panel');
  expect(text).toContain('1. Tell me about a report you built.\n2. How do you check data quality?');
  expect(text).toContain('Start every main question with the words "Question"');
  expect(text).toContain('Do not score');
  expect(questionNumber('Thanks. Question 2. How do you check data quality?')).toBe(1);
  expect(questionNumber('Could you say more about that?')).toBeNull();
});

it('issues a short-lived key in live mode only, up to three per run', async () => {
  process.env.PROVIDER_MODE = 'fixture';
  await expect(createVoiceSession(userId, missionId)).rejects.toMatchObject({ code: 'LIVE_ONLY' });

  process.env.PROVIDER_MODE = 'openai';
  process.env.OPENAI_NATIVE_API_KEY = 'test-only-not-a-real-key';
  const sent: any[] = [];
  const fetcher = (async (url: string, init: any) => {
    if (url.includes('/models/')) return new Response('{}', { status: 200 });
    sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ value: 'ek_test', expires_at: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  // A model the project cannot use is reported before any key is issued, and not counted.
  const noRealtime = (async (url: string) =>
    new Response('{}', {
      status: url.includes('gpt-realtime') ? 404 : 200,
    })) as unknown as typeof fetch;
  await expect(createVoiceSession(userId, missionId, noRealtime)).rejects.toMatchObject({
    code: 'VOICE_MODEL_UNAVAILABLE',
    message: expect.stringContaining('gpt-realtime-2.1'),
  });
  expect(
    ((await db.mission.findUniqueOrThrow({ where: { id: missionId } })).data as any).voiceSessions,
  ).toBeUndefined();

  const s = await createVoiceSession(userId, missionId, fetcher);
  expect(s).toMatchObject({
    clientSecret: 'ek_test',
    callsUrl: 'https://api.openai.com/v1/realtime/calls',
    limitSeconds: 600,
    remaining: VOICE_SESSIONS_PER_RUN - 1,
  });
  expect(sent[0].url).toBe('https://api.openai.com/v1/realtime/client_secrets');
  expect(sent[0].auth).toBe('Bearer test-only-not-a-real-key');
  expect(sent[0].body).toMatchObject({
    expires_after: { anchor: 'created_at', seconds: 60 },
    session: {
      type: 'realtime',
      audio: {
        input: { transcription: { model: 'gpt-4o-mini-transcribe' } },
        output: { voice: 'marin' },
      },
    },
  });
  expect(sent[0].body.session.instructions).toContain('Tell me about a report you built.');
  // The browser never sees the server key.
  expect(JSON.stringify(s)).not.toContain('test-only-not-a-real-key');

  for (let i = 1; i < VOICE_SESSIONS_PER_RUN; i++)
    await createVoiceSession(userId, missionId, fetcher);
  await expect(createVoiceSession(userId, missionId, fetcher)).rejects.toMatchObject({
    code: 'VOICE_LIMIT',
  });
  // A refused session is reported, not counted.
  const failing = (async (url: string) =>
    new Response('{}', {
      status: url.includes('/models/') ? 200 : 401,
    })) as unknown as typeof fetch;
  await db.mission.update({
    where: { id: missionId },
    data: { data: json({ questions, selectedJob: { job: { title: 'Data Analyst' } } }) },
  });
  await expect(createVoiceSession(userId, missionId, failing)).rejects.toMatchObject({
    code: 'VOICE_UNAVAILABLE',
  });
  const after = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
  expect((after.data as any).voiceSessions).toBeUndefined();
});

it('transcribes one recorded answer in live mode without keeping the audio (CFS-139)', async () => {
  await db.mission.update({
    where: { id: missionId },
    data: { status: 'AWAITING_INTERVIEW', data: json({ questions }) },
  });
  const audio = Buffer.from('fake-opus-bytes');
  process.env.PROVIDER_MODE = 'fixture';
  await expect(transcribeAnswer(userId, missionId, audio, 'audio/webm')).rejects.toMatchObject({
    code: 'LIVE_ONLY',
  });
  process.env.PROVIDER_MODE = 'openai';
  process.env.OPENAI_NATIVE_API_KEY = 'test-only-not-a-real-key';
  await expect(transcribeAnswer(userId, missionId, audio, 'text/plain')).rejects.toMatchObject({
    code: 'AUDIO_TYPE',
  });
  await expect(
    transcribeAnswer(userId, missionId, Buffer.alloc(0), 'audio/webm'),
  ).rejects.toMatchObject({
    code: 'AUDIO_EMPTY',
  });
  const sent: { url: string; model: unknown; file: any }[] = [];
  const fetcher = (async (url: string, init: any) => {
    const form = init.body as FormData;
    sent.push({ url, model: form.get('model'), file: form.get('file') });
    return new Response(
      JSON.stringify({ text: ' I cleaned the data with pandas. ', usage: { seconds: 8 } }),
      {
        status: 200,
      },
    );
  }) as unknown as typeof fetch;
  const r = await transcribeAnswer(userId, missionId, audio, 'audio/webm;codecs=opus', fetcher);
  expect(r).toMatchObject({ text: 'I cleaned the data with pandas.', seconds: 8 });
  expect(sent[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect(sent[0].model).toBe('gpt-transcribe');
  expect(sent[0].file.name).toBe('answer.webm');
  const after = (await db.mission.findUniqueOrThrow({ where: { id: missionId } })).data as any;
  expect(after.transcriptions).toMatchObject({ count: 1, seconds: 8, model: 'gpt-transcribe' });
  // Only text and counters are kept; no audio is written to the run.
  expect(JSON.stringify(after)).not.toContain('fake-opus-bytes');
});

it('reports which voice features the project can use, so the page hides the rest', async () => {
  process.env.PROVIDER_MODE = 'openai';
  process.env.OPENAI_NATIVE_API_KEY = 'test-only-not-a-real-key';
  // Like the project in the 2026-11-14 live check: gpt-transcribe only, no realtime model.
  const fetcher = (async (url: string) =>
    new Response('{}', {
      status: url.endsWith('/gpt-transcribe') ? 200 : 404,
    })) as unknown as typeof fetch;
  expect(await voiceStatus(fetcher)).toEqual({ realtime: false, transcribe: true });
});

it('transcribes a spoken Profile Builder message within a daily cap (CFS-143)', async () => {
  process.env.PROVIDER_MODE = 'openai';
  process.env.OPENAI_NATIVE_API_KEY = 'test-only-not-a-real-key';
  const sent: FormData[] = [];
  const fetcher = (async (_url: string, init: any) => {
    sent.push(init.body as FormData);
    return new Response(JSON.stringify({ text: ' 我在悉尼大学读统计。 ' }), { status: 200 });
  }) as unknown as typeof fetch;
  const audio = Buffer.from('fake-opus-bytes');
  const r = await transcribeProfileMessage(userId, audio, 'audio/webm', fetcher, '2026-11-15');
  expect(r).toMatchObject({
    text: '我在悉尼大学读统计。',
    remaining: PROFILE_TRANSCRIPTIONS_PER_DAY - 1,
  });
  // No language is forced, so Chinese and English both transcribe as spoken.
  expect(sent[0].get('language')).toBeNull();
  for (let i = 1; i < PROFILE_TRANSCRIPTIONS_PER_DAY; i++)
    await transcribeProfileMessage(userId, audio, 'audio/webm', fetcher, '2026-11-15');
  await expect(
    transcribeProfileMessage(userId, audio, 'audio/webm', fetcher, '2026-11-15'),
  ).rejects.toMatchObject({ code: 'TRANSCRIBE_LIMIT' });
  // A new day starts a new count.
  await expect(
    transcribeProfileMessage(userId, audio, 'audio/webm', fetcher, '2026-11-16'),
  ).resolves.toMatchObject({ remaining: PROFILE_TRANSCRIPTIONS_PER_DAY - 1 });
});
