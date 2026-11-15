// Runs the labelled Ask Coach messages (data/conversation-eval/coach-chat.json) through the
// Coach's turn graph with live models and the real O*NET/ESCO retrieval (CFS-146).
//
//   npx tsx --env-file=.env scripts/coach-eval.ts [--label name] [--mode fixture]
//
// Measures routing, citation validity, grounding in the user's facts, outcome promises, reply
// language, what reflect caught, and latency. Costs one light call per message plus one
// grounded-answer call per career question.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runCoachTurn } from '../apps/api/src/coach-turn.js';
import { coachSources } from '../apps/api/src/coach-sources.js';

type Message = { tier: string; text: string; expect: 'answer' | 'reply'; personal?: boolean };
const data = JSON.parse(
  readFileSync(new URL('../data/conversation-eval/coach-chat.json', import.meta.url), 'utf8'),
) as { goal: string; facts: { id: string; kind: string; text: string }[]; messages: Message[] };
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = (flag('mode') || 'openai') as 'openai' | 'fixture';
const label = flag('label') || `coach-${mode}`;
const PROMISE = /\b(?:guarantee|definitely get|100% (?:chance|sure))\b|保证|一定能/i;

const rows: any[] = [];
for (const m of data.messages) {
  const retrieved: string[] = [];
  const started = Date.now();
  const turn = await runCoachTurn({
    text: m.text,
    mode,
    goal: data.goal,
    facts: data.facts,
    history: [],
    sources: async (q) => {
      const s = (await coachSources(q)).sources;
      retrieved.push(...s.map((x) => x.id));
      return s;
    },
  });
  const known = new Set([...data.facts.map((f) => f.id), ...retrieved]);
  const got = turn.plan.route === 'extract' ? 'answer' : 'reply';
  const zh = /\p{Script=Han}/u.test(m.text);
  rows.push({
    tier: m.tier,
    text: m.text,
    expect: m.expect,
    got,
    intent: turn.perception.intent,
    ms: Date.now() - started,
    reply: turn.draft.reply,
    citations: turn.draft.citations,
    general: turn.draft.general,
    caught: turn.reflection.problems.length
      ? turn.trace.find((t) => t.node === 'reflect')?.detail
      : '',
    revisions: turn.revisions,
    invalidCitations: turn.draft.citations.filter((id) => !known.has(id)).length,
    citesUser: turn.draft.citations.some((id) => data.facts.some((f) => f.id === id)),
    citesSource: turn.draft.citations.some((id) => /^(onet|esco):/.test(id)),
    promises: PROMISE.test(turn.draft.reply),
    languageOk: !zh || /\p{Script=Han}/u.test(turn.draft.reply),
    personal: Boolean(m.personal),
  });
}

const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : 'n/a');
const answers = rows.filter((r) => r.got === 'answer');
const personal = answers.filter((r) => r.personal);
const summary = {
  messages: rows.length,
  routedCorrectly: pct(rows.filter((r) => r.got === r.expect).length, rows.length),
  answers: answers.length,
  invalidCitationsShown: rows.reduce((n, r) => n + r.invalidCitations, 0),
  personalAnswersCitingUser: pct(personal.filter((r) => r.citesUser).length, personal.length),
  answersCitingPublicSource: pct(answers.filter((r) => r.citesSource).length, answers.length),
  labelledGeneral: answers.filter((r) => r.general).length,
  promisesShown: rows.filter((r) => r.promises).length,
  wrongLanguage: rows.filter((r) => !r.languageOk).length,
  caughtByReflect: rows.filter((r) => r.caught).length,
  p50msAnswer:
    [...answers.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(answers.length / 2)] || 0,
};
mkdirSync(new URL('../output/conversation-eval/', import.meta.url), { recursive: true });
const file = new URL(
  `../output/conversation-eval/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  import.meta.url,
);
writeFileSync(file, JSON.stringify({ label, mode, summary, rows }, null, 1));
console.table([summary]);
for (const r of rows.filter((r) => r.got !== r.expect))
  console.log(`MISROUTED ${r.expect}→${r.got} (${r.intent}): ${r.text}`);
for (const r of rows.filter((r) => r.caught)) console.log(`REFLECT caught ${r.caught}: ${r.text}`);
console.log(`Saved ${file.pathname}`);
