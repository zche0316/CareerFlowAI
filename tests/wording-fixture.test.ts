import { expect, it } from 'vitest';
import { z } from 'zod';
import { generate } from '../packages/agents/src/provider.js';
import { checkWording } from '../packages/contracts/src/career-evidence.js';

const hooks = { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} };
const suggest = async (sourceText: string) =>
  (
    await generate(
      'wording',
      { goal: 'Fictional wording', facts: [], sourceText },
      z.object({ text: z.string(), reason: z.string() }),
      'fixture',
      hooks,
    )
  ).text;

it('offline wording drops first-person and filler lead-ins, passes the guard and is stable', async () => {
  expect(await suggest('I used SQL to clean 120 records.')).toBe('used SQL to clean 120 records.');
  const source = 'I was responsible for cleaning 120 records with SQL.';
  const text = await suggest(source);
  expect(text).toBe('Cleaning 120 records with SQL.');
  expect(checkWording(source, text)).toBeNull();
  expect(await suggest(text)).toBe(text);
});
