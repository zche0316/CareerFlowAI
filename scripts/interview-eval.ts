// Runs the labelled Interview panel messages (data/conversation-eval/interview-panel.json)
// through the panel's turn graph with the live light model, with scoring stubbed out (CFS-145).
//
//   npx tsx --env-file=.env scripts/interview-eval.ts [--label name] [--mode fixture]
//
// It measures routing, not scoring: on main every message goes to the Evaluator, so the baseline
// is exact without a run. Light-model calls only; no Evaluator calls are made.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { runInterviewTurn } from '../apps/api/src/interview-turn.js';
import { summariseTurn } from '../packages/agents/src/conversation/turn-graph.js';

type Message = { tier: string; q: string; text: string; expect: 'score' | 'reply' | 'skip' };
const data = JSON.parse(
  readFileSync(new URL('../data/conversation-eval/interview-panel.json', import.meta.url), 'utf8'),
) as {
  questions: Record<string, { question: string; focus: string }>;
  messages: Message[];
};
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = (flag('mode') || 'openai') as 'openai' | 'fixture';
const label = flag('label') || `interview-${mode}`;

const MODEL_ANSWER = /you could say|a (?:good|strong) answer would|sample answer|参考答案/i;
const SCORE_TALK = /\b(?:you scored|your score|great answer|good answer|well done)\b|得分|评分/i;

const rows: any[] = [];
for (const m of data.messages) {
  const q = data.questions[m.q];
  let scored = 0;
  const started = Date.now();
  const turn = await runInterviewTurn({
    text: m.text,
    mode,
    question: { id: m.q, ...q },
    followUp: null,
    history: [],
    score: async () => {
      scored++;
      return { reply: '', question: null, questionKey: m.q, changed: true };
    },
  });
  const got = turn.plan.route === 'extract' ? 'score' : turn.plan.parked.length ? 'skip' : 'reply';
  const zh = /\p{Script=Han}/u.test(m.text);
  rows.push({
    tier: m.tier,
    text: m.text,
    expect: m.expect,
    got,
    intent: turn.perception.intent,
    source: turn.perception.source,
    ms: Date.now() - started,
    reply: turn.draft.reply,
    problems: turn.reflection.problems,
    replyLanguageOk: got === 'score' || !zh || /\p{Script=Han}/u.test(turn.draft.reply),
    leaksAnswer: got !== 'score' && MODEL_ANSWER.test(turn.draft.reply),
    talksScore: got !== 'score' && SCORE_TALK.test(turn.draft.reply),
    asksQuestion: got !== 'score' && /[?？]/.test(turn.draft.reply),
    summary: summariseTurn(turn),
    scored,
  });
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0;
const table = ['all', ...new Set(rows.map((r) => r.tier))].map((tier) => {
  const rs = tier === 'all' ? rows : rows.filter((r) => r.tier === tier);
  const non = rs.filter((r) => r.expect !== 'score');
  const ans = rs.filter((r) => r.expect === 'score');
  return {
    tier,
    messages: rs.length,
    routeAccuracy: pct(rs.filter((r) => r.got === r.expect).length, rs.length),
    nonAnswersScored: `${non.filter((r) => r.got === 'score').length}/${non.length}`,
    nonAnswersScoredOnMain: `${non.length}/${non.length}`,
    answersMissed: `${ans.filter((r) => r.got !== 'score').length}/${ans.length}`,
    replyIssues: rs.filter(
      (r) => !r.replyLanguageOk || r.leaksAnswer || r.talksScore || r.asksQuestion,
    ).length,
    p50ms: p50(rs.map((r) => r.ms)),
  };
});
mkdirSync(new URL('../output/conversation-eval/', import.meta.url), { recursive: true });
const file = new URL(
  `../output/conversation-eval/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  import.meta.url,
);
writeFileSync(file, JSON.stringify({ label, mode, table, rows }, null, 1));
console.table(table);
for (const r of rows.filter((r) => r.got !== r.expect))
  console.log(`MISROUTED ${r.expect}→${r.got} (${r.intent}): ${r.text}`);
console.log(`Saved ${file.pathname}`);
