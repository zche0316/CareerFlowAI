import { expect, it } from 'vitest';
import { profileModelNotes, searchProfileHistory } from '../apps/api/src/profile-context.js';
import { providerTimeoutMs, parseProviderJson } from '../packages/agents/src/provider.js';

it('sends only the current answer, including during saved-answer recovery', () => {
  const messages = Array.from({ length: 15 }, (_, i) => ({ text: `Original answer ${i}` }));
  const original = structuredClone(messages);
  expect(profileModelNotes(messages)).toBe('Message 15: Original answer 14');
  expect(profileModelNotes(messages, true)).not.toContain('Original answer 0');
  expect(messages).toEqual(original);
});
it('retrieves bounded exact history excerpts with stable page references only on search', () => {
  const messages = [
    { id: 'one', text: 'SQL reporting at Northstar' },
    { id: 'two', text: 'University education' },
    { id: 'three', text: 'SQL analysis at Northstar' },
  ];
  const result = searchProfileHistory(messages, 'SQL');
  expect(result.hits.map((h) => h.messageId)).toEqual(['three', 'one']);
  expect(result.hits[1]).toMatchObject({ page: 1, text: messages[0].text });
  expect(searchProfileHistory(messages, 'unknown').hits).toEqual([]);
  expect(searchProfileHistory(messages, '*').nextOffset).toBe(2);
  expect(searchProfileHistory(messages, '*', 2).hits).toHaveLength(1);
});

it('keeps a maximum-size latest answer within the interactive context bound', () => {
  expect(profileModelNotes([{ text: 'a'.repeat(4000) }, { text: 'b'.repeat(4000) }])).toBe(
    'Message 2: ' + 'b'.repeat(4000),
  );
});
it('accepts a JSON code fence but rejects incomplete or prose-wrapped responses', () => {
  expect(parseProviderJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  expect(() => parseProviderJson('{"ok":')).toThrow();
  expect(() => parseProviderJson('Here is the answer: {"ok":true}')).toThrow();
});

it('gives profile conversations a longer bound without changing durable mission timeouts', () => {
  const old = process.env.PROFILE_TIMEOUT_MS;
  delete process.env.PROFILE_TIMEOUT_MS;
  try {
    expect(providerTimeoutMs('conversation')).toBe(60000);
    process.env.PROFILE_TIMEOUT_MS = '75001';
    expect(() => providerTimeoutMs('conversation')).toThrow(/75000/);
  } finally {
    if (old === undefined) delete process.env.PROFILE_TIMEOUT_MS;
    else process.env.PROFILE_TIMEOUT_MS = old;
  }
});
