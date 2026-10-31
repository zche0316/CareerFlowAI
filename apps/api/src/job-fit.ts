import type { Express } from 'express';
import { ownedMission } from './domain.js';
import { AppError } from './errors.js';

/** Literal overlap is an aid to review, never evidence of proficiency or an ATS verdict. */
export function jobFitEvidence(selection: any, facts: any[]) {
  const job = selection?.job;
  if (!job || typeof job.description !== 'string')
    throw new AppError(409, 'JOB_NOT_SELECTED', 'Select a job before reviewing its fit.');
  const snapshotTerms = Array.isArray(selection.requirements?.required)
    ? [
        ...new Set<string>(
          selection.requirements.required.filter(
            (x: unknown): x is string => typeof x === 'string' && !!x.trim(),
          ),
        ),
      ].slice(0, 40)
    : [];
  const lines = job.description
    .split(/\n|(?<=[.!?])\s+/)
    .map((line: string) => line.trim())
    .filter(Boolean);
  const contains = (text: string, term: string) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(text);
  };
  // Older matching snapshots may only contain technology terms. Review additional
  // business requirements only when their literal wording is present in the listing.
  const reviewTerms = [
    'workday',
    'general ledger',
    'financial controls',
    'reconciliation',
    'reconciliations',
    'user acceptance testing',
    'uat',
    'requirements gathering',
    'stakeholder management',
    'process improvement',
    'business requirements',
  ];
  const additional = reviewTerms.filter(
    (term) =>
      contains(job.description, term) &&
      !snapshotTerms.some((existing) => existing.toLowerCase() === term),
  );
  const terms = [...snapshotTerms, ...additional];
  const items = terms.flatMap((term) => {
    // Never present a computed requirement without a verifiable passage from the job.
    const excerpt = lines.find((line: string) => contains(line, term));
    if (!excerpt) return [];
    const evidence = facts
      .filter(
        (f) =>
          ['skill', 'experience', 'education'].includes(f.kind) &&
          typeof f.text === 'string' &&
          contains(f.text, term),
      )
      .slice(0, 4)
      .map((f) => ({ id: f.id, text: f.text, kind: f.kind }));
    return [{ term, excerpt, evidence, state: evidence.length ? 'evidence_found' : 'not_found' }];
  });
  return {
    job: {
      title: job.title,
      company: job.company,
      sourceUrl: /^https?:\/\//i.test(job.applicationUrl || '') ? job.applicationUrl : null,
    },
    interpretation: selection.requirements?.inferred || additional.length ? 'mentioned' : 'stated',
    items,
    notice:
      'Exact word matches only. Missing evidence is not proof of a missing skill; check the original listing and your profile.',
  };
}

export function registerJobFit(app: Express) {
  app.get('/api/missions/:id/job-fit', async (req, res) => {
    const mission = await ownedMission(req.actor!.id, String(req.params.id));
    const result = jobFitEvidence(
      (mission.data as any).selectedJob,
      mission.profile.facts as any[],
    );
    res.json({ ...result, profileVersion: mission.profile.version });
  });
}
