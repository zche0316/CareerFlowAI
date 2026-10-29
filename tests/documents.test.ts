import { it, expect } from 'vitest';
import { extractFile, pageImage } from '../packages/documents/src/extract.js';
import { resumePdf, resumeDocx, resumeText } from '../packages/documents/src/resume.js';
import { createCanvas } from '@napi-rs/canvas';
const content = {
  name: 'Alex Morgan',
  jobTitle: 'Data Analyst',
  claims: [
    { kind: 'skill', text: 'Python and SQL' },
    {
      kind: 'experience',
      section: 'workExperiences',
      text: 'Data Analyst\nExample Pty Ltd\n2024-01 – 2025-02\nBuilt verified reporting.',
    },
    {
      kind: 'experience',
      section: 'projects',
      text: 'Reporting Project\nCreated a reporting dashboard.',
    },
  ],
};
it('exports a real text-searchable PDF and DOCX and extracts the approved content with page provenance', async () => {
  const pdf = await resumePdf(content);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const pages = await extractFile(pdf, 'application/pdf');
  const text = pages.map((p) => p.text).join(' ');
  expect(text).toContain('Alex Morgan');
  expect(text).toContain('Built verified reporting.');
  expect(text).toContain('PROJECTS');
  expect(text).not.toContain('Australian citizen');
  expect(pages.every((p) => p.route === 'text')).toBe(true);
  const raster = await pageImage(pdf, 'application/pdf', 1);
  expect(raster.startsWith('data:image/png;base64,')).toBe(true);
  const docx = await resumeDocx(content);
  expect(docx.subarray(0, 2).toString()).toBe('PK');
  expect(resumeText(content)).toContain('WORK EXPERIENCE');
});
it('handles UTF-8 text locally and routes genuine image input to explicit vision without inventing text', async () => {
  const pages = await extractFile(
    Buffer.from('Alex Morgan\nExample role, Jan 2024 - Present'),
    'text/plain',
  );
  expect(pages[0].text).toContain('Jan 2024');
  expect(pages[0].route).toBe('text');
  const canvas = createCanvas(200, 100);
  const bytes = canvas.toBuffer('image/png');
  expect((await extractFile(bytes, 'image/png'))[0].route).toBe('vision');
  await expect(extractFile(Buffer.from('not a PDF'), 'application/pdf')).rejects.toThrow();
  await expect(extractFile(Buffer.from([0xff, 0xfe]), 'text/plain')).rejects.toThrow();
});
