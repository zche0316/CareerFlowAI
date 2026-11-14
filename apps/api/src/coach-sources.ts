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
export const tokens = (text: string) =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) || [])
    .map((t) => t.replace(/\.+$/, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));

/** BM25 ranking of documents for a query; pure, so it is unit-tested with a small corpus. */
export function retrieve(docs: SourceDoc[], query: string, k = 4): SourceDoc[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return [];
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of tokens(`${d.title} ${d.title} ${d.text}`)) m.set(t, (m.get(t) || 0) + 1);
    return m;
  });
  const lengths = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  const avg = lengths.reduce((a, b) => a + b, 0) / docs.length;
  const df = new Map(q.map((t) => [t, tf.filter((m) => m.has(t)).length]));
  const k1 = 1.4,
    b = 0.75;
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const t of q) {
      const f = tf[i].get(t) || 0;
      if (!f) continue;
      const n = df.get(t)!;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avg));
    }
    return { d, score };
  });
  return scored
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
