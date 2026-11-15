import { afterEach, expect, it } from 'vitest';
import OpenAI from 'openai';
import { modelClient, traceTurn, tracingEnabled } from '../packages/agents/src/tracing.js';

// CFS-149: LangSmith tracing is opt-in and needs both the switch and a key.
const saved = { ...process.env };
afterEach(() => {
  process.env.LANGSMITH_TRACING = saved.LANGSMITH_TRACING;
  process.env.LANGSMITH_API_KEY = saved.LANGSMITH_API_KEY;
});
const off = () => {
  delete process.env.LANGSMITH_TRACING;
  delete process.env.LANGSMITH_API_KEY;
};

it('stays off without both the switch and a key', () => {
  off();
  expect(tracingEnabled()).toBe(false);
  process.env.LANGSMITH_TRACING = 'true';
  expect(tracingEnabled()).toBe(false);
  const plain = new OpenAI({ apiKey: 'test', maxRetries: 0 });
  const client = modelClient({ apiKey: 'test', maxRetries: 0 }, { agent: 'conversation' });
  expect(client.chat.completions.create).toBe(client.chat.completions.create);
  expect(Object.getPrototypeOf(client)).toBe(Object.getPrototypeOf(plain));
});

it('wraps model clients only when tracing is on', () => {
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_API_KEY = 'test-key-not-real';
  const plain = new OpenAI({ apiKey: 'test', maxRetries: 0 });
  const client = modelClient({ apiKey: 'test', maxRetries: 0 }, { agent: 'conversation' });
  expect(client.responses.parse).not.toBe(plain.responses.parse);
});

it('runs the turn unchanged when tracing is off', async () => {
  off();
  const turn = traceTurn('test-turn', async (n: number) => n + 1);
  expect(await turn(1)).toBe(2);
});
