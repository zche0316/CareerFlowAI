// Reads recent conversation turns from LangSmith to debug what a model actually returned (CFS-149).
// Needs LANGSMITH_API_KEY with read access and LANGSMITH_PROJECT in .env.
//
//   npx tsx scripts/trace-turns.ts                     recent turns, newest first
//   npx tsx scripts/trace-turns.ts --find "words"      the first turn whose input has these words:
//                                                      graph nodes and each model call's output
//   npx tsx scripts/trace-turns.ts --health            model outputs the server cannot parse
//   add --minutes 120 to look further back (default 60)
//
// Prints trace content, which includes user messages: use it on development and test accounts.
import 'dotenv/config';
import { Client } from 'langsmith';
import { parseProviderJson } from '../packages/agents/src/provider.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const project = process.env.LANGSMITH_PROJECT;
if (!project || !process.env.LANGSMITH_API_KEY)
  throw Error('Set LANGSMITH_API_KEY and LANGSMITH_PROJECT.');
const client = new Client();
const startTime = new Date(Date.now() - Number(flag('minutes') || 60) * 60_000);
const byTime = (a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time);
const turnText = (r: any) => String(r.inputs?.text ?? r.inputs?.args?.[0]?.text ?? '');

if (args.includes('--health')) {
  let calls = 0;
  const bad: string[] = [];
  for await (const r of client.listRuns({ projectName: project, startTime, runType: 'llm' })) {
    const content: string = r.outputs?.choices?.[0]?.message?.content || '';
    if (!content) continue; // a tool call, not an answer
    calls++;
    try {
      parseProviderJson(content);
    } catch {
      bad.push(`${r.name}: ${content.slice(0, 160)}`);
    }
  }
  console.log(`${calls} model answers, ${bad.length} unparsable`);
  bad.slice(0, 5).forEach((b) => console.log(' -', b));
} else {
  const roots: any[] = [];
  for await (const r of client.listRuns({ projectName: project, isRoot: true, startTime }))
    roots.push(r);
  const needle = flag('find');
  if (!needle) {
    for (const r of roots.sort(byTime).reverse().slice(0, 30))
      console.log(r.start_time, r.name, r.status, turnText(r).slice(0, 80));
  } else {
    const hit = roots.sort(byTime).find((r) => JSON.stringify(r.inputs).includes(needle));
    if (!hit)
      throw Error(`No turn in the last ${flag('minutes') || 60} minutes contains that text.`);
    console.log('TURN', hit.name, hit.status, hit.start_time, turnText(hit).slice(0, 200));
    const runs: any[] = [];
    for await (const r of client.listRuns({ projectName: project, traceId: hit.trace_id }))
      runs.push(r);
    for (const r of runs.sort(byTime)) {
      if (r.name === '__start__' || r.name === 'RunnableLambda') continue;
      console.log(
        `- ${r.run_type} ${r.name} ${r.status}${r.error ? ' ERROR ' + r.error.slice(0, 200) : ''}`,
      );
      if (r.run_type === 'llm')
        console.log(
          '    ',
          String(r.outputs?.choices?.[0]?.message?.content ?? JSON.stringify(r.outputs)).slice(
            0,
            2000,
          ),
        );
    }
  }
}
