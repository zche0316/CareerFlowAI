// Runs the scripted Profile Builder conversations (data/conversation-eval/profile-builder.json)
// against a running CareerFlow server and measures how the conversation is handled (CFS-144).
//
//   npx tsx scripts/conversation-eval.ts http://localhost:8788 --label after [--tier goal] [--only id]
//   npx tsx scripts/conversation-eval.ts --rescore output/conversation-eval/<file>.json
//
// Each dialogue uses a new fictional account. In live mode this costs model calls: run it against
// a separate database, never the one you use day to day.
//
// Metrics
// - wrong advance: a message with no career information moved the interview to another question
//   without saying it was set aside (the bug in CFS-143).
// - re-asked after an answer: the user answered, and the next message asked the same question
//   again (the agent ignored or lost the answer).
// - stuck: a dialogue where that happened twice in a row.
// - intent accuracy: the turn graph's answer/other call against the label (new version only).
// - extraction recall: expected values found in the profile draft after the last turn.
// - failures, latency per turn, and calls to the extraction model.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { blankProfile } from '../packages/contracts/src/index.js';

type Turn = { text: string; kind: 'answer' | 'other'; mayAdvance?: boolean };
type Dialogue = { id: string; tier: string; turns: Turn[]; expect: Record<string, string> };

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || 'http://localhost:8788').replace(/\/$/, '');
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const label = flag('label') || 'run';
const data = JSON.parse(
  readFileSync(new URL('../data/conversation-eval/profile-builder.json', import.meta.url), 'utf8'),
) as { dialogues: Dialogue[] };
const dialogues = data.dialogues.filter(
  (d) => (!flag('tier') || d.tier === flag('tier')) && (!flag('only') || d.id === flag('only')),
);

async function account() {
  let cookie = '';
  let csrf = '';
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(`${method} ${path}: ${r.status} ${json.code || ''} ${json.error || ''}`);
    return json;
  };
  await call('/auth/register', 'POST', {
    email: `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@careerflow.test`,
    password: `Eval-${crypto.randomUUID()}`,
    name: 'Conversation Eval',
  });
  csrf = (await call('/session')).csrf || '';
  return call;
}

const sameQuestion = (a: any, b: any) =>
  a &&
  b &&
  (a.questionKey && b.questionKey
    ? a.questionKey === b.questionKey
    : a.questions?.[0] === b.questions?.[0]);

async function runDialogue(d: Dialogue) {
  const call = await account();
  let thread = await call('/profile-threads', 'POST', { currentProfile: blankProfile });
  const turns: any[] = [];
  for (const turn of d.turns) {
    const before = [...thread.messages].reverse().find((m: any) => m.role === 'assistant');
    const started = Date.now();
    let error = '';
    try {
      thread = await call(`/profile-threads/${thread.id}/messages`, 'POST', {
        currentProfile: blankProfile,
        text: turn.text,
        revision: thread.revision,
        consent: true,
      });
    } catch (e) {
      error = (e as Error).message;
      thread = await call(`/profile-threads/${thread.id}`);
    }
    const ms = Date.now() - started;
    const after = [...thread.messages].reverse().find((m: any) => m.role === 'assistant');
    const parked = after?.turn?.parked?.length > 0;
    const moved =
      before?.questions?.length && after?.questions?.length && !sameQuestion(before, after);
    turns.push({
      text: turn.text,
      kind: turn.kind,
      ms,
      error: error || (after?.failed ? after.diagnostic?.category || 'failed' : ''),
      reply: String(after?.text || '').slice(0, 240),
      question: after?.questions?.[0] || null,
      questionKey: after?.questionKey ?? null,
      intent: after?.turn?.intent ?? null,
      route: after?.turn?.route ?? null,
      problems: after?.turn?.problems ?? [],
      revisions: after?.turn?.revisions ?? 0,
      light: after?.turn?.light ?? null,
      wrongAdvance: turn.kind === 'other' && !turn.mayAdvance && Boolean(moved) && !parked,
      parked,
    });
  }
  // Loops: the longest run of consecutive assistant turns asking the same question.
  const asked = thread.messages.filter((m: any) => m.role === 'assistant' && m.questions?.length);
  let run = 1;
  let longest = asked.length ? 1 : 0;
  for (let i = 1; i < asked.length; i++) {
    run = sameQuestion(asked[i - 1], asked[i]) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const draft = JSON.stringify(
    (thread.proposals || []).filter((p: any) => p.status === 'PENDING').map((p: any) => p.after),
  ).toLowerCase();
  const expected = Object.entries(d.expect);
  const found = expected.filter(([, v]) => draft.includes(v.toLowerCase())).map(([k]) => k);
  return {
    id: d.id,
    tier: d.tier,
    turns,
    longestRepeat: longest,
    extraction: {
      expected: expected.length,
      found: found.length,
      missing: expected.filter(([k]) => !found.includes(k)).map(([k]) => k),
    },
  };
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

/** Answer turns followed by the same question as the turn before them. */
function reAsked(turns: any[]) {
  return turns.map(
    (t, i) =>
      i > 0 &&
      t.kind === 'answer' &&
      !t.error &&
      Boolean(t.question) &&
      sameQuestion(
        { questionKey: turns[i - 1].questionKey, questions: [turns[i - 1].question] },
        { questionKey: t.questionKey, questions: [t.question] },
      ),
  );
}

function summarise(results: Awaited<ReturnType<typeof runDialogue>>[], tier?: string) {
  const rs = tier ? results.filter((r) => r.tier === tier) : results;
  const turns = rs.flatMap((r) => r.turns);
  const answers = turns.filter((t) => t.kind === 'answer');
  const asked = rs.map((r) => reAsked(r.turns));
  const reAskedCount = asked.flat().filter(Boolean).length;
  const stuck = asked.filter((a) => a.some((x, i) => x && a[i + 1])).length;
  const other = turns.filter((t) => t.kind === 'other');
  const labelled = turns.filter((t) => t.intent);
  const intentRight = labelled.filter(
    (t) => (['answer', 'correction', 'control'].includes(t.intent) ? 'answer' : 'other') === t.kind,
  );
  const extraction = rs.reduce(
    (a, r) => ({ e: a.e + r.extraction.expected, f: a.f + r.extraction.found }),
    { e: 0, f: 0 },
  );
  const lightTokens = turns.reduce(
    (n, t) => n + (t.light ? t.light.inputTokens + t.light.outputTokens : 0),
    0,
  );
  return {
    tier: tier || 'all',
    dialogues: rs.length,
    turns: turns.length,
    wrongAdvance: `${other.filter((t) => t.wrongAdvance).length}/${other.length} (${pct(other.filter((t) => t.wrongAdvance).length, other.length)})`,
    reAskedAfterAnswer: `${reAskedCount}/${answers.length} (${pct(reAskedCount, answers.length)})`,
    stuck,
    intentAccuracy: labelled.length ? pct(intentRight.length, labelled.length) : 'n/a',
    extractionRecall: `${extraction.f}/${extraction.e} (${pct(extraction.f, extraction.e)})`,
    failures: turns.filter((t) => t.error).length,
    p50ms: quantile(
      turns.map((t) => t.ms),
      0.5,
    ),
    p95ms: quantile(
      turns.map((t) => t.ms),
      0.95,
    ),
    extractionCalls: turns.filter((t) => (t.route ? t.route === 'extract' : true)).length,
    lightTokens,
  };
}

const rescore = flag('rescore');
if (rescore) {
  // Recompute the summary of a saved run with the current metrics and labels.
  const saved = JSON.parse(readFileSync(rescore, 'utf8'));
  const labels = new Map(
    data.dialogues.flatMap((d) => d.turns.map((t) => [`${d.id}|${t.text}`, t])),
  );
  for (const r of saved.results)
    for (const [i, t] of r.turns.entries()) {
      const l = labels.get(`${r.id}|${t.text}`);
      if (l?.mayAdvance) t.wrongAdvance = false;
      // Older runs lacked a question id on the opening message; compare with the previous turn.
      if (i > 0 && t.kind === 'other' && !l?.mayAdvance)
        t.wrongAdvance =
          !t.parked &&
          Boolean(t.question) &&
          !sameQuestion(
            { questionKey: r.turns[i - 1].questionKey, questions: [r.turns[i - 1].question] },
            { questionKey: t.questionKey, questions: [t.question] },
          );
    }
  const tiers = [...new Set(saved.results.map((r: any) => r.tier))] as string[];
  console.log(saved.label);
  console.table([summarise(saved.results), ...tiers.map((t) => summarise(saved.results, t))]);
  process.exit(0);
}

const results: Awaited<ReturnType<typeof runDialogue>>[] = [];
for (const d of dialogues) {
  process.stderr.write(`${d.id}… `);
  results.push(await runDialogue(d));
  process.stderr.write('done\n');
}
const tiers = [...new Set(results.map((r) => r.tier))];
const summary = [summarise(results), ...tiers.map((t) => summarise(results, t))];
mkdirSync(new URL('../output/conversation-eval/', import.meta.url), { recursive: true });
const file = new URL(
  `../output/conversation-eval/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  import.meta.url,
);
writeFileSync(
  file,
  JSON.stringify({ label, base, at: new Date().toISOString(), summary, results }, null, 1),
);
console.table(summary);
console.log(`Saved ${file.pathname}`);
