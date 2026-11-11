import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generate, type ProviderSpan } from '../packages/agents/src/provider.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const quiet = { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} };

it('emits exactly one span for a fixture call, with no model and no tokens', async () => {
  const spans: ProviderSpan[] = [];
  const result = await generate(
    'critic',
    { goal: 'Fictional goal', facts: [{ id: 'f1', kind: 'skill', text: 'SQL' }] },
    z.object({ issues: z.array(z.unknown()) }),
    'fixture',
    { ...quiet, onSpan: async (s) => void spans.push(s) },
  );
  expect(result).toEqual({ issues: [] });
  expect(spans).toHaveLength(1);
  expect(spans[0]).toMatchObject({
    role: 'critic',
    model: 'fixture',
    mode: 'fixture',
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    status: 'ok',
  });
  expect(spans[0].error).toBeUndefined();
  // Spans carry counts only, never task text.
  expect(JSON.stringify(spans[0])).not.toMatch(/Fictional goal|SQL/);
});

it('keeps generating when the span hook throws', async () => {
  const result = await generate(
    'critic',
    { goal: 'Fictional goal', facts: [] },
    z.object({ issues: z.array(z.unknown()) }),
    'fixture',
    {
      ...quiet,
      onSpan: async () => {
        throw Error('trace store down');
      },
    },
  );
  expect(result).toEqual({ issues: [] });
});

it('records a failed call with its attempts, tokens and a short error class, then rethrows', async () => {
  vi.stubEnv('OPENAI_NATIVE_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  vi.stubEnv('TEXT_MODEL', '');
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: 42 }) } }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const spans: ProviderSpan[] = [];
  const usage = vi.fn(async () => {});
  await expect(
    generate(
      'wording',
      { goal: 'Fictional wording', facts: [], sourceText: 'Secret source sentence' },
      z.object({ text: z.string() }),
      'openai',
      { ...quiet, onUsage: usage, onSpan: async (s) => void spans.push(s) },
    ),
  ).rejects.toBeInstanceOf(z.ZodError);
  // The caller's own hooks still see every call and token.
  expect(usage).toHaveBeenCalledWith(7, 3);
  expect(spans).toHaveLength(1);
  expect(spans[0]).toMatchObject({
    role: 'wording',
    model: 'test-model',
    mode: 'openai',
    attempts: 1,
    inputTokens: 7,
    outputTokens: 3,
    status: 'error',
    error: 'schema',
  });
  expect(JSON.stringify(spans[0])).not.toContain('Secret source sentence');
});
