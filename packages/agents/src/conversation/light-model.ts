import OpenAI from 'openai';
import { z } from 'zod';

// Small, fast model calls for the conversation turn graph (CFS-144): perceiving a message,
// replying to small talk and reflecting on a draft reply. They run before or around the main
// extraction model, so they must be quick and cheap. Routes are tried in order: Groq's open
// model, then the native OpenAI light model. When every route fails the caller falls back to
// rules, so a provider outage never breaks the conversation.

export type LightRoute = { name: string; model: string; baseURL: string; apiKey: string };
export type LightCall = {
  route: string;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
  error?: string;
};

export function lightRoutes(env = process.env): LightRoute[] {
  const routes: LightRoute[] = [];
  const groq = env.GROQ_API_KEY?.trim();
  if (groq)
    routes.push({
      name: 'groq',
      model: env.CONVERSATION_LIGHT_MODEL?.trim() || 'openai/gpt-oss-20b',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: groq,
    });
  const native = env.OPENAI_NATIVE_API_KEY?.trim();
  const nativeModel =
    env.OPENAI_NATIVE_LIGHT_MODEL?.trim() || env.OPENAI_NATIVE_TEXT_MODEL?.trim() || '';
  if (native && nativeModel)
    routes.push({
      name: 'openai',
      model: nativeModel,
      baseURL: env.OPENAI_NATIVE_BASE_URL?.trim() || 'https://api.openai.com/v1',
      apiKey: native,
    });
  return routes;
}

const clients = new Map<string, OpenAI>();
const clientFor = (r: LightRoute) => {
  const key = `${r.baseURL}|${r.apiKey.slice(-6)}`;
  if (!clients.has(key))
    clients.set(key, new OpenAI({ apiKey: r.apiKey, baseURL: r.baseURL, maxRetries: 0 }));
  return clients.get(key)!;
};

const reasoning = (model: string) =>
  model.startsWith('openai/gpt-oss-')
    ? { reasoning_effort: 'low' as const }
    : /^gpt-6/.test(model)
      ? { reasoning_effort: 'none' as const }
      : model.startsWith('qwen/')
        ? { reasoning_effort: 'none' as const }
        : {};

/**
 * One JSON call to the first light route that answers. Returns null when no route is
 * configured or all of them fail; `calls` records every attempt for the turn trace.
 */
export async function lightJson<T>(
  system: string,
  user: unknown,
  schema: z.ZodType<T>,
  calls: LightCall[],
  {
    timeoutMs = 6000,
    maxTokens = 600,
    routes = lightRoutes(),
  }: { timeoutMs?: number; maxTokens?: number; routes?: LightRoute[] } = {},
): Promise<T | null> {
  for (const route of routes) {
    const started = Date.now();
    try {
      const r = await clientFor(route).chat.completions.create(
        {
          model: route.model,
          messages: [
            { role: 'system', content: `${system}\nReturn one JSON object only.` },
            { role: 'user', content: JSON.stringify(user) },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: maxTokens,
          ...reasoning(route.model),
        } as any,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      const text = r.choices[0]?.message?.content || '';
      const parsed = schema.parse(JSON.parse(text));
      calls.push({
        route: route.name,
        model: route.model,
        ms: Date.now() - started,
        inputTokens: r.usage?.prompt_tokens || 0,
        outputTokens: r.usage?.completion_tokens || 0,
        ok: true,
      });
      return parsed;
    } catch (error) {
      const e = error as any;
      calls.push({
        route: route.name,
        model: route.model,
        ms: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        ok: false,
        error:
          e?.status === 429
            ? 'rate-limit'
            : e?.name === 'TimeoutError' || e?.name === 'AbortError'
              ? 'timeout'
              : e instanceof z.ZodError || e instanceof SyntaxError
                ? 'invalid-response'
                : e?.status
                  ? `http-${e.status}`
                  : 'error',
      });
    }
  }
  return null;
}
