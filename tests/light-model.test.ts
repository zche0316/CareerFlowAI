import { afterEach, expect, it } from 'vitest';
import {
  coolDown,
  coolingDown,
  lightJson,
  resetCooldowns,
} from '../packages/agents/src/conversation/light-model.js';
import { z } from 'zod';
import { classifyControl } from '../apps/api/src/profile-turn.js';

// CFS-153: a rate-limited light route is skipped for a while instead of being retried each call.
afterEach(resetCooldowns);

it('cools a route down for Retry-After seconds, capped at an hour, or five minutes by default', () => {
  const now = 1_000_000;
  coolDown('groq', 120, now);
  expect(coolingDown('groq', now + 119_000)).toBe(true);
  expect(coolingDown('groq', now + 121_000)).toBe(false);
  coolDown('groq', undefined, now);
  expect(coolingDown('groq', now + 299_000)).toBe(true);
  expect(coolingDown('groq', now + 301_000)).toBe(false);
  coolDown('groq', 86_400, now);
  expect(coolingDown('groq', now + 3_599_000)).toBe(true);
  expect(coolingDown('groq', now + 3_601_000)).toBe(false);
});

it('skips a cooling route without a request and returns null when none is left', async () => {
  coolDown('groq');
  const calls: any[] = [];
  const out = await lightJson('x', {}, z.object({}), calls, {
    routes: [{ name: 'groq', model: 'm', baseURL: 'http://127.0.0.1:9', apiKey: 'k' }],
  });
  expect(out).toBeNull();
  expect(calls).toEqual([]);
});

// CFS-155: only short messages with a steering word reach the model.
it('does not spend a model call on ordinary answers', async () => {
  const calls: any[] = [];
  expect(await classifyControl('Sam Rivera', null, calls)).toBeNull();
  expect(
    await classifyControl('I owned the data pipeline and cleaned it in Python.', null, calls),
  ).toBeNull();
  expect(calls).toEqual([]);
});
