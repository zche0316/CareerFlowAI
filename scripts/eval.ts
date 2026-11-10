// Evaluation harness: labelled fictional data, measured metrics, a written report.
// Deterministic suites (default) make no network or model call. Live suites run only with --live.
//   npx tsx scripts/eval.ts [--live] [--out <dir>] [--limit N]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildJobRecord, quoteInSource } from '../packages/contracts/src/job-record.js';
import { profileSchema, type CareerProfile } from '../packages/contracts/src/index.js';
import { matchingProfileView } from '../packages/contracts/src/career-evidence.js';
import { compare } from '../packages/matching/domain.js';
import { JobRepository } from '../packages/recruitment/src/repository.js';
import { discoverWeb } from '../packages/recruitment/src/web-discovery.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (name: string) => {
  const data = JSON.parse(readFileSync(join(root, 'evals', 'data', name), 'utf8'));
  return data.items ?? data;
};

export const datasets = {
  records: () => load('job-records.json') as RecordItem[],
  pages: () => load('web-pages.json') as PageItem[],
  matching: () => (load('matching.json') as { profiles: MatchingProfile[] }).profiles,
  // Written after the rule fixes of 2026-11-11 and never used to tune them.
  recordsHoldout: () => load('job-records-holdout.json') as RecordItem[],
  pagesHoldout: () => load('web-pages-holdout.json') as PageItem[],
};

type Salary = { min: number | null; max: number | null; currency: string; period: string } | null;
type RecordItem = {
  id: string;
  job: Record<string, any>;
  gold: {
    workRights: string | null;
    arrangement: string | null;
    seniority: string | null;
    salary: Salary;
  };
  notes?: string;
};
type PageItem = {
  id: string;
  url: string;
  text: string;
  trap?: boolean;
  gold: { kind: string; title?: string; company?: string };
  notes?: string;
};
type MatchingJob = {
  grade: number;
  job: Record<string, any>;
  goldSupported?: string[];
  goldUnsupported?: string[];
};
type MatchingProfile = { id: string; profile: unknown; jobs: MatchingJob[] };

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const ratio = (a: number, b: number) => (b ? round(a / b) : null);

// ---------------------------------------------------------------- records
const FIELDS = ['workRights', 'arrangement', 'seniority', 'salary'] as const;
type Field = (typeof FIELDS)[number];

const near = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= 1;
const salaryEqual = (gold: Salary, got: Salary) =>
  gold === null || got === null
    ? gold === got
    : near(gold.min, got.min) &&
      near(gold.max, got.max) &&
      gold.currency === got.currency &&
      gold.period === got.period;

export function runRecordsSuite(items = datasets.records()) {
  const misses: {
    id: string;
    field: Field;
    expected: unknown;
    got: unknown;
    quote: string | null;
  }[] = [];
  const fields: Record<string, any> = {};
  let quotesChecked = 0,
    quotesValid = 0,
    singleFigureOnly = 0;
  const tallies = Object.fromEntries(
    FIELDS.map((f) => [f, { correct: 0, goldStated: 0, predStated: 0, bothStated: 0 }]),
  ) as Record<
    Field,
    { correct: number; goldStated: number; predStated: number; bothStated: number }
  >;
  for (const item of items) {
    const record = buildJobRecord(item.job);
    const source = `${item.job.title || ''}\n${item.job.location || ''}\n${item.job.description || ''}`;
    for (const f of FIELDS) {
      const t = tallies[f];
      const expected = item.gold[f];
      let got: unknown, quote: string | null;
      if (f === 'salary') {
        const s = record.salary;
        got = s ? { min: s.min, max: s.max, currency: s.currency, period: s.period } : null;
        quote = s?.quote ?? null;
        // Provider-field salaries carry no quote; only text extractions are quote-checked.
        if (s && s.basis === 'listing text') {
          quotesChecked++;
          if (quote && quoteInSource(source, quote)) quotesValid++;
        }
      } else {
        const q = record[f];
        got = q ? q.value : null;
        quote = q ? q.quote : null;
        if (q) {
          quotesChecked++;
          if (quoteInSource(source, q.quote)) quotesValid++;
        }
      }
      const ok = f === 'salary' ? salaryEqual(expected as Salary, got as Salary) : expected === got;
      // Secondary view only: the dataset records a single figure as min = max; the extractor
      // leaves max empty. Counted separately so the convention difference is visible, not hidden.
      if (f === 'salary' && !ok) {
        const g = expected as Salary,
          s = got as Salary;
        if (g && s && g.min === g.max && s.max === null && salaryEqual(g, { ...s, max: s.min }))
          singleFigureOnly++;
      }
      if (ok) t.correct++;
      else misses.push({ id: item.id, field: f, expected, got, quote });
      if (expected !== null) t.goldStated++;
      if (got !== null) t.predStated++;
      if (expected !== null && got !== null) t.bothStated++;
    }
  }
  for (const f of FIELDS) {
    const t = tallies[f];
    fields[f] = {
      accuracy: ratio(t.correct, items.length),
      correct: t.correct,
      total: items.length,
      statedPrecision: ratio(t.bothStated, t.predStated),
      statedRecall: ratio(t.bothStated, t.goldStated),
      goldStated: t.goldStated,
      predictedStated: t.predStated,
    };
  }
  const correctCells = FIELDS.reduce((s, f) => s + tallies[f].correct, 0);
  return {
    suite: 'records',
    size: items.length,
    fields,
    overallAccuracy: ratio(correctCells, items.length * FIELDS.length),
    salarySingleFigureMisses: singleFigureOnly,
    salaryAccuracyIfSingleFigureMaxEmptyAccepted: ratio(
      tallies.salary.correct + singleFigureOnly,
      items.length,
    ),
    quoteValidity: quotesChecked ? round(quotesValid / quotesChecked) : 1,
    quotesChecked,
    misses,
  };
}

// ---------------------------------------------------------------- screening
const screeningCriteria = {
  provider: 'web',
  country: 'au',
  region: '',
  location: '',
  keyword: 'analyst',
};
const fakeResponse = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;

// Runs one page through discoverWeb as the only search result. Tavily credentials are set to
// dummy values in-process for the call only so requireTavily passes; nothing leaves the process.
async function screenPage(
  page: { url: string; text: string },
  extractPage: (p: { url: string; text: string }) => Promise<any>,
) {
  const saved = { key: process.env.TAVILY_API_KEY, mode: process.env.TAVILY_ACCESS_MODE };
  process.env.TAVILY_API_KEY = 'eval-dummy-key';
  process.env.TAVILY_ACCESS_MODE = 'api_key';
  try {
    const repo = new JobRepository({
      fetcher: (async () =>
        fakeResponse({
          results: [{ url: page.url, content: '', raw_content: page.text }],
          usage: { credits: 0 },
        })) as typeof fetch,
    });
    return (await discoverWeb(repo, screeningCriteria, { extractPage })) as any;
  } finally {
    if (saved.key === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = saved.key;
    if (saved.mode === undefined) delete process.env.TAVILY_ACCESS_MODE;
    else process.env.TAVILY_ACCESS_MODE = saved.mode;
  }
}

export async function runScreeningSuite(items = datasets.pages().filter((p) => !p.trap)) {
  const rows: { id: string; kind: string; reachedModel: boolean; reason: string | null }[] = [];
  for (const page of items) {
    let reached = false;
    const result = await screenPage(page, async () => {
      reached = true;
      return { isJobPosting: false };
    });
    const reason = reached ? null : (result.discovery.rejected[0]?.reason ?? 'not read');
    rows.push({ id: page.id, kind: page.gold.kind, reachedModel: reached, reason });
  }
  const postings = rows.filter((r) => r.kind === 'posting');
  const others = rows.filter((r) => r.kind !== 'posting');
  const misclassified = rows
    .filter((r) => (r.kind === 'posting') !== r.reachedModel)
    .map((r) => ({
      id: r.id,
      goldKind: r.kind,
      outcome: r.reachedModel ? 'reached model' : 'stopped before model',
      reason: r.reason,
      url: items.find((p) => p.id === r.id)!.url,
    }));
  const byKind: Record<string, { total: number; reachedModel: number }> = {};
  for (const r of rows) {
    byKind[r.kind] ??= { total: 0, reachedModel: 0 };
    byKind[r.kind].total++;
    if (r.reachedModel) byKind[r.kind].reachedModel++;
  }
  return {
    suite: 'screening',
    size: rows.length,
    postingRecall: ratio(postings.filter((r) => r.reachedModel).length, postings.length),
    postings: postings.length,
    nonPostingsStopped: ratio(others.filter((r) => !r.reachedModel).length, others.length),
    nonPostings: others.length,
    modelCallsSaved: others.filter((r) => !r.reachedModel).length,
    byKind,
    rows,
    misclassified,
  };
}

// ---------------------------------------------------------------- ranking
export function ndcgAt(k: number, ranked: number[], grades: number[]) {
  const dcg = (gs: number[]) =>
    gs.slice(0, k).reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
  const ideal = dcg([...grades].sort((a, b) => b - a));
  return ideal ? dcg(ranked) / ideal : 0;
}

// Over job pairs with different gold grades: 1 if the scores order them the same way,
// 0.5 for a tied score, 0 if reversed.
export function pairwiseAccuracy(scores: number[], grades: number[]) {
  let total = 0,
    credit = 0;
  for (let i = 0; i < scores.length; i++)
    for (let j = i + 1; j < scores.length; j++) {
      if (grades[i] === grades[j]) continue;
      total++;
      const s = Math.sign(scores[i] - scores[j]),
        g = Math.sign(grades[i] - grades[j]);
      credit += s === 0 ? 0.5 : s === g ? 1 : 0;
    }
  return total ? credit / total : 0;
}

// Stable sort by score descending; ties keep dataset order (stated in the report).
export function rankingMetrics(scored: { id: string; score: number; grade: number }[]) {
  const order = scored.map((s, i) => ({ ...s, i })).sort((a, b) => b.score - a.score || a.i - b.i);
  return {
    ndcg5: round(
      ndcgAt(
        5,
        order.map((o) => o.grade),
        scored.map((s) => s.grade),
      ),
    ),
    pairwise: round(
      pairwiseAccuracy(
        scored.map((s) => s.score),
        scored.map((s) => s.grade),
      ),
    ),
    order: order.map((o) => ({ id: o.id, score: o.score, grade: o.grade })),
  };
}

export function parseProfiles(profiles = datasets.matching()) {
  return profiles.map((p) => ({ ...p, parsed: profileSchema.parse(p.profile) as CareerProfile }));
}

export function runRankingBaselineSuite(profiles = datasets.matching()) {
  const perProfile = parseProfiles(profiles).map((p) => {
    const corpus = p.jobs.map((j) => j.job.title + ' ' + j.job.description);
    const view = matchingProfileView(p.parsed);
    const scored = p.jobs.map((j) => ({
      id: j.job.id,
      score: compare(view, j.job, corpus).score as number,
      grade: j.grade,
    }));
    return { profile: p.id, ...rankingMetrics(scored) };
  });
  const mean = (k: 'ndcg5' | 'pairwise') =>
    round(perProfile.reduce((s, p) => s + p[k], 0) / perProfile.length);
  return {
    suite: 'ranking-baseline',
    size: profiles.reduce((s, p) => s + p.jobs.length, 0),
    scorer: 'packages/matching/domain.js compare (rule-based fixture scorer)',
    meanNdcg5: mean('ndcg5'),
    meanPairwise: mean('pairwise'),
    perProfile,
  };
}

// ---------------------------------------------------------------- live suites
// Phrase-to-requirement rule: lower-case word tokens (letters, digits, + and #), stop words
// removed. A gold phrase matches the requirement (term + excerpt) that covers the largest share of
// its tokens, if that share is at least PHRASE_MATCH_THRESHOLD.
export const PHRASE_MATCH_THRESHOLD = 0.6;
const STOP = new Set(
  'a an and or of the to in with for on as such similar experience experienced years year field related knowledge'.split(
    ' ',
  ),
);
export const tokens = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9+#]+/g) || []).filter((t) => !STOP.has(t));
export function matchPhrase(
  phrase: string,
  requirements: { term: string; excerpt: string }[],
): { index: number; share: number } | null {
  const want = [...new Set(tokens(phrase))];
  let index = -1,
    share = 0;
  for (const [i, r] of requirements.entries()) {
    const have = new Set(tokens(r.term + ' ' + r.excerpt));
    const s = want.length ? want.filter((t) => have.has(t)).length / want.length : 0;
    if (s > share) [index, share] = [i, s];
  }
  return index >= 0 && share >= PHRASE_MATCH_THRESHOLD ? { index, share } : null;
}

type Counter = { calls: number; inputTokens: number; outputTokens: number };
const counterHooks = (c: Counter) => ({
  onCall: async () => {
    c.calls++;
  },
  onTool: async () => {},
  onUsage: async (input: number, output: number) => {
    c.inputTokens += input;
    c.outputTokens += output;
  },
});

export async function runMappingLiveSuite(limit: number) {
  const { mapJobRequirements, scoreJobMapping } =
    await import('../packages/agents/src/job-mapping.js');
  // buildFacts lives in the API domain module, which constructs (but does not connect) a database
  // client on import, so it is loaded only on the live path.
  const { buildFacts } = await import('../apps/api/src/domain.js');
  const profiles = parseProfiles();
  const labelled = profiles
    .flatMap((p) => p.jobs.filter((j) => j.goldSupported).map((j) => ({ p, j })))
    .slice(0, limit);
  const rankProfile = profiles[0];
  const rankJobs = rankProfile.jobs.slice(0, limit);
  const key = (pid: string, jid: string) => `${pid}:${jid}`;
  const planned = new Set([
    ...labelled.map(({ p, j }) => key(p.id, j.job.id)),
    ...rankJobs.map((j) => key(rankProfile.id, j.job.id)),
  ]);
  console.log(
    `mapping-live: ${planned.size} mapping requests planned (${labelled.length} labelled pairs, ${rankJobs.length} ranking jobs, shared pairs reused); provider retries may add calls.`,
  );
  const counter: Counter = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const cache = new Map<string, { scored?: any; error?: string; ms: number }>();
  const run = async (p: (typeof profiles)[number], j: MatchingJob) => {
    const k = key(p.id, j.job.id);
    if (cache.has(k)) return cache.get(k)!;
    const facts = buildFacts(p.parsed);
    const started = Date.now();
    let out: { scored?: any; error?: string; ms: number };
    try {
      const mapping = await mapJobRequirements(j.job, facts, 'openai', counterHooks(counter));
      out = { scored: scoreJobMapping(j.job, mapping, facts, p.parsed), ms: Date.now() - started };
    } catch (error) {
      out = { error: String((error as Error).message).slice(0, 300), ms: Date.now() - started };
    }
    cache.set(k, out);
    return out;
  };
  const pairs = [];
  let supTotal = 0,
    supCovered = 0,
    unsTotal = 0,
    unsLinked = 0;
  const unmatched: { pair: string; phrase: string; kind: string }[] = [];
  for (const { p, j } of labelled) {
    const out = await run(p, j);
    const row: any = { pair: key(p.id, j.job.id), ms: out.ms, error: out.error ?? null };
    if (out.scored) {
      const items = out.scored.mapping.items as any[];
      const judge = (phrase: string, kind: string) => {
        const m = matchPhrase(phrase, items);
        if (!m) unmatched.push({ pair: row.pair, phrase, kind });
        const item = m ? items[m.index] : null;
        return {
          phrase,
          matchedTerm: item?.term ?? null,
          share: m ? round(m.share, 2) : null,
          linked: Boolean(item && item.evidence.length),
          status: item?.status ?? null,
        };
      };
      row.supported = (j.goldSupported || []).map((s) => judge(s, 'supported'));
      row.unsupported = (j.goldUnsupported || []).map((s) => judge(s, 'unsupported'));
      supTotal += row.supported.length;
      supCovered += row.supported.filter((x: any) => x.linked).length;
      unsTotal += row.unsupported.length;
      unsLinked += row.unsupported.filter((x: any) => x.linked).length;
      row.score = out.scored.score;
      row.requirements = items.map((i) => ({
        term: i.term,
        status: i.status,
        facts: i.evidence.length,
      }));
    }
    pairs.push(row);
  }
  const ok = pairs.filter((r) => !r.error);
  const ranking: any = { profile: rankProfile.id, failures: [] as string[] };
  const scored: { id: string; score: number; grade: number }[] = [];
  for (const j of rankJobs) {
    const out = await run(rankProfile, j);
    if (out.scored) scored.push({ id: j.job.id, score: out.scored.score, grade: j.grade });
    else ranking.failures.push(`${j.job.id}: ${out.error}`);
  }
  Object.assign(
    ranking,
    scored.length >= 2 ? rankingMetrics(scored) : { ndcg5: null, pairwise: null },
  );
  const baseline = runRankingBaselineSuite().perProfile.find((p) => p.profile === rankProfile.id);
  ranking.baseline = baseline ? { ndcg5: baseline.ndcg5, pairwise: baseline.pairwise } : null;
  ranking.note =
    scored.length < rankJobs.length
      ? 'Some jobs failed mapping; live metrics cover only the scored jobs and are not directly comparable to the baseline.'
      : undefined;
  return {
    suite: 'mapping-live',
    plannedRequests: planned.size,
    modelCalls: counter.calls,
    tokens: { input: counter.inputTokens, output: counter.outputTokens },
    phraseMatchRule: `token overlap >= ${PHRASE_MATCH_THRESHOLD} of the gold phrase's tokens against requirement term + excerpt`,
    supportedCoverage: ratio(supCovered, supTotal),
    supportedPhrases: supTotal,
    falseSupport: ratio(unsLinked, unsTotal),
    unsupportedPhrases: unsTotal,
    mappingFailures: pairs.filter((r) => r.error).length,
    meanLatencyMs: ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : null,
    unmatched,
    pairs,
    ranking,
  };
}

const same = (a?: string, b?: string) =>
  Boolean(a && b) &&
  a!.trim().toLowerCase().replace(/\s+/g, ' ') === b!.trim().toLowerCase().replace(/\s+/g, ' ');

export async function runPagesLiveSuite(limit: number) {
  const { extractJobPage } = await import('../packages/agents/src/job-page.js');
  const screening = await runScreeningSuite();
  const passed = new Set(screening.rows.filter((r) => r.reachedModel).map((r) => r.id));
  const all = datasets.pages();
  const chosen = all.filter((p) => passed.has(p.id) || p.trap).slice(0, Math.min(12, limit));
  console.log(
    `pages-live: ${chosen.length} page reads planned (at most 12); provider retries may add calls.`,
  );
  const counter: Counter = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const rows = [];
  for (const page of chosen) {
    let raw: any = null;
    let error: string | null = null;
    const started = Date.now();
    // discoverWeb applies the production acceptance rule (title and company quoted on the page).
    const result = await screenPage(page, async (p) => {
      try {
        raw = await extractJobPage(p, 'openai', counterHooks(counter));
        return raw;
      } catch (e) {
        error = String((e as Error).message).slice(0, 300);
        throw e;
      }
    });
    const job = result.jobs[0];
    const isPosting = page.gold.kind === 'posting';
    rows.push({
      id: page.id,
      trap: Boolean(page.trap),
      goldKind: page.gold.kind,
      accepted: Boolean(job),
      correctDecision: Boolean(job) === isPosting,
      reason: job ? null : (result.discovery.rejected[0]?.reason ?? null),
      title: job?.title ?? null,
      company: job?.company ?? null,
      fabricated:
        Boolean(job) &&
        (!same(job.title, page.gold.title) || !same(job.company, page.gold.company)),
      model: raw
        ? { isJobPosting: raw.isJobPosting, title: raw.title, company: raw.company }
        : null,
      error,
      ms: Date.now() - started,
    });
  }
  return {
    suite: 'pages-live',
    size: rows.length,
    modelCalls: counter.calls,
    tokens: { input: counter.inputTokens, output: counter.outputTokens },
    fabricationRule:
      'accepted page whose title or company differs (case/space-insensitive) from the gold value',
    accepted: rows.filter((r) => r.accepted).length,
    correctDecisions: rows.filter((r) => r.correctDecision).length,
    fabrications: rows.filter((r) => r.fabricated).length,
    trapFabrications: rows.filter((r) => r.trap && r.fabricated).length,
    failures: rows.filter((r) => r.error).length,
    rows,
  };
}

// ---------------------------------------------------------------- report
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? 'n/a' : `${(n * 100).toFixed(1)}%`;

export function renderMarkdown(report: any) {
  const r = report.suites.records,
    s = report.suites.screening,
    k = report.suites['ranking-baseline'];
  const lines = [
    `# CareerFlow evaluation report`,
    '',
    `Run ${report.startedAt} · commit ${report.commit} · mode ${report.mode}`,
    '',
    'All data is fictional and labelled by one author; small synthetic sets, not a market sample.',
    '',
    `## Records (${r.size} ads)`,
    '',
    '| Field | Accuracy | Stated precision | Stated recall | Gold stated | Predicted stated |',
    '| --- | --- | --- | --- | --- | --- |',
    ...FIELDS.map(
      (f) =>
        `| ${f} | ${pct(r.fields[f].accuracy)} (${r.fields[f].correct}/${r.fields[f].total}) | ${pct(r.fields[f].statedPrecision)} | ${pct(r.fields[f].statedRecall)} | ${r.fields[f].goldStated} | ${r.fields[f].predictedStated} |`,
    ),
    '',
    `Overall field accuracy ${pct(r.overallAccuracy)}. Quote validity ${pct(r.quoteValidity)} of ${r.quotesChecked} quoted fields.`,
    '',
    `${r.salarySingleFigureMisses} salary misses differ only because a single figure is labelled min = max while the extractor leaves max empty; accepting that convention would give salary accuracy ${pct(r.salaryAccuracyIfSingleFigureMaxEmptyAccepted)}. The strict figure above is the one gated.`,
    '',
    '### Misses',
    '',
    '| Item | Field | Expected | Got | Quote |',
    '| --- | --- | --- | --- | --- |',
    ...r.misses.map(
      (m: any) =>
        `| ${m.id} | ${m.field} | ${JSON.stringify(m.expected)} | ${JSON.stringify(m.got)} | ${(m.quote || '').replace(/\|/g, '/').slice(0, 90)} |`,
    ),
    '',
    `## Screening (${s.size} pages)`,
    '',
    `Postings reaching the model: ${pct(s.postingRecall)} of ${s.postings}. Non-postings stopped before the model: ${pct(s.nonPostingsStopped)} of ${s.nonPostings} (${s.modelCallsSaved} model calls saved).`,
    '',
    '| Page | Gold | Outcome | Screening reason |',
    '| --- | --- | --- | --- |',
    ...s.misclassified.map(
      (m: any) => `| ${m.id} | ${m.goldKind} | ${m.outcome} | ${m.reason ?? ''} |`,
    ),
    '',
    `## Ranking baseline (${k.size} profile-job pairs)`,
    '',
    '| Profile | nDCG@5 | Pairwise accuracy |',
    '| --- | --- | --- |',
    ...k.perProfile.map((p: any) => `| ${p.profile} | ${p.ndcg5} | ${p.pairwise} |`),
    `| mean | ${k.meanNdcg5} | ${k.meanPairwise} |`,
    '',
    'Ties in score keep dataset order.',
  ];
  const m = report.suites['mapping-live'];
  if (m)
    lines.push(
      '',
      '## Mapping (live)',
      '',
      `Model calls ${m.modelCalls}. Supported phrases covered ${pct(m.supportedCoverage)} of ${m.supportedPhrases}; unsupported phrases linked (false support) ${pct(m.falseSupport)} of ${m.unsupportedPhrases}; mapping failures ${m.mappingFailures}; mean latency ${m.meanLatencyMs} ms. Rule: ${m.phraseMatchRule}.`,
      '',
      `Ranking (live, ${m.ranking.profile}): nDCG@5 ${m.ranking.ndcg5}, pairwise ${m.ranking.pairwise}; baseline nDCG@5 ${m.ranking.baseline?.ndcg5}, pairwise ${m.ranking.baseline?.pairwise}.`,
      '',
      'Unmatched gold phrases (audit by hand):',
      '',
      ...(m.unmatched.length
        ? m.unmatched.map((u: any) => `- ${u.pair} (${u.kind}): ${u.phrase}`)
        : ['- none']),
    );
  const pl = report.suites['pages-live'];
  if (pl)
    lines.push(
      '',
      '## Pages (live)',
      '',
      `Model calls ${pl.modelCalls}. Pages ${pl.size}; accepted ${pl.accepted}; correct accept/reject ${pl.correctDecisions}; fabrications ${pl.fabrications} (traps ${pl.trapFabrications}); failures ${pl.failures}.`,
      '',
      '| Page | Trap | Gold | Accepted | Title | Company | Fabricated | Reason |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...pl.rows.map(
        (x: any) =>
          `| ${x.id} | ${x.trap ? 'yes' : ''} | ${x.goldKind} | ${x.accepted} | ${x.title ?? ''} | ${x.company ?? ''} | ${x.fabricated} | ${x.reason ?? x.error ?? ''} |`,
      ),
    );
  return lines.join('\n') + '\n';
}

function summaryTable(report: any) {
  const r = report.suites.records,
    s = report.suites.screening,
    k = report.suites['ranking-baseline'];
  const rows: [string, string][] = [
    ...FIELDS.map((f) => [`records.${f}.accuracy`, pct(r.fields[f].accuracy)] as [string, string]),
    ['records.overall', pct(r.overallAccuracy)],
    ['records.quoteValidity', pct(r.quoteValidity)],
    ['records.misses', String(r.misses.length)],
    ['screening.postingRecall', pct(s.postingRecall)],
    ['screening.nonPostingsStopped', pct(s.nonPostingsStopped)],
    ['ranking.meanNdcg5', String(k.meanNdcg5)],
    ['ranking.meanPairwise', String(k.meanPairwise)],
  ];
  const rh = report.suites['records-holdout'],
    sh = report.suites['screening-holdout'];
  if (rh)
    rows.push(
      ...FIELDS.map(
        (f) => [`holdout.records.${f}.accuracy`, pct(rh.fields[f].accuracy)] as [string, string],
      ),
      ['holdout.records.overall', pct(rh.overallAccuracy)],
      ['holdout.records.quoteValidity', pct(rh.quoteValidity)],
    );
  if (sh)
    rows.push(
      ['holdout.screening.postingRecall', pct(sh.postingRecall)],
      ['holdout.screening.nonPostingsStopped', pct(sh.nonPostingsStopped)],
    );
  const m = report.suites['mapping-live'];
  if (m)
    rows.push(
      ['mapping.supportedCoverage', pct(m.supportedCoverage)],
      ['mapping.falseSupport', pct(m.falseSupport)],
      ['mapping.failures', String(m.mappingFailures)],
      ['mapping.modelCalls', String(m.modelCalls)],
      ['rankingLive.ndcg5', String(m.ranking.ndcg5)],
    );
  const pl = report.suites['pages-live'];
  if (pl)
    rows.push(
      ['pages.correctDecisions', `${pl.correctDecisions}/${pl.size}`],
      ['pages.fabrications', String(pl.fabrications)],
      ['pages.modelCalls', String(pl.modelCalls)],
    );
  const w = Math.max(...rows.map(([a]) => a.length));
  return rows.map(([a, b]) => `${a.padEnd(w)}  ${b}`).join('\n');
}

async function main(argv: string[]) {
  const live = argv.includes('--live');
  const at = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const limit = Math.max(1, Number(at('--limit') || 1000));
  const startedAt = new Date().toISOString();
  const out = resolve(at('--out') || join(root, 'output', 'eval', startedAt.replace(/[:.]/g, '-')));
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  } catch {}
  if (live) await import('dotenv/config');
  const suites: Record<string, any> = {
    records: runRecordsSuite(),
    screening: await runScreeningSuite(),
    'ranking-baseline': runRankingBaselineSuite(),
    'records-holdout': runRecordsSuite(datasets.recordsHoldout()),
    'screening-holdout': await runScreeningSuite(datasets.pagesHoldout()),
  };
  if (live) {
    for (const [name, fn] of [
      ['mapping-live', runMappingLiveSuite],
      ['pages-live', runPagesLiveSuite],
    ] as const)
      try {
        suites[name] = await fn(limit);
      } catch (error) {
        suites[name] = { suite: name, crashed: String((error as Error).message).slice(0, 500) };
        console.error(`${name} did not complete: ${suites[name].crashed}`);
      }
  }
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    commit,
    mode: live ? 'live' : 'deterministic',
    config: { limit: live ? limit : null, phraseMatchThreshold: PHRASE_MATCH_THRESHOLD, out },
    datasets: {
      records: datasets.records().length,
      pages: datasets.pages().length,
      traps: datasets.pages().filter((p) => p.trap).length,
      profiles: datasets.matching().length,
      matchingPairs: datasets.matching().reduce((s, p) => s + p.jobs.length, 0),
      labelledMappingPairs: datasets
        .matching()
        .reduce((s, p) => s + p.jobs.filter((j) => j.goldSupported).length, 0),
    },
    modelCalls: {
      'mapping-live': suites['mapping-live']?.modelCalls ?? 0,
      'pages-live': suites['pages-live']?.modelCalls ?? 0,
    },
    suites,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const safe = { ...report, suites: { ...suites } };
  for (const name of ['mapping-live', 'pages-live'])
    if (suites[name]?.crashed) delete safe.suites[name];
  writeFileSync(join(out, 'report.md'), renderMarkdown(safe));
  console.log(summaryTable(safe));
  console.log(`\nReport: ${join(out, 'report.md')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
