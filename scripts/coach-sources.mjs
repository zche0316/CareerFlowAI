// Builds the Coach's reference corpus (CFS-125) from the O*NET 31.0 database (CC BY 4.0):
// occupation descriptions, core tasks and software for technology, data and analysis
// occupations. Writes data/coach-sources/onet-31.json with the attribution O*NET asks for.
// Run: node scripts/coach-sources.mjs   (downloads three CSV files from onetcenter.org)
import { mkdir, writeFile } from 'node:fs/promises';

const base = 'https://www.onetcenter.org/dl_files/database/db_31_0_csv/';
const files = {
  occupations: 'occupation_data.csv',
  tasks: 'task_statements.csv',
  software: 'software_skills.csv',
};
// Computer and mathematical occupations, plus analyst and technical roles CareerFlow targets.
const keep = (code) =>
  code.startsWith('15-') ||
  ['11-3021', '13-1111', '13-1161', '13-2051', '17-2061', '17-2072'].some((p) =>
    code.startsWith(p),
  );

export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((field += '"'), i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') (row.push(field), (field = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      ((row = []), (field = ''));
    } else field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const col = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (key) return row[key];
  }
  throw Error(`Column not found: ${names.join(' / ')}. The O*NET file layout changed.`);
};

async function get(name) {
  const r = await fetch(base + name, { headers: { 'User-Agent': 'CareerFlow-coach-sources' } });
  if (!r.ok) throw Error(`${name}: HTTP ${r.status}`);
  return parseCsv(await r.text());
}

export function buildDocs(occupations, tasks, software) {
  const byCode = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const code = col(r, 'O*NET-SOC Code');
      if (!keep(code)) continue;
      (m.get(code) || m.set(code, []).get(code)).push(r);
    }
    return m;
  };
  const taskMap = byCode(tasks);
  const softMap = byCode(software);
  return occupations
    .filter((o) => keep(col(o, 'O*NET-SOC Code')))
    .map((o) => {
      const code = col(o, 'O*NET-SOC Code');
      const core = (taskMap.get(code) || [])
        .filter((t) => /core/i.test(col(t, 'Task Type') || 'Core'))
        .map((t) => col(t, 'Task'))
        .slice(0, 6);
      const tools = [
        ...new Set(
          (softMap.get(code) || [])
            .sort(
              (a, b) =>
                Number(/y/i.test(col(b, 'Hot Technology'))) -
                Number(/y/i.test(col(a, 'Hot Technology'))),
            )
            .map((s) => col(s, 'Workplace Example', 'Example')),
        ),
      ].slice(0, 10);
      return {
        id: `onet:${code}`,
        title: col(o, 'Title'),
        text: [
          col(o, 'Description'),
          core.length ? `Core tasks: ${core.join(' ')}` : '',
          tools.length ? `Common software: ${tools.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        url: `https://www.onetonline.org/link/summary/${code}`,
        source: 'O*NET 31.0',
      };
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [occupations, tasks, software] = await Promise.all(Object.values(files).map(get));
  const docs = buildDocs(occupations, tasks, software);
  await mkdir(new URL('../data/coach-sources/', import.meta.url), { recursive: true });
  await writeFile(
    new URL('../data/coach-sources/onet-31.json', import.meta.url),
    JSON.stringify(
      {
        attribution:
          'This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. CareerFlow has modified all or some of this information (selected occupations, shortened task and software lists). USDOL/ETA has not approved, endorsed, or tested these modifications.',
        licence: 'CC BY 4.0 · https://creativecommons.org/licenses/by/4.0/',
        docs,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`Wrote ${docs.length} occupations to data/coach-sources/onet-31.json`);
}
