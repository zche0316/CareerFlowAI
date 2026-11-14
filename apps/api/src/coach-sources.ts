import { readFileSync, existsSync } from 'node:fs';
import { configuredMode } from '../../../packages/agents/src/provider.js';

// Coach retrieval over curated, openly licensed career sources (CFS-125, 140, 141). Two corpora are
// kept in the repository with their attribution: O*NET 31.0 (US Department of Labor, CC BY 4.0)
// says what a kind of work involves day to day; ESCO (European Commission) adds the European
// view, alternative names and essential skills. Passages are ranked by embeddings when the
// committed vectors and an API key are available, else by BM25. Sources describe jobs, never the
// candidate.

export type SourceDoc = {
  id: string; // onet:15-2051.00 or esco:<uuid>
  title: string;
  text: string;
  url: string;
  source: string;
};
export type Corpus = {
  /** Every source's attribution, one per line. */
  attribution: string;
  sources: { name: string; attribution: string; licence: string; prefix: string }[];
  docs: SourceDoc[];
};

const dir = new URL('../../../data/coach-sources/', import.meta.url);
const files = [
  { file: 'onet-31.json', name: 'O*NET', prefix: 'onet:' },
  { file: 'esco.json', name: 'ESCO', prefix: 'esco:' },
];
let cached: Corpus | null | undefined;

/** The committed corpora, or null when none has been built (the Coach then works as before). */
export function loadCorpus(): Corpus | null {
  if (cached !== undefined) return cached;
  const parts = files
    .filter((f) => existsSync(new URL(f.file, dir)))
    .map((f) => ({ ...f, data: JSON.parse(readFileSync(new URL(f.file, dir), 'utf8')) }));
  cached = parts.length
    ? {
        attribution: parts.map((p) => p.data.attribution).join('\n'),
        sources: parts.map((p) => ({
          name: p.name,
          prefix: p.prefix,
          attribution: p.data.attribution,
          licence: p.data.licence,
        })),
        docs: parts.flatMap((p) => p.data.docs as SourceDoc[]),
      }
    : null;
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
// O*NET software lists and ESCO skill lists are the long, repetitive tail of a document.
const split = (d: SourceDoc) => {
  const at = d.text.search(/\n(Common software|Essential skills):/);
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

/** BM25 scores over title, description and tasks, with the long lists lightly weighted. Pure. */
export function bm25Scores(docs: SourceDoc[], query: string): number[] {
  const q = [...new Set(tokens(expandQuery(query)))];
  if (!q.length || !docs.length) return docs.map(() => 0);
  const main = bm25(
    docs.map((d) => `${d.title} ${d.title} ${d.title} ${split(d)[0]}`),
    q,
  );
  const tools = bm25(
    docs.map((d) => split(d)[1]),
    q,
  );
  return docs.map((_, i) => main[i] + TOOL_WEIGHT * tools[i]);
}

/** The best BM25 matches. Pure. */
export function retrieve(docs: SourceDoc[], query: string, k = 4): SourceDoc[] {
  const scores = bm25Scores(docs, query);
  return docs
    .map((d, i) => ({ d, score: scores[i] }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.d);
}

// ---- Embedding retrieval (CFS-141) -------------------------------------------------------------

type Vectors = { model: string; dims: number; byId: Map<string, Float32Array> };
let vectors: Vectors | null | undefined;

/** The committed document vectors, or null when they are missing. */
export function loadVectors(): Vectors | null {
  if (vectors !== undefined) return vectors;
  const file = new URL('embeddings.json', dir);
  if (!existsSync(file)) return (vectors = null);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const flat = new Float32Array(new Uint8Array(Buffer.from(raw.vectors, 'base64')).buffer);
  const byId = new Map<string, Float32Array>(
    (raw.ids as string[]).map((id, i) => [id, flat.subarray(i * raw.dims, (i + 1) * raw.dims)]),
  );
  return (vectors = { model: raw.model, dims: raw.dims, byId });
}

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
};

// Embeddings blur exact job titles ("backend engineer", "DevOps"); a small bonus from the BM25
// score restores them. On 22 labelled questions (2026-11-14, O*NET corpus, 512 dimensions) this
// found the right first occupation 19 times, against 17 for embeddings alone and 13 for BM25
// alone, and kept working for plain-language and Chinese questions where BM25 finds nothing.
export const LEXICAL_BONUS = 0.1;

/**
 * Documents ranked by cosine similarity plus a small bonus for their BM25 rank, at most
 * `perSource` from one source so the Coach sees both the US and the European description when
 * both fit. Pure.
 */
export function rankByVector(
  docs: SourceDoc[],
  byId: Map<string, ArrayLike<number>>,
  query: ArrayLike<number>,
  k = 4,
  perSource = 3,
  lexical: Map<string, number> = new Map(),
) {
  // BM25 scores scaled to 0..1, so every strong keyword match gets the bonus, not just the first.
  const top = Math.max(0, ...lexical.values()) || 1;
  const ranked = docs
    .filter((d) => byId.has(d.id))
    .map((d) => ({
      d,
      s: cosine(query, byId.get(d.id)!) + (LEXICAL_BONUS * (lexical.get(d.id) || 0)) / top,
    }))
    .sort((x, y) => y.s - x.s);
  const out: SourceDoc[] = [];
  const count = new Map<string, number>();
  for (const { d } of ranked) {
    if ((count.get(d.source) || 0) >= perSource) continue;
    count.set(d.source, (count.get(d.source) || 0) + 1);
    out.push(d);
    if (out.length === k) break;
  }
  return out;
}

type Embedder = (
  text: string,
  model: string,
  dims: number,
) => Promise<{ vector: number[]; tokens: number }>;

const openAiEmbedder: Embedder = async (text, model, dims) => {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_NATIVE_API_KEY?.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, dimensions: dims, input: text.slice(0, 6000) }),
    signal: AbortSignal.timeout(8000),
  });
  const j: any = await r.json();
  if (!r.ok) throw Error(j?.error?.message || `HTTP ${r.status}`);
  return { vector: j.data[0].embedding, tokens: j.usage?.total_tokens || 0 };
};

/**
 * Passages for one Coach call, trimmed so the context stays small. Embeddings first (one small
 * request); BM25 in rehearsal mode, without a key or vectors, or when the request fails.
 */
export async function coachSources(
  query: string,
  options: { corpus?: Corpus | null; vectors?: Vectors | null; embed?: Embedder } = {},
) {
  const corpus = options.corpus === undefined ? loadCorpus() : options.corpus;
  const empty = {
    sources: [] as { id: string; title: string; text: string }[],
    method: 'none' as const,
    tokens: 0,
  };
  if (!corpus || !query.trim()) return empty;
  const v = options.vectors === undefined ? loadVectors() : options.vectors;
  const canEmbed =
    v &&
    (options.embed ||
      (configuredMode() !== 'fixture' && process.env.OPENAI_NATIVE_API_KEY?.trim()));
  let docs: SourceDoc[] | null = null;
  let method: 'embedding' | 'bm25' = 'bm25';
  let tokens = 0;
  if (canEmbed) {
    try {
      const e = await (options.embed || openAiEmbedder)(query, v!.model, v!.dims);
      docs = rankByVector(
        corpus.docs,
        v!.byId,
        e.vector,
        4,
        3,
        new Map(bm25Scores(corpus.docs, query).map((score, i) => [corpus.docs[i].id, score])),
      );
      tokens = e.tokens;
      method = 'embedding';
    } catch (error) {
      console.error('Coach source embedding failed; using BM25:', (error as Error).message);
    }
  }
  docs ||= retrieve(corpus.docs, query);
  return {
    sources: docs.map((d) => ({ id: d.id, title: d.title, text: d.text.slice(0, 900) })),
    method,
    tokens,
  };
}
