import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resumePdf, resumeDocx } from '../packages/documents/src/resume.js';
import { pageImage, extractFile } from '../packages/documents/src/extract.js';
const dir = 'output/release-review';
await mkdir(dir, { recursive: true });
let targetTitle = 'Australian Data Analyst';
let source = 'fictional QA';
if (process.argv.includes('--snapshot') || process.argv.includes('--live')) {
  const { JobRepository } = await import('../packages/recruitment/src/repository.js');
  const { compare } = await import('../packages/matching/domain.js');
  const repo = new JobRepository();
  let job: any;
  if (process.argv.includes('--live')) {
    const result = await repo.search(
      {
        provider: 'greenhouse',
        board: 'spaceship',
        country: 'au',
        region: '',
        location: '',
        keyword: '',
      },
      { signal: AbortSignal.timeout(15000) },
    );
    job = result.jobs[0];
    if (!job) throw Error('No current Australian vacancy; no fixture substitution.');
    const status = await repo.revalidate(job, { signal: AbortSignal.timeout(15000) });
    if (status.status !== 'published_at_check') throw Error('Vacancy no longer published.');
    source =
      'live official Greenhouse search and revalidation; fictional candidate; no authenticated mission or submission';
  } else {
    const snapshot = JSON.parse(
      await readFile('output/release-review/greenhouse-response.json', 'utf8'),
    );
    const raw = snapshot.jobs[0];
    if (!raw?.id || !raw.absolute_url?.startsWith('https://job-boards.greenhouse.io/'))
      throw Error('Invalid public snapshot');
    job = repo.normalize(
      {
        id: raw.id,
        title: raw.title,
        company: 'Spaceship',
        location: raw.location.name,
        description: raw.content,
        url: raw.absolute_url,
      },
      { provider: 'greenhouse', board: 'spaceship' },
    );
    source =
      'replay of a public API response observed on 30 October; no live request in this script';
  }
  const match = compare(
    {
      skills: ['react', 'typescript'],
      experienceYears: 0,
      education: 'Bachelor of IT',
      location: 'Sydney',
      employmentType: 'Full-time',
      goals: 'Build software products',
    },
    job,
    [job.description],
  );
  targetTitle = match.job.title;
  await writeFile(
    `${dir}/job-handoff.json`,
    JSON.stringify(
      {
        source,
        jobId: job.id,
        title: targetTitle,
        applicationUrl: job.applicationUrl,
        score: match.score,
        limitations: match.limitations,
      },
      null,
      2,
    ),
  );
}
const content = {
  name: 'Alex Morgan (fictional QA)',
  jobTitle: targetTitle,
  profileVersion: 1,
  contact: { email: 'alex@example.test', city: 'Sydney, NSW' },
  claims: [
    { kind: 'skill', text: 'Python; SQL; Excel' },
    {
      kind: 'education',
      text: 'Bachelor of Information Technology\nExample University\n2022 - 2025',
    },
    {
      kind: 'experience',
      section: 'projects',
      text: 'Reporting Project\nCourse project\n2025-02 - 2025-06\nCleaned the supplied dataset and built a reporting dashboard. Outcome not measured.',
    },
  ],
};
const pdf = await resumePdf(content);
await writeFile(`${dir}/resume.pdf`, pdf);
await writeFile(`${dir}/resume.docx`, await resumeDocx(content));
const pages = await extractFile(pdf, 'application/pdf');
for (let page = 1; page <= pages.length; page++) {
  const data = await pageImage(pdf, 'application/pdf', page);
  await writeFile(`${dir}/pdf-${page}.png`, Buffer.from(data.split(',')[1], 'base64'));
}
await writeFile(`${dir}/pdf-text.txt`, pages.map((p) => p.text).join('\n'));
console.log(JSON.stringify({ pages: pages.length, output: dir, targetTitle, source }));
