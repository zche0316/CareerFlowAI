import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { LightCall } from './light-model.js';

// One conversation turn as a small LangGraph loop (CFS-144):
//
//   perceive → update_plan → extract | converse → reflect → (revise once → reflect) → END
//
// perceive  classifies the message (answer, correction, question, small talk, …) and its language.
// plan      updates the agent's agenda: which goal is open, attempts per goal, what to park.
// extract   runs the domain's heavy step (structured extraction, scoring) only for real answers.
// converse  replies to questions, small talk and off-topic messages with the light model.
// reflect   checks the draft: repeated or looping question, wrong language, claims of changes
//           that did not happen, frustration. It may ask for one revision.
//
// The graph only orchestrates. Each agent supplies ports with its own prompts and rules, and the
// server keeps authority: ports validate every model suggestion, and nothing here approves data.

export const INTENTS = [
  'answer',
  'correction',
  'question',
  'small_talk',
  'control',
  'off_topic',
  'frustrated',
  'injection',
] as const;
export type Intent = (typeof INTENTS)[number];

export type Perception = {
  intent: Intent;
  language: string;
  /** The message gives information for the pending goal. */
  addressesPending: boolean;
  reason: string;
  source: 'model' | 'rules';
};

export type Route = 'extract' | 'converse';

export type Plan = {
  route: Route;
  /** Goal the next question serves; null when nothing is pending. */
  goal: string | null;
  /** Goals set aside this turn, to come back to later. */
  parked: string[];
  note?: string;
};

export type Draft = {
  reply: string;
  question: string | null;
  /** Stable id of the goal the question serves, so rephrased questions still count as repeats. */
  questionKey: string | null;
  changed: boolean;
};

export type Reflection = {
  problems: string[];
  revise: boolean;
};

export type TraceStep = {
  node: string;
  ms: number;
  detail?: string;
  calls?: LightCall[];
};

export type TurnPorts<Ctx> = {
  perceive(ctx: Ctx): Promise<{ perception: Perception; calls?: LightCall[] }>;
  plan(ctx: Ctx, perception: Perception): Promise<Plan>;
  extract(ctx: Ctx, perception: Perception, plan: Plan): Promise<Draft>;
  converse(
    ctx: Ctx,
    perception: Perception,
    plan: Plan,
  ): Promise<{ draft: Draft; calls?: LightCall[] }>;
  reflect(ctx: Ctx, perception: Perception, plan: Plan, draft: Draft): Promise<Reflection>;
  revise(
    ctx: Ctx,
    perception: Perception,
    plan: Plan,
    draft: Draft,
    reflection: Reflection,
  ): Promise<{ draft: Draft; calls?: LightCall[] }>;
};

const MAX_REVISIONS = 1;

export function buildTurnGraph<Ctx>(ports: TurnPorts<Ctx>) {
  const State = Annotation.Root({
    ctx: Annotation<Ctx>(),
    perception: Annotation<Perception | null>({ reducer: (_, v) => v, default: () => null }),
    plan: Annotation<Plan | null>({ reducer: (_, v) => v, default: () => null }),
    draft: Annotation<Draft | null>({ reducer: (_, v) => v, default: () => null }),
    reflection: Annotation<Reflection | null>({ reducer: (_, v) => v, default: () => null }),
    revisions: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
    trace: Annotation<TraceStep[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  });
  type S = typeof State.State;
  const timed = async <T>(work: () => Promise<T>) => {
    const started = Date.now();
    const value = await work();
    return { value, ms: Date.now() - started };
  };

  return new StateGraph(State)
    .addNode('perceive', async (s: S) => {
      const { value, ms } = await timed(() => ports.perceive(s.ctx));
      return {
        perception: value.perception,
        trace: [
          {
            node: 'perceive',
            ms,
            detail: `${value.perception.intent} (${value.perception.source})`,
            calls: value.calls,
          },
        ],
      };
    })
    .addNode('update_plan', async (s: S) => {
      const { value, ms } = await timed(() => ports.plan(s.ctx, s.perception!));
      return {
        plan: value,
        trace: [
          {
            node: 'plan',
            ms,
            detail: [
              value.route,
              value.goal || 'no goal',
              ...value.parked.map((p) => `parked ${p}`),
            ]
              .concat(value.note ? [value.note] : [])
              .join(' · '),
          },
        ],
      };
    })
    .addNode('extract', async (s: S) => {
      const { value, ms } = await timed(() => ports.extract(s.ctx, s.perception!, s.plan!));
      return { draft: value, trace: [{ node: 'extract', ms }] };
    })
    .addNode('converse', async (s: S) => {
      const { value, ms } = await timed(() => ports.converse(s.ctx, s.perception!, s.plan!));
      return { draft: value.draft, trace: [{ node: 'converse', ms, calls: value.calls }] };
    })
    .addNode('reflect', async (s: S) => {
      const { value, ms } = await timed(() =>
        ports.reflect(s.ctx, s.perception!, s.plan!, s.draft!),
      );
      return {
        reflection: value,
        trace: [{ node: 'reflect', ms, detail: value.problems.join(', ') || 'ok' }],
      };
    })
    .addNode('revise', async (s: S) => {
      const { value, ms } = await timed(() =>
        ports.revise(s.ctx, s.perception!, s.plan!, s.draft!, s.reflection!),
      );
      return {
        draft: value.draft,
        revisions: s.revisions + 1,
        trace: [{ node: 'revise', ms, calls: value.calls }],
      };
    })
    .addEdge(START, 'perceive')
    .addEdge('perceive', 'update_plan')
    .addConditionalEdges('update_plan', (s: S) => s.plan!.route, ['extract', 'converse'])
    .addEdge('extract', 'reflect')
    .addEdge('converse', 'reflect')
    .addConditionalEdges(
      'reflect',
      (s: S) => (s.reflection!.revise && s.revisions < MAX_REVISIONS ? 'revise' : END),
      ['revise', END],
    )
    .addEdge('revise', 'reflect')
    .compile();
}

export type TurnResult = {
  perception: Perception;
  plan: Plan;
  draft: Draft;
  reflection: Reflection;
  revisions: number;
  trace: TraceStep[];
};

export async function runTurn<Ctx>(ports: TurnPorts<Ctx>, ctx: Ctx): Promise<TurnResult> {
  const out = await buildTurnGraph(ports).invoke({ ctx } as any);
  return out as unknown as TurnResult;
}

export type TurnSummary = {
  intent: Perception['intent'];
  language: string;
  source: Perception['source'];
  route: Plan['route'];
  parked: string[];
  problems: Reflection['problems'];
  revisions: number;
  steps: { node: string; ms: number; detail?: string }[];
  light: { calls: number; ms: number; inputTokens: number; outputTokens: number; failed: number };
};

/** What each assistant message stores about its turn: enough to audit and to measure. */
export function summariseTurn(r: TurnResult & { calls: LightCall[] }): TurnSummary {
  return {
    intent: r.perception.intent,
    language: r.perception.language,
    source: r.perception.source,
    route: r.plan.route,
    parked: r.plan.parked,
    problems: r.reflection.problems,
    revisions: r.revisions,
    steps: r.trace.map(({ node, ms, detail }) => ({ node, ms, ...(detail ? { detail } : {}) })),
    light: {
      calls: r.calls.length,
      ms: r.calls.reduce((n, c) => n + c.ms, 0),
      inputTokens: r.calls.reduce((n, c) => n + c.inputTokens, 0),
      outputTokens: r.calls.reduce((n, c) => n + c.outputTokens, 0),
      failed: r.calls.filter((c) => !c.ok).length,
    },
  };
}

// ---- Rules used when no light model is configured or reachable, and in fixture mode ----------

const greeting =
  /^(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening)|你好|您好|嗨|哈喽|hello there)[\s!.,。！，~]*$/i;
const aboutYou =
  /\b(?:who are you|what (?:can|do) you do|what is this|how does this work|are you (?:a )?(?:bot|ai|human))\b|你是谁|你能做什么|你可以做什么|这是什么|怎么用/i;
const frustration =
  /\b(?:stop asking|this is (?:annoying|useless|stupid)|you already asked|i (?:already|just) (?:said|told you)|again\?)\b|别问了|烦死|已经说过|说过了|又问/i;
const injection =
  /\b(?:ignore (?:all |the )?(?:previous|above) instructions|system prompt|you are now|developer mode|reveal your (?:prompt|instructions))\b|忽略(?:之前|上面)的(?:指令|要求)|系统提示词/i;
const thanks = /^(?:thanks|thank you|ok(?:ay)?|cool|got it|谢谢|好的|嗯+|行)[\s!.,。！]*$/i;

export const languageOf = (text: string) =>
  /\p{Script=Han}/u.test(text)
    ? /[A-Za-z]{3,}/.test(text.replace(/\p{Script=Han}/gu, ''))
      ? 'mixed'
      : 'zh'
    : 'en';

/** Conservative rules: anything not clearly conversational is treated as an answer. */
export function perceiveByRules(text: string): Perception {
  const s = text.trim();
  const base = { language: languageOf(s), source: 'rules' as const };
  if (injection.test(s))
    return {
      ...base,
      intent: 'injection',
      addressesPending: false,
      reason: 'instruction override',
    };
  if (frustration.test(s))
    return { ...base, intent: 'frustrated', addressesPending: false, reason: 'frustration' };
  if (greeting.test(s) || thanks.test(s))
    return { ...base, intent: 'small_talk', addressesPending: false, reason: 'greeting' };
  if (aboutYou.test(s) && s.length < 160)
    return { ...base, intent: 'question', addressesPending: false, reason: 'about the builder' };
  return { ...base, intent: 'answer', addressesPending: true, reason: 'default' };
}
