// Adds ESCO occupations to the Coach's reference corpus (CFS-140): the European Commission's
// classification of occupations and skills, read through its public API. For each occupation in
// the chosen ISCO groups it keeps the description, a few alternative names and the first essential
// skills, and writes data/coach-sources/esco.json with the attribution ESCO asks for.
// Run: node scripts/coach-sources-esco.mjs   (about 150 API requests to ec.europa.eu)
import { mkdir, writeFile } from 'node:fs/promises';

const api = 'https://ec.europa.eu/esco/api';
// ICT service managers, mathematicians and statisticians, financial and management analysts,
// ICT professionals, ICT technicians, telecommunications engineers.
export const iscoGroups = [
  '1330',
  '2120',
  '2413',
  '2421',
  '2511',
  '2512',
  '2513',
  '2514',
  '2519',
  '2521',
  '2522',
  '2523',
  '2529',
  '2153',
  '3511',
  '3512',
  '3513',
  '3514',
];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(api + path, { headers: { 'User-Agent': 'CareerFlow-coach-sources' } });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw Error(`${path}: HTTP ${r.status}`);
    await pause(1500 * (attempt + 1));
  }
  throw Error(`${path}: ESCO did not answer`);
}

const text = (v) => (typeof v === 'string' ? v : v?.en?.literal || v?.literal || v?.en || '');
const links = (d, key) => {
  const v = d?._links?.[key];
  return Array.isArray(v) ? v : v ? [v] : [];
};

/** One ESCO occupation as a Coach source document. Pure, so it is unit-tested. */
export function escoDoc(o) {
  const title = text(o.preferredLabel) || o.title;
  const alt = (o.alternativeLabel?.en || []).filter((a) => a.toLowerCase() !== title.toLowerCase());
  const essential = links(o, 'hasEssentialSkill')
    .map((s) => s.title)
    .slice(0, 12);
  return {
    id: `esco:${o.uri.split('/').pop()}`,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    text: [
      text(o.description).trim(),
      alt.length ? `Also called: ${alt.slice(0, 5).join(', ')}.` : '',
      essential.length ? `Essential skills: ${essential.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    url: `https://esco.ec.europa.eu/en/classification/occupation?uri=${encodeURIComponent(o.uri)}`,
    source: 'ESCO',
  };
}

async function occupations() {
  const seen = new Map();
  const visit = async (uri, depth) => {
    if (seen.has(uri)) return;
    const o = await get(`/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`);
    seen.set(uri, o);
    await pause(120);
    // Specialisations (for example "data analyst" under "systems analyst"), one level down.
    if (depth < 1)
      for (const child of links(o, 'narrowerOccupation')) await visit(child.uri, depth + 1);
  };
  for (const code of iscoGroups) {
    const group = await get(
      `/resource/concept?uri=http://data.europa.eu/esco/isco/C${code}&language=en`,
    );
    for (const o of links(group, 'narrowerOccupation')) await visit(o.uri, 0);
  }
  return [...seen.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const docs = (await occupations()).map(escoDoc).filter((d) => d.text.length > 40);
  await mkdir(new URL('../data/coach-sources/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../data/coach-sources/esco.json', import.meta.url),
    JSON.stringify(
      {
        attribution: `This service uses the ESCO classification of the European Commission (retrieved ${new Date().toISOString().slice(0, 10)}). CareerFlow has modified it: selected occupations, shortened alternative names and essential-skill lists.`,
        licence:
          'Free reuse under Commission Decision 2011/833/EU · https://esco.ec.europa.eu/en/about-esco/data-science-and-esco',
        docs,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`Wrote ${docs.length} ESCO occupations to data/coach-sources/esco.json`);
}
