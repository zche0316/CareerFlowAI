import { expect, it } from 'vitest';
import {
  coachSources,
  expandQuery,
  loadCorpus,
  loadVectors,
  rankByVector,
  retrieve,
  type Corpus,
  type SourceDoc,
} from '../apps/api/src/coach-sources.js';
import { buildDocs, parseCsv } from '../scripts/coach-sources.mjs';
import { escoDoc } from '../scripts/coach-sources-esco.mjs';

// CFS-125: the Coach reads short, cited passages about occupations from an openly licensed corpus.

const doc = (id: string, title: string, text: string): SourceDoc => ({
  id,
  title,
  text,
  url: `https://www.onetonline.org/link/summary/${id.slice(5)}`,
  source: 'O*NET 31.0',
});
const docs = [
  doc(
    'onet:15-2051.00',
    'Data Scientists',
    'Develop and implement methods to analyse data. Common software: Python, SQL, R.',
  ),
  doc(
    'onet:15-1252.00',
    'Software Developers',
    'Design and build applications. Common software: Java, Git.',
  ),
  doc(
    'onet:13-1111.00',
    'Management Analysts',
    'Study procedures to improve efficiency. Gather requirements from stakeholders.',
  ),
];

it('ranks occupations by how well they match the user’s goal and skills', () => {
  expect(
    retrieve(docs, 'graduate data analyst role using SQL and Python').map((d) => d.id)[0],
  ).toBe('onet:15-2051.00');
  expect(retrieve(docs, 'stakeholders requirements', 1).map((d) => d.title)).toEqual([
    'Management Analysts',
  ]);
  expect(retrieve(docs, 'the and of')).toEqual([]);
});

const corpusOf = (d: SourceDoc[]): Corpus => ({ attribution: 'a', sources: [], docs: d });

it('falls back to BM25 without vectors, and returns nothing without a corpus', async () => {
  expect((await coachSources('data analyst', { corpus: null })).sources).toEqual([]);
  const r = await coachSources('data analyst', { corpus: corpusOf(docs), vectors: null });
  expect(r.method).toBe('bm25');
  expect(r.sources[0]).toMatchObject({ id: 'onet:15-2051.00', title: 'Data Scientists' });
});

it('ranks by embeddings with a keyword bonus, at most three per source, and survives a failed request (CFS-141)', async () => {
  const esco = (id: string, title: string): SourceDoc => ({
    id,
    title,
    text: title,
    url: '',
    source: 'ESCO',
  });
  const all = [...docs, esco('esco:a', 'Data analyst'), esco('esco:b', 'Statistician')];
  // Unit vectors on the first axes: the query points at "Data analyst", then "Statistician".
  const vec = (x: number, y: number) => [x, y, 0, 0];
  const byId = new Map<string, number[]>([
    ['onet:15-2051.00', vec(0.6, 0.8)],
    ['onet:15-1252.00', vec(0, 1)],
    ['onet:13-1111.00', vec(0.1, 0.99)],
    ['esco:a', vec(1, 0)],
    ['esco:b', vec(0.9, 0.44)],
  ]);
  const vectors = { model: 'm', dims: 4, byId: byId as any };
  const embed = async () => ({ vector: vec(1, 0), tokens: 7 });
  const r = await coachSources('data analysis', { corpus: corpusOf(all), vectors, embed });
  expect(r).toMatchObject({ method: 'embedding', tokens: 7 });
  expect(r.sources.map((x) => x.id).slice(0, 2)).toEqual(['esco:a', 'esco:b']);
  // Per-source cap: with perSource 1 the second ESCO item gives way to O*NET.
  expect(rankByVector(all, byId, vec(1, 0), 3, 1).map((d) => d.id)).toEqual([
    'esco:a',
    'onet:15-2051.00',
  ]);
  // A keyword match lifts an otherwise close candidate.
  const bonus = new Map([['onet:15-1252.00', 5]]);
  expect(rankByVector(all, byId, vec(0, 1), 1, 3, bonus)[0].id).toBe('onet:15-1252.00');
  const failing = async () => {
    throw Error('rate limited');
  };
  const fallback = await coachSources('data analyst', {
    corpus: corpusOf(all),
    vectors,
    embed: failing,
  });
  expect(fallback.method).toBe('bm25');
  expect(fallback.sources.length).toBeGreaterThan(0);
});

it('turns an ESCO occupation into a cited document (CFS-140)', () => {
  const d = escoDoc({
    uri: 'http://data.europa.eu/esco/occupation/d3ed',
    title: 'data analyst',
    preferredLabel: { en: 'data analyst' },
    alternativeLabel: { en: ['data analysts', 'Data analyst', 'data warehouse analyst'] },
    description: { en: { literal: 'Data analysts import, inspect and clean data.' } },
    _links: { hasEssentialSkill: [{ title: 'statistics' }, { title: 'query languages' }] },
  });
  expect(d).toMatchObject({ id: 'esco:d3ed', title: 'Data analyst', source: 'ESCO' });
  expect(d.text).toBe(
    'Data analysts import, inspect and clean data.\nAlso called: data analysts, data warehouse analyst.\nEssential skills: statistics, query languages.',
  );
  expect(d.url).toContain(encodeURIComponent('http://data.europa.eu/esco/occupation/d3ed'));
});

it('builds cited documents from the O*NET CSV files', () => {
  const occupations = parseCsv(
    '"O*NET-SOC Code","Title","Description"\n"15-2051.00","Data Scientists","Develop methods, ""carefully""."\n"29-1141.00","Registered Nurses","Care for patients."\n',
  );
  const tasks = parseCsv(
    'O*NET-SOC Code,Title,Task ID,Task,Task Type\n15-2051.00,Data Scientists,1,Clean data.,Core\n15-2051.00,Data Scientists,2,Write papers.,Supplemental\n',
  );
  const software = parseCsv(
    'O*NET-SOC Code,Title,Example,Commodity Code,Commodity Title,Hot Technology,In Demand\n15-2051.00,Data Scientists,R,1,Analytics,N,N\n15-2051.00,Data Scientists,Python,2,Dev,Y,Y\n',
  );
  const built = buildDocs(occupations, tasks, software);
  expect(built).toHaveLength(1);
  expect(built[0]).toMatchObject({
    id: 'onet:15-2051.00',
    title: 'Data Scientists',
    url: 'https://www.onetonline.org/link/summary/15-2051.00',
  });
  expect(built[0].text).toBe(
    'Develop methods, "carefully".\nCore tasks: Clean data.\nCommon software: Python, R.',
  );
});

it('matches plurals and common job titles to O*NET occupation names', () => {
  expect(retrieve(docs, 'management analyst', 1)[0].title).toBe('Management Analysts');
  expect(expandQuery('junior software engineer')).toContain('software developers');
  expect(retrieve(docs, 'junior software engineer', 1)[0].title).toBe('Software Developers');
});

it('ships O*NET and ESCO corpora with attribution and vectors for every document', async () => {
  const corpus = loadCorpus()!;
  expect(corpus.sources.map((x) => x.name)).toEqual(['O*NET', 'ESCO']);
  expect(corpus.attribution).toContain('O*NET 31.0 Database');
  expect(corpus.attribution).toContain('ESCO classification of the European Commission');
  const onet = corpus.docs.filter((d) => d.id.startsWith('onet:'));
  expect(
    onet.every((d) => /^onet:(15-|11-3021|13-1111|13-1161|13-2051|17-2061|17-2072)/.test(d.id)),
  ).toBe(true);
  expect(corpus.docs.filter((d) => d.id.startsWith('esco:')).length).toBeGreaterThan(50);
  const vectors = loadVectors()!;
  expect(vectors.dims).toBe(512);
  expect(corpus.docs.every((d) => vectors.byId.get(d.id)?.length === 512)).toBe(true);
  // In rehearsal mode the committed corpus is searched with BM25.
  const r = await coachSources('graduate data analyst SQL dashboards');
  expect(r.method).toBe('bm25');
  expect(r.sources.map((d) => d.title)).toContain('Business Intelligence Analysts');
});
