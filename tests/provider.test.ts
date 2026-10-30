import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { missionContext } from '../packages/agents/src/mission-context.js';
import { generate, providerTimeoutMs } from '../packages/agents/src/provider.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('enforces the configured provider deadline below the 30-second budget', async () => {
  vi.stubEnv('PROVIDER_TIMEOUT_MS', '50');
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  let aborted = false;
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(Error('Missing request signal'));
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new DOMException('Provider deadline reached', 'AbortError'));
        },
        { once: true },
      );
    });
  });
  const started = performance.now();
  await expect(
    generate(
      'coach',
      { goal: 'Find a role', facts: [] },
      z.object({ result: z.string() }),
      'openai',
      {
        onCall: async () => {},
        onTool: async () => {},
        onUsage: async () => {},
      },
    ),
  ).rejects.toThrow();
  expect(aborted).toBe(true);
  expect(performance.now() - started).toBeLessThan(1000);
  expect(providerTimeoutMs()).toBe(50);
  vi.stubEnv('PROVIDER_TIMEOUT_MS', '30001');
  expect(() => providerTimeoutMs()).toThrow(/between 10 and 30000/);
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
    expect(request.body.reasoning).toEqual({ effort: 'low' });
  }
  expect(requests[1].body.input).toContainEqual({
    type: 'function_call_output',
    call_id: 'call_test',
    output: '{"goal":"Find a role","facts":[]}',
  });
  expect(requests[0].body.max_output_tokens).toBe(1024);
  expect(requests[1].body.max_output_tokens).toBe(3000);
  expect(requests[1].body.text.format.type).toBe('json_schema');
});

it('disables DeepSeek thinking mode for the required context-tool handshake', async () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'deepseek-flash');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.deepseek.com');
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
              id: 'fc_deepseek',
              type: 'function_call',
              call_id: 'call_deepseek',
              name: 'read_approved_context',
              arguments: '{}',
            },
          ]
        : [
            {
              id: 'msg_deepseek',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: '{"result":"ok"}', annotations: [] }],
            },
          ];
    return new Response(
      JSON.stringify({
        id: 'resp_deepseek',
        object: 'response',
        status: 'completed',
        output,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  const result = await generate(
    'questions',
    {
      goal: 'Prepare for an analyst interview',
      facts: [],
      job: { title: 'Junior Data Analyst', description: 'Use SQL for reporting.' },
    },
    z.object({ result: z.string() }),
    'openai',
    {
      onCall: async () => {},
      onTool: async () => {},
      onUsage: async () => {},
    },
  );

  expect(result).toEqual({ result: 'ok' });
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.url).toBe('https://api.deepseek.com/responses');
    expect(request.authorization).toBe('Bearer test-only-not-a-real-key');
    expect(request.body.model).toBe('deepseek-flash');
    expect(request.body.reasoning).toEqual({ effort: 'none' });
  }
});

it('reprompts once when a compatible provider violates the declared schema', async () => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'deepseek-flash');
  vi.stubEnv('OPENAI_BASE_URL', 'https://api.deepseek.com');
  const requests: { body: any }[] = [];
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body)) });
    const output =
      requests.length === 1
        ? [
            {
              id: 'fc_retry',
              type: 'function_call',
              call_id: 'call_retry',
              name: 'read_approved_context',
              arguments: '{}',
            },
          ]
        : [
            {
              id: `msg_retry_${requests.length}`,
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: requests.length === 2 ? '{"result":42}' : '{"result":"corrected"}',
                  annotations: [],
                },
              ],
            },
          ];
    return new Response(
      JSON.stringify({
        id: `resp_retry_${requests.length}`,
        object: 'response',
        status: 'completed',
        output,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const calls: number[] = [];
  const result = await generate(
    'coach',
    { goal: 'Find a role', facts: [] },
    z.object({ result: z.string() }),
    'openai',
    {
      onCall: async () => {
        calls.push(1);
      },
      onTool: async () => {},
      onUsage: async () => {},
    },
  );

  expect(result).toEqual({ result: 'corrected' });
  expect(calls).toHaveLength(3);
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests[2].body.input)).toContain('result: Invalid input');
});

it('supports partial interactive profile JSON in one bounded call without strict optional-field formatting', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  const requests: any[] = [];
  vi.stubGlobal('fetch', async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ name: 'Fictional Casey' }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const result = await generate(
    'profile',
    { goal: 'Fictional profile', facts: [] },
    z.object({ name: z.string().optional(), location: z.string().optional() }),
    'openai',
    { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
  );
  expect(result).toEqual({ name: 'Fictional Casey' });
  expect(requests).toHaveLength(1);
  expect(requests[0].response_format.type).toBe('json_object');
  expect(requests[0].store).toBe(false);
});

it('rejects invalid interactive JSON contracts without a hidden retry', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: 42 }) } }] }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  await expect(
    generate(
      'wording',
      { goal: 'Fictional wording', facts: [] },
      z.object({ text: z.string() }),
      'openai',
      { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
    ),
  ).rejects.toBeInstanceOf(z.ZodError);
  expect(calls).toBe(1);
});

it('accepts empty legacy summaries in a structured-record conversational response', async () => {
  const { profileBuilderDraftSchema } = await import('../packages/contracts/src/index.js');
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'test-model');
  const answer = {
    builder: {
      draft: {
        name: '',
        goals: '',
        careerStage: '',
        experienceYears: null,
        education: '',
        experience: '',
      },
      proposedChanges: [],
      followUpQuestions: ['What did you do?'],
    },
    records: [],
  };
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const result = await generate(
    'conversation',
    { goal: 'Build from structured records', facts: [] },
    z.object({ builder: profileBuilderDraftSchema, records: z.array(z.unknown()) }),
    'openai',
    { onCall: async () => {}, onTool: async () => {}, onUsage: async () => {} },
  );
  expect(result.builder.draft.education).toBe('');
  expect(result.builder.draft.experience).toBe('');
  expect(result.builder.draft.experienceYears).toBeUndefined();
});

it('sends coach only approved profile content and goal, without duplicated quotations or unrelated steps', () => {
  const fact = {
    id: 'p-1',
    kind: 'experience',
    text: 'I wrote 20 tests.',
    source: 'Approved profile',
    recordId: 'project-1',
    recordHeaderId: 'header-1',
    conversationEvidence: [
      { threadId: 't', messageId: 'm', quote: 'RAW-PRIVATE-CONVERSATION'.repeat(1000) },
    ],
  };
  const input = {
    goal: 'Find an analyst role',
    facts: [fact],
    retrievedEvidence: [{ id: 'memory', text: 'UNRELATED-MEMORY' }],
    job: { title: 'Other job', description: 'UNRELATED-JOB' },
    answers: [{ questionId: 'q', answer: 'UNRELATED-ANSWER' }],
  };
  const compact = missionContext('coach', input);
  expect(compact).toEqual({
    goal: input.goal,
    facts: [
      {
        id: fact.id,
        kind: fact.kind,
        text: fact.text,
      },
    ],
  });
  expect(JSON.stringify(compact)).not.toMatch(/RAW-PRIVATE|UNRELATED|conversationEvidence|quote/);
  expect(JSON.stringify(input)).toContain('RAW-PRIVATE');
  expect(missionContext('feedback', input).answers).toEqual(input.answers);
  expect(missionContext('resume', input).job).toEqual(input.job);
  expect(missionContext('resume', input).facts[0]).toEqual({
    id: fact.id,
    kind: fact.kind,
    text: fact.text,
  });
  expect(missionContext('feedback', input).facts).toEqual([]);
});

it('repairs a provider-side JSON-schema 400 once and validates the complete feedback', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('OPENAI_MODEL', 'openai/gpt-oss-120b');
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    if (calls === 2)
      return new Response(
        JSON.stringify({
          error: {
            message: 'Generated JSON does not match the expected schema.',
            type: 'invalid_request_error',
            code: 'json_validate_failed',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    const output =
      calls === 1
        ? [
            {
              id: 'fc',
              type: 'function_call',
              call_id: 'c',
              name: 'read_approved_context',
              arguments: '{}',
            },
          ]
        : [
            {
              id: 'msg',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    strengths: ['Honest scope'],
                    improvements: ['Add an actual example'],
                    nextSteps: ['Practise a concrete diagnostic case'],
                  }),
                  annotations: [],
                },
              ],
            },
          ];
    return new Response(
      JSON.stringify({
        id: 'resp',
        object: 'response',
        status: 'completed',
        output,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  const schema = z.object({
    strengths: z.array(z.string()).min(1),
    improvements: z.array(z.string()).min(1),
    nextSteps: z.array(z.string()).min(1),
  });
  const r = await generate('feedback', { goal: 'Practice', facts: [] }, schema, 'openai', {
    onCall: async () => {},
    onTool: async () => {},
    onUsage: async () => {},
  });
  expect(calls).toBe(3);
  expect(r.improvements).toEqual(['Add an actual example']);
  expect(r.nextSteps).toHaveLength(1);
});
