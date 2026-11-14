import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '../apps/api/src/db.js';
import { json } from '../apps/api/src/domain.js';
import {
  createVoiceSession,
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
