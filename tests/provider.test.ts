import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generate } from '../packages/agents/src/provider.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('routes both tool and structured-output requests to the configured compatible endpoint', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'openai/gpt-oss-20b');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.groq.com/openai/v1');
  const requests: { url: string; body: any; authorization: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    const output =
      requests.length === 1
        ? [
            {
              id: 'fc_test',
              type: 'function_call',
              call_id: 'call_test',
              name: 'read_approved_context',
              arguments: '{}',
            },
          ]
        : [
            {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: '{"result":"ok"}', annotations: [] }],
            },
          ];
    return new Response(
      JSON.stringify({
        id: 'resp_test',
        object: 'response',
        status: 'completed',
        output,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  let calls = 0;
  const tools: string[] = [];
  const result = await generate(
    'coach',
    { goal: 'Find a role', facts: [] },
    z.object({ result: z.string() }),
    'openai',
    {
      onCall: async () => {
        calls++;
      },
      onTool: async (name) => {
        tools.push(name);
      },
      onUsage: async () => {},
    },
  );
  expect(result).toEqual({ result: 'ok' });
  expect(calls).toBe(2);
  expect(tools).toEqual(['read_approved_context']);
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.url).toBe('https://api.groq.com/openai/v1/responses');
    expect(request.authorization).toBe('Bearer test-only-not-a-real-key');
    expect(request.body.model).toBe('openai/gpt-oss-20b');
  }
  expect(requests[1].body.input).toContainEqual({
    type: 'function_call_output',
    call_id: 'call_test',
    output: '{"goal":"Find a role","facts":[]}',
  });
  expect(requests[1].body.text.format.type).toBe('json_schema');
});
