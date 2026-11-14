import { expect, it } from 'vitest';
import { coachSources, retrieve, type SourceDoc } from '../apps/api/src/coach-sources.js';
import { buildDocs, parseCsv } from '../scripts/coach-sources.mjs';

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
  // Without a built corpus the Coach simply gets no sources.
  expect(coachSources('data analyst', null)).toEqual([]);
  expect(coachSources('data analyst', { attribution: 'a', licence: 'b', docs })[0]).toMatchObject({
    id: 'onet:15-2051.00',
    title: 'Data Scientists',
  });
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
