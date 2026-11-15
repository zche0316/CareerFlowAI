// Plan-driven interview demo (CFS-164). The Panel keeps a plan of the stages a typical Australian
// tech interview loop covers, asks one question per stage, follows up on the weakest STAR part
// until it is covered or the stage's follow-up budget is spent, then moves to the next stage. The
// interview ends when every stage is covered or skipped: the same long-range plan / next step /
// closed loop shape as the Profile Builder (CFS-151).
//
//   npx tsx --env-file=.env scripts/interview-plan-demo.ts --role "Graduate Data Analyst"
//   npx tsx --env-file=.env scripts/interview-plan-demo.ts --role "..." --script answers.txt
//
// Interactive by default: type an answer, "skip" moves on, "quit" ends. --script reads one answer
// per line instead. Live models only (light route: Groq, then OpenAI); about 2 calls per turn.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { lightJson, type LightCall } from '../packages/agents/src/conversation/light-model.js';

const args = process.argv.slice(2);
const flag = (n: string) =>
  args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined;
const role = flag('role') || 'Graduate Data Analyst';
const scripted = flag('script')
  ? readFileSync(flag('script')!, 'utf8').split('\n').filter(Boolean)
  : null;
const calls: LightCall[] = [];

// The loop most Australian graduate and junior tech roles use (recruiter screen, behavioural,
// technical, scenario, the candidate's questions). Each stage names what it must establish.
const STAGES = [
  {
    id: 'motivation',
    goal: 'why this role and company, and what the candidate wants next',
    followUps: 1,
  },
  {
    id: 'behavioural',
    goal: 'one real STAR example of teamwork or handling a problem',
    followUps: 2,
  },
  {
    id: 'technical',
    goal: 'hands-on depth in the core tool for this role, explained step by step',
    followUps: 2,
  },
  {
    id: 'scenario',
    goal: 'how the candidate would approach a realistic task in this role',
    followUps: 1,
  },
  { id: 'closing', goal: 'a thoughtful question the candidate has for the panel', followUps: 0 },
];

const ask = z.object({ question: z.string().min(5).max(400) });
const judge = z.object({
  covered: z.boolean(),
  star: z.object({
    situation: z.boolean(),
    task: z.boolean(),
    action: z.boolean(),
    result: z.boolean(),
  }),
  followUp: z.string().max(300),
  note: z.string().max(300),
});

async function nextQuestion(stage: (typeof STAGES)[number], history: string[]) {
  const out = await lightJson(
    `You are the Panel, a fair but probing interview panel for a ${role} role in Australia. Write the next interview question for the stage below: one short, natural, specific question. Do not repeat earlier questions. Return {"question": "..."}.`,
    { stage: stage.id, mustEstablish: stage.goal, conversation: history.slice(-8) },
    ask,
    calls,
  );
  return out?.question || `Tell me about ${stage.goal}.`;
}

async function evaluate(
  stage: (typeof STAGES)[number],
  question: string,
  answer: string,
  followUpsLeft: number,
) {
  return lightJson(
    `You are the Panel's evaluator for a ${role} interview. Decide whether the candidate's answers in this stage, taken together, establish what the stage needs, mark which STAR parts are present, and if it does not and follow-ups remain, write ONE short follow-up question that targets the weakest missing part (never a model answer, never a score). Empty followUp when covered or none remain. note: one short sentence of feedback. Return {"covered","star":{"situation","task","action","result"},"followUp","note"}.`,
    {
      stage: stage.id,
      mustEstablish: stage.goal,
      question,
      answersInThisStage: answer,
      followUpsLeft,
    },
    judge,
    calls,
  );
}

const rl = scripted ? null : createInterface({ input: process.stdin, output: process.stdout });
let line = 0;
const reply = async (q: string) => {
  console.log(`\nPanel: ${q}`);
  if (scripted) {
    const a = scripted[line++] ?? 'quit';
    console.log(`You:   ${a}`);
    return a;
  }
  return (await rl!.question('You:   ')).trim();
};

const history: string[] = [];
const report: { stage: string; covered: boolean; followUps: number; note: string }[] = [];
outer: for (const stage of STAGES) {
  let question = await nextQuestion(stage, history);
  let used = 0;
  const said: string[] = [];
  for (;;) {
    const answer = await reply(question);
    history.push(`Panel: ${question}`, `Candidate: ${answer}`);
    if (/^quit$/i.test(answer)) break outer;
    if (/^skip$/i.test(answer)) {
      report.push({ stage: stage.id, covered: false, followUps: used, note: 'Skipped.' });
      break;
    }
    said.push(answer);
    // Follow-up answers add to the stage; the evaluator reads them together.
    const verdict = await evaluate(stage, question, said.join('\n'), stage.followUps - used);
    if (!verdict) {
      report.push({ stage: stage.id, covered: false, followUps: used, note: 'No model answered.' });
      break;
    }
    if (verdict.covered || !verdict.followUp || used >= stage.followUps) {
      report.push({
        stage: stage.id,
        covered: verdict.covered,
        followUps: used,
        note: verdict.note,
      });
      break;
    }
    used++;
    question = verdict.followUp;
  }
}
rl?.close();
console.log('\nPlan coverage');
console.table(report);
const tokens = calls.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0);
console.log(
  `${calls.length} light calls, ${tokens} tokens, routes: ${[...new Set(calls.map((c) => c.route))].join(', ')}`,
);
