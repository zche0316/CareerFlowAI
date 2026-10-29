// Explicit opt-in live probe. Uses only synthetic candidate data, never database profiles.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import {
  importModel,
  groundImportedRecords,
  importResultSchema,
} from '../packages/agents/src/import-model.js';
import { resumePdf, resumeDocx } from '../packages/documents/src/resume.js';
const out = 'output/profile-workflow-20261029';
await fs.mkdir(out, { recursive: true });
const text = `FICTIONAL TEST CANDIDATE\nAlex Morgan\nWORK EXPERIENCE\nSoftware Engineer\nExample Pty Ltd\nSydney\nJan 2024 - Feb 2025\nBuilt SQL reports.\nPROJECTS\nStudent Dashboard\nUniversity Project\nMar 2025 - Jun 2025\nCreated a reporting dashboard.\nEDUCATION\nBachelor of Information Technology\nExample University\nFeb 2021 - Nov 2024`;
await fs.writeFile(out + '/fictional-resume.txt', text);
const canvas = createCanvas(1200, 1300),
  ctx = canvas.getContext('2d');
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, 1200, 1300);
ctx.fillStyle = 'black';
ctx.font = '28px Arial';
text.split('\n').forEach((line, i) => ctx.fillText(line, 50, 60 + i * 48));
const bytes = canvas.toBuffer('image/png');
await fs.writeFile(out + '/fictional-scan.png', bytes);
const evidence: any = { fictional: true, runs: [] };
for (const task of ['vision', 'light'] as const) {
  try {
    const response = await importModel(
      task,
      task === 'vision'
        ? 'data:image/png;base64,' + bytes.toString('base64')
        : [{ page: 1, text, route: 'text', method: 'plain-text' }],
    );
    const grounded =
      task === 'light'
        ? groundImportedRecords(importResultSchema.parse(response.result), [
            { page: 1, text, route: 'text', method: 'plain-text' },
          ])
        : null;
    evidence.runs.push({ task, ...response, grounded });
    console.log(
      JSON.stringify({
        task,
        ...response.usage,
        records: grounded?.records.length,
        rejected: grounded?.rejected.length,
        textContainsCandidate:
          task === 'vision' ? (response.result as any).text.includes('Alex Morgan') : undefined,
      }),
    );
  } catch (e: any) {
    evidence.runs.push({ task, error: e.status ? `Provider HTTP ${e.status}` : e.name });
    console.log(task, 'failed', e.status || e.name);
  }
}
await fs.writeFile(out + '/live-models.json', JSON.stringify(evidence, null, 2));
const content = {
  name: 'Alex Morgan',
  jobTitle: 'Data Analyst',
  contact: { email: 'alex@example.test', city: 'Sydney' },
  claims: [
    { kind: 'skill', text: 'Python, SQL, Git' },
    {
      kind: 'experience',
      section: 'workExperiences',
      text: 'Software Engineer\nExample Pty Ltd | Sydney\n2024-01 – 2025-02\nBuilt SQL reports.',
    },
    {
      kind: 'experience',
      section: 'projects',
      text: 'Student Dashboard\n2025-03 – 2025-06\nCreated a reporting dashboard.',
    },
    {
      kind: 'education',
      section: 'educations',
      text: 'Bachelor of Information Technology\nExample University\n2021-02 – 2024-11',
    },
  ],
};
await fs.writeFile(out + '/resume.pdf', await resumePdf(content));
await fs.writeFile(out + '/resume.docx', await resumeDocx(content));
