import { readFileSync, existsSync } from 'node:fs';

// Coach retrieval over curated, openly licensed career sources (CFS-125). The corpus is built by
// scripts/coach-sources.mjs from the O*NET 31.0 database (CC BY 4.0) and kept in the repository
// with its attribution. Retrieval is lexical (BM25), so it needs no embedding calls. Sources tell
// the Coach what a kind of work involves; they are never facts about the candidate.

export type SourceDoc = {
  id: string; // e.g. onet:15-2051.00
  title: string;
  text: string;
  url: string;
  source: string;
};
export type Corpus = { attribution: string; licence: string; docs: SourceDoc[] };

const corpusFile = new URL('../../../data/coach-sources/onet-31.json', import.meta.url);
let cached: Corpus | null | undefined;

/** The committed corpus, or null when it has not been built yet (the Coach then works as before). */
export function loadCorpus(): Corpus | null {
  if (cached !== undefined) return cached;
  cached = existsSync(corpusFile) ? (JSON.parse(readFileSync(corpusFile, 'utf8')) as Corpus) : null;
  return cached;
}

const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or that the their this to was were will with you your our we i my me role roles work working job jobs'.split(
    ' ',
  ),
);
// Light stemming so "analyst" meets "Analysts" and "dashboard" meets "dashboards".
const stem = (t: string) =>
  t.length > 4 && t.endsWith('ies')
    ? t.slice(0, -3) + 'y'
    : t.length > 3 && t.endsWith('s') && !t.endsWith('ss')
      ? t.slice(0, -1)
      : t;
export const tokens = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) || [])
    .map((t) => stem(t.replace(/\.+$/, '')))
    .filter((t) => t.length > 1 && !STOP.has(t));

// Software lists name the same tools across many occupations, so they count for little; the
// title, description and tasks say what the work is.
const TOOL_WEIGHT = 0.2;
const split = (d: SourceDoc) => {
  const at = d.text.indexOf('\nCommon software:');
  return at < 0 ? [d.text, ''] : [d.text.slice(0, at), d.text.slice(at)];
};

function bm25(fields: string[], q: string[]) {
  const tf = fields.map((text) => {
    const m = new Map<string, number>();
    for (const t of tokens(text)) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  const lengths = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, fields.length) || 1;
  const k1 = 1.4,
    b = 0.75;
  return tf.map((m, i) =>
    q.reduce((score, t) => {
      const f = m.get(t) || 0;
      if (!f) return score;
      const n = tf.filter((x) => x.has(t)).length;
      const idf = Math.log(1 + (fields.length - n + 0.5) / (n + 0.5));
      return score + (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avg));
    }, 0),
  );
}

// Job titles in postings often differ from O*NET's occupation names; these add the O*NET wording.
const synonyms: [RegExp, string][] = [
  [/software engineer|backend|front.?end|full.?stack/i, 'software developers programmers'],
  [
    /devops|site reliability|\bsre\b|cloud engineer|platform engineer/i,
    'network computer systems administrators architects',
  ],
  [
    /data analyst|reporting analyst|insights analyst/i,
    'business intelligence analysts data scientists statisticians',
  ],
  [
    /business analyst|product analyst/i,
    'management analysts computer systems analysts business intelligence',
  ],
  [
    /machine learning|\bml\b|\bai engineer/i,
    'data scientists computer information research scientists',
  ],
  [/security|cyber/i, 'information security analysts engineers'],
  [/\bqa\b|test engineer|tester/i, 'software quality assurance analysts testers'],
];
export const expandQuery = (query: string) =>
  [query, ...synonyms.filter(([re]) => re.test(query)).map(([, words]) => words)].join(' ');

/** BM25 over title, description and tasks, with the software list lightly weighted. Pure. */
export function retrieve(docs: SourceDoc[], query: string, k = 4): SourceDoc[] {
  const q = [...new Set(tokens(expandQuery(query)))];
  if (!q.length || !docs.length) return [];
  const main = bm25(
    docs.map((d) => `${d.title} ${d.title} ${d.title} ${split(d)[0]}`),
    q,
  );
  const tools = bm25(
    docs.map((d) => split(d)[1]),
    q,
  );
  return docs
    .map((d, i) => ({ d, score: main[i] + TOOL_WEIGHT * tools[i] }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.d);
}

/** Passages for one Coach call, trimmed so the context stays small. */
export function coachSources(query: string, corpus = loadCorpus()) {
  if (!corpus) return [];
  return retrieve(corpus.docs, query).map((d) => ({
    id: d.id,
    title: d.title,
    text: d.text.slice(0, 900),
  }));
}
