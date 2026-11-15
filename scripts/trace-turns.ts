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
// Uses the SmithDB run query (client.runs.query, POST /api/v2/runs/query); listRuns and
// POST /api/v1/runs/query stop working on 31 Jan 2027 (CFS-150).
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
// runs.query takes project UUIDs, not names. This lookup only reads.
const projectIds = [(await client.readProject({ projectName: project })).id];
// Always explicit: without min_start_time runs.query silently covers only the last 24 hours.
const minStartTime = new Date(Date.now() - Number(flag('minutes') || 60) * 60_000).toISOString();
// runs.query returns only ID unless fields are selected.
const query = (params: Omit<Parameters<typeof client.runs.query>[0], 'project_ids'>) =>
  client.runs.query({ project_ids: projectIds, min_start_time: minStartTime, ...params });
const byTime = (a: any, b: any) => +new Date(a.start_time) - +new Date(b.start_time);
const turnText = (r: any) => String(r.inputs?.text ?? r.inputs?.args?.[0]?.text ?? '');

if (args.includes('--health')) {
  let calls = 0;
  const bad: string[] = [];
  for await (const r of query({ run_type: 'LLM', selects: ['NAME', 'OUTPUTS'] })) {
    const content: string = (r.outputs as any)?.choices?.[0]?.message?.content || '';
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
  for await (const r of query({
    is_root: true,
    selects: ['NAME', 'STATUS', 'START_TIME', 'INPUTS', 'TRACE_ID'],
  }))
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
    for await (const r of query({
      trace_id: hit.trace_id,
      selects: ['NAME', 'RUN_TYPE', 'STATUS', 'ERROR', 'OUTPUTS', 'START_TIME'],
    }))
      runs.push(r);
    for (const r of runs.sort(byTime)) {
      if (r.name === '__start__' || r.name === 'RunnableLambda') continue;
      console.log(
        `- ${r.run_type} ${r.name} ${r.status}${r.error ? ' ERROR ' + r.error.slice(0, 200) : ''}`,
      );
      // The guide documents uppercase run types; the API returned lowercase on 2026-11-15.
      if (String(r.run_type).toUpperCase() === 'LLM')
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
