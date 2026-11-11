import type { Express } from 'express';
import { db } from './db.js';
import { requireValue } from './errors.js';
import type { MissionData } from './domain.js';
import { capabilitiesFor } from './capability.js';
import {
  resumePdf,
  resumeSections,
  type ResumeContent,
} from '../../../packages/documents/src/resume.js';
import { extractFile } from '../../../packages/documents/src/extract.js';
import { buildJobRecord, workRightsLabels } from '../../../packages/contracts/src/job-record.js';
import {
  canonicalSkill,
  levelGaps,
  mentionsSkill,
  requirementItems,
  skillsIn,
} from '../../../packages/contracts/src/capability.js';
import { placeKey } from '../../../packages/agents/src/scout/scout.js';

// Recruiter view of an approved resume (CFS-116). It reproduces what applicant tracking systems
// and recruiters do with a resume, without pretending to know any employer's private ranking:
//   1. parse: re-read the exported PDF and confirm contact, sections, dates and lines survive;
//   2. keywords: required and preferred terms, literally and by known synonym, and where they sit;
//   3. knock-outs: work rights, location, years of experience, degree;
//   4. level fit from the capability model.
// The result is a checklist with sub-scores, not a pass probability. Exact-term suggestions are
// offered only where an approved line already uses another name for the same skill.

type Check = { label: string; ok: boolean; detail?: string };
type Knockout = { kind: string; status: 'met' | 'not_met' | 'check' | 'unknown'; detail: string };

const lower = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
const stop = new Set([
  'with',
  'and',
  'the',
  'that',
  'this',
  'from',
  'your',
  'have',
  'into',
  'their',
  'using',
  'experience',
  'ability',
  'skills',
  'strong',
  'excellent',
  'exceptional',
  'effectively',
  'work',
  'working',
]);
const aliasNamed = (term: string) => {
  const canonical = canonicalSkill(term);
  return canonical !== term.trim() || skillsIn(term).includes(canonical)
    ? [canonical]
    : skillsIn(term);
};
// Letters and digits only, so line wrapping, hyphenation and punctuation in the PDF do not matter.
const alnum = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (text: string, term: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}+#])${escape(term)}($|[^\\p{L}\\p{N}+#])`, 'iu').test(text);

export function keywordCoverage(
  items: { term: string; level: 'required' | 'preferred'; category?: string }[],
  content: ResumeContent,
) {
  const experience = content.claims
    .filter((c) => c.kind !== 'skill')
    .map((c) => c.text)
    .join('\n');
  const skills = content.claims
    .filter((c) => c.kind === 'skill')
    .map((c) => c.text)
    .join('\n');
  const all = experience + '\n' + skills + '\n' + (content.summary || '');
  const words = (t: string) =>
    (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 4 && !stop.has(w));
  const covers = (text: string, term: string) => {
    // A phrase with no named skill counts when most of its key words (by stem) appear.
    const key = words(term);
    if (!key.length) return false;
    const have = new Set(words(text).map((w) => w.slice(0, 5)));
    return key.filter((w) => have.has(w.slice(0, 5))).length / key.length >= 0.6;
  };
  const rows = items
    .filter((i) => !i.category || ['skill', 'experience'].includes(i.category))
    .map((i) => {
      const skills = aliasNamed(i.term);
      const exact = hasTerm(all, i.term);
      if (!skills.length) {
        const present = exact || covers(all, i.term);
        const where = !present
          ? 'missing'
          : exact || covers(experience, i.term)
            ? 'experience'
            : 'skills only';
        return {
          term: i.term,
          level: i.level,
          kind: 'phrase' as const,
          exact,
          synonym: false,
          where,
        };
      }
      const found = skills.filter((s) => mentionsSkill(all, s));
      const synonym = !exact && found.length > 0 && !skills.some((s) => hasTerm(all, s));
      const where = skills.some((s) => mentionsSkill(experience, s))
        ? 'experience'
        : found.length
          ? 'skills only'
          : 'missing';
      return { term: i.term, level: i.level, kind: 'skill' as const, exact, synonym, where };
    });
  // Use the employer's exact term only where an approved line already names the same skill.
  const swaps = rows
    .filter((r) => r.synonym)
    .map((r) => ({
      term: r.term,
      line: content.claims.find((c) => mentionsSkill(c.text, canonicalSkill(r.term)))?.text || '',
    }))
    .filter((s) => s.line);
  return { rows, swaps };
}

export function knockouts(match: any, profile: any): Knockout[] {
  const job = match?.job || {};
  const record = buildJobRecord(job);
  const out: Knockout[] = [];
  const rights = String(profile?.contact?.workRights || '');
  if (record.workRights) {
    const need = record.workRights.value;
    const citizen = /\b(citizen|permanent resident|\bpr\b)/i.test(rights);
    out.push({
      kind: 'Work rights',
      status: !rights
        ? 'unknown'
        : need === 'citizen_or_pr' || need === 'clearance'
          ? citizen
            ? 'met'
            : 'not_met'
          : need === 'no_sponsorship'
            ? citizen || /\b(full work rights|unrestricted|no sponsorship needed)\b/i.test(rights)
              ? 'met'
              : 'check'
            : 'met',
      detail: `${workRightsLabels[need]} (“${record.workRights.quote}”). Your profile: ${rights || 'not stated'}.`,
    });
  }
  const jobCity = placeKey(job.location || '');
  const remote = /\bremote\b/i.test(job.location || '') || record.arrangement?.value === 'remote';
  const home = placeKey(profile?.location || profile?.contact?.city || '');
  out.push({
    kind: 'Location',
    status: remote || !jobCity ? 'met' : !home ? 'unknown' : home === jobCity ? 'met' : 'check',
    detail: `Role: ${job.location || 'not stated'}. You: ${profile?.location || 'not stated'}.`,
  });
  const years = match?.mapping?.experienceYears;
  if (typeof years === 'number' && years > 0) {
    const have = Number(profile?.experienceYears || 0);
    out.push({
      kind: 'Years of experience',
      status: have >= years ? 'met' : 'not_met',
      detail: `Asks for ${years}+ years (“${match.mapping.experienceExcerpt || ''}”). Your profile: ${have}.`,
    });
  }
  const degree = (match?.mapping?.items || []).find(
    (i: any) => i.category === 'education' && i.level === 'required',
  );
  if (degree)
    out.push({
      kind: 'Degree',
      status: (profile?.educations || []).length || profile?.education ? 'met' : 'not_met',
      detail: `Asks for “${degree.excerpt || degree.term}”.`,
    });
  return out;
}

async function parseCheck(content: ResumeContent) {
  const pdf = await resumePdf(content);
  const pages = await extractFile(new Uint8Array(pdf), 'application/pdf');
  const text = lower(pages.map((p) => p.text).join('\n'));
  const has = (s?: string) => Boolean(s) && text.includes(lower(s!));
  const sections = resumeSections(content).map((s) => s.title);
  // Record headers carry dates the layout reformats, so each claim is checked by its first line.
  const lines = content.claims.map((c) => c.text.split('\n')[0]);
  const flat = alnum(pages.map((p) => p.text).join(''));
  const kept = lines.filter((l) => flat.includes(alnum(l).slice(0, 40))).length;
  const years = (
    content.claims
      .map((c) => c.text)
      .join(' ')
      .match(/\b(19|20)\d{2}\b/g) || []
  ).length;
  const checks: Check[] = [
    { label: 'Name', ok: has(content.name) },
    ...(content.contact?.email ? [{ label: 'Email', ok: has(content.contact.email) }] : []),
    ...(content.contact?.phone ? [{ label: 'Phone', ok: has(content.contact.phone) }] : []),
    ...sections.map((s) => ({ label: `Section: ${s}`, ok: has(s) })),
    {
      label: 'Resume lines',
      ok: kept === lines.length,
      detail: `${kept} of ${lines.length} lines read back from the PDF`,
    },
    {
      label: 'Dates',
      ok: years === 0 || /\b(19|20)\d{2}\b/.test(text),
      detail: `${pages.length} page(s)`,
    },
  ];
  return { checks, pages: pages.length };
}

export async function recruiterCheck(userId: string, resumeId: string) {
  const resume = requireValue(
    await db.approvedResume.findFirst({ where: { id: resumeId, userId } }),
  );
  const content = resume.content as unknown as ResumeContent;
  const mission = requireValue(
    await db.mission.findFirst({
      where: { id: resume.missionId, userId },
      include: { profile: true },
    }),
  );
  const match = (mission.data as MissionData).selectedJob;
  const items = requirementItems(match);
  const parse = await parseCheck(content);
  const keywords = keywordCoverage(items, content);
  const outs = knockouts(match, mission.profile.data);
  const gaps = levelGaps(items, await capabilitiesFor(userId));
  const required = keywords.rows.filter((r) => r.level === 'required');
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  return {
    jobTitle: match?.job?.title || content.jobTitle,
    company: match?.job?.company || '',
    scores: {
      parse: pct(parse.checks.filter((c) => c.ok).length, parse.checks.length),
      keywords: pct(required.filter((r) => r.where !== 'missing').length, required.length),
      inExperience: pct(required.filter((r) => r.where === 'experience').length, required.length),
      knockouts: outs.filter((k) => k.status === 'not_met').length,
      levelFit: pct(
        required.length - gaps.filter((g) => g.level === 'required').length,
        required.length,
      ),
    },
    parse,
    keywords,
    knockouts: outs,
    levelGaps: gaps,
    limitations: [
      'Employers configure their own systems; this is a checklist of common screening steps, not a pass probability.',
      'Only the PDF is re-read; the DOCX is generated from the same sections.',
    ],
  };
}

export function registerRecruiterCheck(app: Express) {
  app.get('/api/resumes/:id/recruiter-check', async (req, res) =>
    res.json(await recruiterCheck(req.actor!.id, String(req.params.id))),
  );
}
