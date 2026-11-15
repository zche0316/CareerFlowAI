// Closure check for the Profile Builder interview (CFS-151): a simulated user answers whatever
// field the interview asks about, and the run measures whether the interview reaches every
// profile field and closes the loop before review.
//
//   npx tsx scripts/closure-eval.ts http://localhost:8788 [--label name]
//
// Scenarios
// - complete:    answers every question (skips optional STAR parts) until the interview ends.
// - early-stop:  says "that's all" as soon as the first experience is told, then follows along.
// - chinese:     the complete scenario in Chinese; questions should come back in Chinese.
// Live mode costs model calls: run it against a separate database.
import { mkdirSync, writeFileSync } from 'node:fs';
import { blankProfile } from '../packages/contracts/src/index.js';
import { coverageFields, missingFields } from '../packages/contracts/src/profile-interview.js';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || 'http://localhost:8788').replace(/\/$/, '');
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'closure';

type Lang = 'en' | 'zh';
const answers: Record<Lang, Record<string, string>> = {
  en: {
    'profile:goals': 'Graduate data analyst roles.',
    'profile:name': 'Sam Rivera',
    'profile:education': 'Bachelor of Science in Statistics, University of Sydney, 2023 to 2026.',
    inventory:
      'I was a data analyst intern at Harbourline Logistics (fictional) from December 2025 to February 2026.',
    overview:
      'I wrote SQL views and pandas scripts and maintained the weekly late-delivery report in Power BI.',
    'profile:skills': 'SQL, Python, pandas and Power BI.',
    'profile:location': 'Sydney.',
    'profile:workArrangement': 'Hybrid.',
    'profile:employmentType': 'Full-time graduate roles.',
    done: "That's all.",
    skip: 'skip',
  },
  zh: {
    'profile:goals': '我想找数据分析方向的毕业生岗位。',
    'profile:name': 'Sam Rivera',
    'profile:education': '2023 到 2026 年在悉尼大学读统计学学士。',
    inventory: '2025 年 12 月到 2026 年 2 月，我在 Harbourline Logistics（虚构）做数据分析实习生。',
    overview: '我写 SQL 视图和 pandas 脚本，维护 Power BI 里的每周延迟送达报表。',
    'profile:skills': 'SQL、Python、pandas 和 Power BI。',
    'profile:location': '悉尼。',
    'profile:workArrangement': '混合办公。',
    'profile:employmentType': '全职的毕业生岗位。',
    done: '就这些',
    skip: '跳过',
  },
};

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
    email: `closure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@careerflow.test`,
    password: `Eval-${crypto.randomUUID()}`,
    name: 'Closure Eval',
  });
  csrf = (await call('/session')).csrf || '';
  return call;
}

function reply(key: string | null, lang: Lang, told: boolean, earlyStop: boolean) {
  const a = answers[lang];
  if (!key) return a.done;
  if (key.startsWith('inventory:')) return told ? a.done : a.inventory;
  if (earlyStop && told) return a.done;
  if (a[key]) return a[key];
  if (key.endsWith(':overview')) return a.overview;
  return a.skip; // dates already given, organisation, optional STAR parts
}

async function run(scenario: 'complete' | 'early-stop' | 'chinese') {
  const lang: Lang = scenario === 'chinese' ? 'zh' : 'en';
  const call = await account();
  let thread = await call('/profile-threads', 'POST', { currentProfile: blankProfile });
  const asked: string[] = [];
  const questions: string[] = [];
  let told = false;
  let closingShown = false;
  let turns = 0;
  for (; turns < 30; turns++) {
    const last = [...thread.messages].reverse().find((m: any) => m.role === 'assistant');
    if (last?.interviewState?.phase === 'review') break;
    if (/still empty|还空着/.test(last?.text || '')) closingShown = true;
    const key = last?.questionKey ?? last?.interviewState?.question?.key ?? null;
    if (key) asked.push(key);
    if (last?.questions?.[0])
      questions.push(`${key} | ${last.turn?.phrased ?? '-'} | ${last.questions[0]}`);
    const text = reply(key, lang, told, scenario === 'early-stop');
    if (key?.startsWith('inventory:') && !told) told = true;
    thread = await call(`/profile-threads/${thread.id}/messages`, 'POST', {
      currentProfile: blankProfile,
      text,
      revision: thread.revision,
      consent: true,
    }).catch(async () => call(`/profile-threads/${thread.id}`));
  }
  const final = [...thread.messages].reverse().find((m: any) => m.interviewState)?.interviewState;
  const planned = Object.assign(
    structuredClone(blankProfile),
    ...(thread.proposals || [])
      .filter((p: any) => p.status === 'PENDING')
      .map((p: any) => ({ [p.field]: p.after })),
  );
  const empty = missingFields(planned, { skipped: final?.skipped || [] }).map((m) => m.key);
  const prefKeys = coverageFields.filter((f) => f.after).map((f) => f.key);
  return {
    scenario,
    turns,
    reachedReview: final?.phase === 'review',
    closingShown,
    emptyAtEnd: empty,
    preferencesAsked: prefKeys.filter((k) => asked.includes(k)).length,
    questionsInUserLanguage: questions.filter(
      (q) => (lang === 'zh') === /\p{Script=Han}/u.test(q.split(' | ').slice(2).join(' | ')),
    ).length,
    questions: questions.length,
    questionTexts: questions,
  };
}

const rows = [];
for (const s of ['complete', 'early-stop', 'chinese'] as const) {
  process.stdout.write(`${s}… `);
  rows.push(await run(s));
  console.log('done');
}
console.table(
  rows.map((r) => ({
    ...r,
    emptyAtEnd: r.emptyAtEnd.join(' ') || '-',
    preferencesAsked: `${r.preferencesAsked}/4`,
    questionsInUserLanguage: `${r.questionsInUserLanguage}/${r.questions}`,
    questionTexts: undefined,
  })),
);
mkdirSync(new URL('../output/conversation-eval/', import.meta.url), { recursive: true });
const file = new URL(
  `../output/conversation-eval/${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  import.meta.url,
);
writeFileSync(file, JSON.stringify({ label, base, rows }, null, 1));
console.log(`Saved ${file.pathname}`);
