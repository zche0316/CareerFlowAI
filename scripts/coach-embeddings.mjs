// Computes embeddings for every Coach source document once (CFS-141) and writes
// data/coach-sources/embeddings.json: model, dimensions, document ids and the vectors as one
// base64 Float32 block. Run after the corpus changes: node --env-file=.env scripts/coach-embeddings.mjs
import { readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 512;
const dir = new URL('../data/coach-sources/', import.meta.url);

/** The text a document is embedded from: what the work is, then its skills or tools. */
export const embedText = (d) => `${d.title}\n${d.text}`.slice(0, 6000);

export function packVectors(vectors) {
  const flat = new Float32Array(vectors.length * vectors[0].length);
  vectors.forEach((v, i) => flat.set(v, i * v.length));
  return Buffer.from(flat.buffer).toString('base64');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.OPENAI_NATIVE_API_KEY?.trim();
  if (!key) throw Error('Set OPENAI_NATIVE_API_KEY (for example with --env-file=.env).');
  const docs = ['onet-31.json', 'esco.json']
    .filter((f) => existsSync(new URL(f, dir)))
    .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).docs);
  const vectors = [];
  let tokens = 0;
  for (let i = 0; i < docs.length; i += 64) {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMS,
        input: docs.slice(i, i + 64).map(embedText),
      }),
    });
    const j = await r.json();
    if (!r.ok) throw Error(j.error?.message || `HTTP ${r.status}`);
    tokens += j.usage.total_tokens;
    vectors.push(...j.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  await writeFile(
    new URL('embeddings.json', dir),
    JSON.stringify({
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      ids: docs.map((d) => d.id),
      vectors: packVectors(vectors),
    }) + '\n',
  );
  console.log(
    `Embedded ${docs.length} documents (${tokens} tokens) into data/coach-sources/embeddings.json`,
  );
}
