import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { generate } from '../packages/agents/src/provider.js';
import type { Fact } from '../packages/contracts/src/index.js';

// No database, personal records, approval or application submission is used here.
const endpoint = 'https://api.groq.com/openai/v1';
const model = 'openai/gpt-oss-20b';
const args = process.argv.slice(2);
if (args.some((arg) => !['--check', '--run'].includes(arg)) || args.length > 1) {
  console.error('Usage: npm run test:live:uc4 -- [--check|--run]');
  process.exit(2);
}
const run = args[0] === '--run';
const key = process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
const configuredForGroq =
  Boolean(process.env.GROQ_API_KEY?.trim()) ||
  process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, '') === endpoint;
const ready = Boolean(key && configuredForGroq);

if (!run) {
  console.log(
    JSON.stringify(
      {
        check: 'configuration-only; no network request',
        endpoint,
        model,
        keyPresent: Boolean(key),
        configuredForGroq,
        ready,
        appMode: process.env.PROVIDER_MODE || 'fixture',
        next: ready
          ? 'Run npm run test:live:uc4 -- --run for the fictional UC4 provider smoke test.'
          : 'Set OPENAI_BASE_URL to the Groq endpoint and OPENAI_API_KEY locally, or set GROQ_API_KEY. Keep the account on Free plan.',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (!ready) {
  console.error(
    'Live test blocked: a local Groq key and Groq endpoint selection are required. No request sent.',
  );
  process.exit(2);
}

// Override only this process; leave the running app and its .env mode unchanged.
process.env.OPENAI_API_KEY = key!;
process.env.OPENAI_BASE_URL = endpoint;
process.env.OPENAI_MODEL = model;
process.env.PROVIDER_TIMEOUT_MS = '25000';
const facts: Fact[] = [
  { id: 'skill-sql', kind: 'skill', text: 'SQL', source: 'Fictional smoke-test profile' },
  { id: 'skill-python', kind: 'skill', text: 'Python', source: 'Fictional smoke-test profile' },
  {
    id: 'education-1',
    kind: 'education',
    text: 'Bachelor of Information Technology (fictional)',
    source: 'Fictional smoke-test profile',
  },
  {
    id: 'experience-1',
    kind: 'experience',
    text: 'Built a student project that cleaned sample data and produced SQL reports.',
    source: 'Fictional smoke-test profile',
  },
];
const ids = facts.map((fact) => fact.id) as [string, ...string[]];
const schema = z.object({
  claims: z
    .array(
      z.object({
        factId: z.enum(ids),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .min(1)
    .max(20),
});
let calls = 0,
  inputTokens = 0,
  outputTokens = 0;
const toolEvents: string[] = [];
const started = performance.now();
const baseReport = {
  recordedAt: new Date().toISOString(),
  endpoint,
  model,
  scope:
    'Provider-only UC4 smoke test with fictional evidence; not browser, persistence or end-to-end acceptance.',
};
let report: Record<string, unknown>;
try {
  const plan = await generate(
    'resume',
    {
      goal: 'Tailor a fictional candidate resume for a junior data analyst role.',
      facts,
      job: {
        title: 'Junior Data Analyst (fictional)',
        description:
          'Use SQL and Python to clean data and prepare reports. This is a fictional test vacancy.',
      },
    },
    schema,
    'openai',
    {
      onCall: async () => {
        if (++calls > 3) throw Error('Smoke test call budget exceeded.');
      },
      onTool: async (name) => {
        toolEvents.push(name);
      },
      onUsage: async (input, output) => {
        inputTokens += input;
        outputTokens += output;
      },
    },
  );
  if (toolEvents.length !== 1 || toolEvents[0] !== 'read_approved_context') {
    throw Error('Context tool verification failed.');
  }
  // Match workflow semantics: deduplicate selected IDs and render original evidence verbatim.
  const seen = new Set<string>();
  const claims = plan.claims
    .filter((claim) => {
      if (seen.has(claim.factId)) return false;
      seen.add(claim.factId);
      return true;
    })
    .map((claim) => ({ ...claim, text: facts.find((fact) => fact.id === claim.factId)!.text }));
  report = {
    ...baseReport,
    status: 'passed',
    calls,
    toolEvents,
    inputTokens,
    outputTokens,
    elapsedMs: Math.round(performance.now() - started),
    claims,
    qualityReview:
      'Human review of selection relevance is still required; schema validity alone does not establish quality.',
  };
} catch (error) {
  // Raw provider errors may contain request details. Store only bounded status/category data.
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : null;
  report = {
    ...baseReport,
    status: 'failed',
    calls,
    toolEvents,
    inputTokens,
    outputTokens,
    elapsedMs: Math.round(performance.now() - started),
    httpStatus: status && Number.isFinite(status) ? status : null,
    next:
      status === 429
        ? 'Free-tier limit reached. Wait before a manual retry; no automatic retry or paid upgrade.'
        : status === 401
          ? 'Check the local Groq key.'
          : 'Inspect provider compatibility, deadline or output validation. No fixture fallback was used.',
  };
  process.exitCode = 1;
}
await mkdir('output', { recursive: true });
const evidencePath = `output/live-uc4-smoke-${Date.now()}.json`;
await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, evidencePath }, null, 2));
