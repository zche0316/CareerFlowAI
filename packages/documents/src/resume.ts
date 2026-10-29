import PDFDocument from 'pdfkit';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Footer,
  PageNumber,
  AlignmentType,
} from 'docx';
import { fileURLToPath } from 'node:url';
export type ResumeContent = {
  name: string;
  jobTitle: string;
  profileVersion?: number;
  contact?: {
    email?: string;
    phone?: string;
    city?: string;
    linkedin?: string;
    portfolio?: string;
    workRights?: string;
  };
  claims: { text: string; kind: string; section?: string }[];
};
const headings: Record<string, string> = {
  skill: 'Skills',
  education: 'Education',
  experience: 'Experience',
  workExperiences: 'Work Experience',
  projects: 'Projects',
  educations: 'Education',
};
export function resumeSections(c: ResumeContent) {
  const groups = new Map<string, string[]>();
  for (const claim of c.claims) {
    const key = claim.section || claim.kind;
    if (!headings[key]) continue;
    const label = headings[key];
    groups.set(label, [...(groups.get(label) || []), claim.text]);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}
const contactLine = (c: ResumeContent) =>
  [c.contact?.email, c.contact?.phone, c.contact?.city, c.contact?.linkedin, c.contact?.portfolio]
    .filter(Boolean)
    .join(' | ');
export function resumeText(c: ResumeContent) {
  return [
    c.name,
    contactLine(c),
    c.contact?.workRights ? 'Work rights: ' + c.contact.workRights : '',
    'Application target: ' + c.jobTitle,
    ...resumeSections(c).flatMap((s) => ['', s.title.toUpperCase(), ...s.items]),
  ]
    .filter((x) => x !== undefined)
    .join('\n');
}
export async function resumeDocx(c: ResumeContent) {
  const children = [
    new Paragraph({ text: c.name, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: contactLine(c) }),
    new Paragraph({ text: 'Application target: ' + c.jobTitle }),
  ];
  if (c.contact?.workRights)
    children.push(new Paragraph({ text: 'Work rights: ' + c.contact.workRights }));
  for (const section of resumeSections(c)) {
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        keepNext: true,
        spacing: { before: 220, after: 100 },
      }),
    );
    for (const item of section.items)
      for (const [i, line] of item.split('\n').entries())
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, bold: i === 0 && section.title !== 'Skills' })],
            spacing: { after: 100 },
            keepNext: i === 0 && item.includes('\n'),
          }),
        );
  }
  return Packer.toBuffer(
    new Document({
      creator: 'CareerFlow',
      title: c.name + ' Resume',
      styles: {
        default: {
          document: {
            run: { font: 'Arial', size: 22 },
            paragraph: { spacing: { after: 100, line: 276 } },
          },
          heading1: { run: { color: '17243A', size: 25, bold: true } },
          title: { run: { color: '000000', size: 38, bold: true } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 850, right: 850, bottom: 850, left: 850 },
            },
          },
          children,
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun(c.name + ' | '),
                    new TextRun({ children: [PageNumber.CURRENT] }),
                  ],
                }),
              ],
            }),
          },
        },
      ],
    }),
  );
}
export async function resumePdf(c: ResumeContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      bufferPages: true,
      info: { Title: c.name + ' Resume', Author: 'CareerFlow' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const regular = fileURLToPath(
      new URL(
        '../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
        import.meta.url,
      ),
    );
    const bold = fileURLToPath(
      new URL(
        '../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf',
        import.meta.url,
      ),
    );
    doc.registerFont('Resume', regular);
    doc.registerFont('ResumeBold', bold);
    doc.font('ResumeBold').fontSize(21).fillColor('#111111').text(c.name);
    doc.moveDown(0.3);
    doc.font('Resume').fontSize(10).text(contactLine(c));
    doc.moveDown(0.3);
    doc.text('Application target: ' + c.jobTitle);
    if (c.contact?.workRights) doc.text('Work rights: ' + c.contact.workRights);
    for (const section of resumeSections(c)) {
      if (doc.y > doc.page.height - 125) doc.addPage();
      doc.moveDown(0.8);
      doc.font('ResumeBold').fontSize(12).fillColor('#17243A').text(section.title.toUpperCase());
      doc.moveDown(0.4);
      for (const item of section.items) {
        const lines = item.split('\n');
        if (doc.y > doc.page.height - 110) doc.addPage();
        lines.forEach((line, i) =>
          doc
            .font(i === 0 && section.title !== 'Skills' ? 'ResumeBold' : 'Resume')
            .fontSize(10.5)
            .fillColor('#111111')
            .text(line, { lineGap: 2 }),
        );
        doc.moveDown(0.5);
      }
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Resume')
        .fontSize(8)
        .fillColor('#555555')
        .text(`${c.name} | ${i + 1}`, 48, doc.page.height - 30, {
          width: doc.page.width - 96,
          align: 'right',
          lineBreak: false,
        });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
