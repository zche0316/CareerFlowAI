// Optional LangSmith tracing for debugging model behaviour (CFS-149).
//
// Off unless LANGSMITH_TRACING=true and LANGSMITH_API_KEY are both set. When on, every model
// call (prompt, structured output, tokens, latency) and every conversation turn is sent to
// LangSmith, including the user's own messages: use it on development and test accounts only.
// LangGraph graphs report their nodes by themselves under the same switch; wrapping a turn with
// `traceTurn` makes its graph nodes and model calls one tree.
import OpenAI, { type ClientOptions } from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers';
import { traceable } from 'langsmith/traceable';

export const tracingEnabled = () =>
  process.env.LANGSMITH_TRACING === 'true' && Boolean(process.env.LANGSMITH_API_KEY);

/** An OpenAI-compatible client whose calls appear in LangSmith when tracing is on. */
export function modelClient(options: ClientOptions, label: { agent: string; model?: string }) {
  const client = new OpenAI(options);
  if (!tracingEnabled()) return client;
  return wrapOpenAI(client, {
    name: label.agent,
    tags: ['careerflow', label.agent],
    metadata: { agent: label.agent, ...(label.model ? { model: label.model } : {}) },
  }) as OpenAI;
}

/**
 * Runs one conversation turn as a named LangSmith trace when tracing is on, so the turn graph's
 * nodes and its model calls group under one run. Metadata must not carry personal details.
 */
export function traceTurn<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  metadata: Record<string, string> = {},
): (...args: A) => Promise<R> {
  // Decided per call: .env may load after this module is imported.
  let traced: ((...args: A) => Promise<R>) | null = null;
  return (...args: A) => {
    if (!tracingEnabled()) return fn(...args);
    traced ??= traceable(fn, {
      name,
      run_type: 'chain',
      tags: ['careerflow', 'turn'],
      metadata,
    }) as unknown as (...args: A) => Promise<R>;
    return traced(...args);
  };
}
