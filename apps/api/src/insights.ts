import type { Express } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { AppError } from './errors.js';
import type { MissionData } from './domain.js';
import { configuredMode } from '../../../packages/agents/src/provider.js';
import { jobFingerprint, placeKey } from '../../../packages/agents/src/scout/scout.js';
import { buildJobRecord } from '../../../packages/contracts/src/job-record.js';
import { mentionsSkill } from '../../../packages/contracts/src/capability.js';
import { countrySpec } from '../../../packages/recruitment/src/geography.js';

// Regional market insight (CFS-115): what the roles this user's searches have actually found ask
// for, per country and city. Every number is counted from stored listings and every example can be
// traced to a listing; nothing is estimated from outside data.

export const roleFamilies: Record<string, RegExp> = {
  data: /\b(data|analytics?|analyst|bi|insights?|reporting)\b/i,
  software:
    /\b(software|developer|engineer|frontend|front-end|backend|back-end|full[- ]?stack|web)\b/i,
  ml: /\b(machine learning|ml|ai|data scientist|nlp|computer vision)\b/i,
  cloud: /\b(cloud|devops|sre|platform|infrastructure|site reliability)\b/i,
  product: /\b(product|business analyst|project|scrum)\b/i,
};
const familyOf = (title: string) =>
  Object.entries(roleFamilies).find(([, re]) => re.test(title))?.[0] || 'other';

const skillWords = [
  'Python',
  'SQL',
  'PostgreSQL',
  'JavaScript',
  'TypeScript',
  'React',
  'Node.js',
  'Java',
  'C#',
  'Go',
  'AWS',
  'Azure',
  'GCP',
  'Docker',
  'Kubernetes',
  'Power BI',
  'Tableau',
  'Excel',
  'R',
  'pandas',
  'Spark',
  'dbt',
  'Machine learning',
  'Statistics',
  'Git',
  'Linux',
  'Testing',
  'CI/CD',
  'Stakeholder communication',
  'Data visualisation',
];

type Listing = { job: any; country: string; requirements?: string[] };

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
};

async function listingsFor(userId: string) {
  const mode = configuredMode();
  const out = new Map<string, Listing>();
  const add = (job: any, country: string, requirements?: string[]) => {
    if (!job?.title) return;
    const key = jobFingerprint(job);
    const prev = out.get(key);
    if (!prev || (!prev.requirements?.length && requirements?.length))
      out.set(key, { job, country, requirements: requirements || prev?.requirements });
  };
  for (const m of await db.mission.findMany({ where: { userId, mode }, select: { data: true } })) {
    const d = m.data as MissionData;
    const country = d.jobSearch?.country || 'au';
    for (const r of d.matches || [])
      add(r.job, country, [
        ...(r.requirements?.required || []),
        ...(r.requirements?.preferred || []),
      ]);
  }
  for (const s of await db.scoutSweep.findMany({
    where: { userId, mode },
    select: { data: true },
  })) {
    const d = s.data as any;
    const country = d.search?.country || 'au';
    for (const r of d.shortlist || [])
      add(r.job, country, [
        ...(r.requirements?.required || []),
        ...(r.requirements?.preferred || []),
      ]);
    for (const j of d.candidates || []) add(j, country);
  }
  return [...out.values()].filter(
    (l) => (mode === 'fixture') === Boolean(buildJobRecord(l.job).fictional),
  );
}

export async function marketInsight(userId: string, country: string, family = 'all') {
  let spec: { code: string; name: string; currency: string };
  try {
    spec = countrySpec(country);
  } catch {
    throw new AppError(422, 'UNSUPPORTED_COUNTRY', 'Choose a supported country.');
  }
  const all = (await listingsFor(userId)).filter((l) => l.country === country);
  const listings = family === 'all' ? all : all.filter((l) => familyOf(l.job.title) === family);
  const groups = new Map<string, Listing[]>();
  for (const l of listings) {
    const city = /\bremote\b/i.test(l.job.location || '')
      ? 'Remote'
      : placeKey(l.job.location || '') || 'Not stated';
    const label =
      city === 'Remote' || city === 'Not stated'
        ? city
        : city.replace(/\b\w/g, (c) => c.toUpperCase());
    groups.set(label, [...(groups.get(label) || []), l]);
  }
  const summarise = (items: Listing[]) => {
    const records = items.map((l) => ({ l, r: buildJobRecord(l.job, spec.currency) }));
    const mids = records
      .map(({ r }) =>
        r.salary?.annualMin && r.salary?.annualMax
          ? (r.salary.annualMin + r.salary.annualMax) / 2
          : r.salary?.annualMin || r.salary?.annualMax,
      )
      .filter((x): x is number => typeof x === 'number' && x > 0);
    const rights = (v: string) => records.filter(({ r }) => r.workRights?.value === v).length;
    const arrangement = (v: string) => records.filter(({ r }) => r.arrangement?.value === v).length;
    const skills = new Map<
      string,
      { count: number; examples: { title: string; company: string }[] }
    >();
    for (const { l } of records) {
      // Only named skills are counted: requirement phrases are read for the skills they name.
      const text = l.requirements?.length ? l.requirements.join('\n') : l.job.description || '';
      const found = new Set<string>(skillWords.filter((w) => mentionsSkill(text, w)));
      for (const skill of found) {
        const e = skills.get(skill) || { count: 0, examples: [] };
        e.count++;
        if (e.examples.length < 2)
          e.examples.push({ title: l.job.title, company: l.job.company || '' });
        skills.set(skill, e);
      }
    }
    return {
      roles: items.length,
      salary: mids.length
        ? {
            currency: spec.currency,
            listings: mids.length,
            low: quantile(mids, 0.25),
            median: quantile(mids, 0.5),
            high: quantile(mids, 0.75),
          }
        : null,
      workRights: {
        sponsorshipAvailable: rights('sponsorship_available'),
        citizenOrPrRequired: rights('citizen_or_pr'),
        noSponsorship: rights('no_sponsorship'),
        notStated: records.filter(({ r }) => !r.workRights).length,
      },
      arrangement: {
        remote: arrangement('remote'),
        hybrid: arrangement('hybrid'),
        onSite: arrangement('on-site'),
      },
      topSkills: [...skills]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([skill, e]) => ({ skill, ...e })),
    };
  };
  return {
    country: spec.code,
    countryName: spec.name,
    family,
    families: ['all', ...Object.keys(roleFamilies), 'other'].map((f) => ({
      id: f,
      roles: f === 'all' ? all.length : all.filter((l) => familyOf(l.job.title) === f).length,
    })),
    overall: summarise(listings),
    cities: [...groups]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([city, items]) => ({ city, ...summarise(items) })),
    limitations: [
      'Counted only from roles your own searches and Scout sweeps found in this provider mode; it is a sample, not the whole market.',
      'Salaries come from listings that state one, converted to a yearly figure with the stated assumptions.',
      'Work-rights and arrangement counts include only listings that state them.',
    ],
  };
}

export function registerInsights(app: Express) {
  app.get('/api/insights', async (req, res) => {
    const q = z
      .object({
        country: z
          .string()
          .regex(/^[a-z]{2}$/)
          .default('au'),
        family: z.string().max(20).default('all'),
      })
      .parse(req.query);
    res.json(await marketInsight(req.actor!.id, q.country, q.family));
  });
}
