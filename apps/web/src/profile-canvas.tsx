import React from 'react';
import { sameProfileField } from '../../../packages/contracts/src/profile-comparison.js';
import { Check, CheckCheck, FilePenLine, ArrowRight, X } from 'lucide-react';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import { storyFingerprint } from '../../../packages/contracts/src/profile-records.js';
import { experienceOverview } from '../../../packages/contracts/src/experience-view.js';

export const profileFieldLabels: Record<string, string> = {
  name: 'Name',
  goals: 'Career direction',
  location: 'Location',
  careerStage: 'Career stage',
  contact: 'Contact',
  skills: 'Skills',
  interests: 'Career interests',
  education: 'Education',
  educations: 'Education',
  experience: 'Experience',
  workExperiences: 'Work experience',
  projects: 'Projects & other experience',
  experienceYears: 'Years of experience',
  employmentType: 'Employment preference',
  workArrangement: 'Work arrangement',
  companySize: 'Company size',
  industry: 'Industry',
  startDate: 'Start date',
  endDate: 'End date',
  salaryMin: 'Minimum salary',
  salaryMax: 'Maximum salary',
  currency: 'Currency',
  sharing: 'Sharing permissions',
  email: 'Email',
  phone: 'Phone',
  city: 'City',
  linkedin: 'LinkedIn',
  portfolio: 'Portfolio',
  workRights: 'Work rights',
};
export type ProfileProposal = {
  id: string;
  field: keyof CareerProfile;
  before: any;
  after: any;
  evidence: { quote: string }[];
};
const present = (value: any) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  (!Array.isArray(value) || value.length > 0);

function FieldValue({ value }: { value: any }) {
  if (!present(value)) return <p className="profile-placeholder">Not added yet</p>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string'))
      return (
        <ul className="profile-token-list">
          {value.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      );
    return (
      <div className="profile-record-preview">
        {value.map((r: any) => {
          const story =
            r.organisedStory?.sourceHash === storyFingerprint(r.details || [])
              ? r.organisedStory
              : undefined;
          return (
            <article key={r.id}>
              <h4>{r.title}</h4>
              <p className="profile-record-meta">
                {[
                  r.organisation,
                  r.location,
                  [r.startMonth, r.current ? 'Present' : r.endMonth].filter(Boolean).join(' – '),
                  r.expectedEndMonth ? `Expected completion: ${r.expectedEndMonth}` : '',
                  r.major ? `Major: ${r.major}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {!!r.relevantCoursework?.length && (
                <p>Relevant coursework: {r.relevantCoursework.join(', ')}</p>
              )}
              {!!experienceOverview(r) && (
                <p className="profile-experience-overview">{experienceOverview(r)}</p>
              )}
              {r.starStory && Object.values(r.starStory).some(Boolean) && (
                <details className="profile-star-story" aria-label="Example from this experience">
                  <summary>Personal STAR example</summary>
                  <dl>
                    {(['situation', 'task', 'action', 'result'] as const)
                      .filter((key) => r.starStory[key])
                      .map((key) => (
                        <div key={key}>
                          <dt>{key[0].toUpperCase() + key.slice(1)}</dt>
                          <dd>{r.starStory[key]}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
              )}
              {!!r.details?.length && (
                <details className="profile-source-notes">
                  <summary>Source notes</summary>
                  {story?.groups?.length ? (
                    story.groups.map((g: any) => (
                      <div key={g.category}>
                        <strong className="profile-story-label">
                          {g.category.replaceAll('_', ' ')}
                        </strong>
                        <ul>
                          {g.items.map((item: any, i: number) => (
                            <li key={i}>{item.text}</li>
                          ))}
                        </ul>
                      </div>
                    ))
                  ) : (
                    <p>{r.details.join(' ')}</p>
                  )}
                </details>
              )}
              {!!r.technologies?.length && (
                <p className="profile-record-meta">{r.technologies.join(' · ')}</p>
              )}
            </article>
          );
        })}
      </div>
    );
  }
  if (typeof value === 'object')
    return (
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{profileFieldLabels[k] || k}</dt>
            <dd>{typeof v === 'boolean' ? (v ? 'Allowed' : 'Not shared') : String(v ?? '')}</dd>
          </div>
        ))}
      </dl>
    );
  return <p>{String(value)}</p>;
}

// Record arrays are one versioned field; show only the records changed by that proposal.
function changedValues(before: any, after: any) {
  if (
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    ![...before, ...after].some((r) => r && typeof r === 'object' && r.id)
  )
    return [before, after];
  const changed = (records: any[], other: any[]) =>
    records.filter(
      (r) =>
        !sameProfileField(
          r,
          other.find((o) => o.id === r.id),
        ),
    );
  return [changed(before, after), changed(after, before)];
}

export function ProfileCanvas({
  data,
  proposals,
  busy,
  error,
  applied,
  approved,
  onDecision,
  onApplyAll,
}: {
  data: CareerProfile;
  proposals: ProfileProposal[];
  busy: boolean;
  error: string;
  applied: Record<string, { value: any; stamp: number }>;
  approved: boolean;
  onDecision: (p: ProfileProposal, decision: 'apply' | 'reject') => void;
  onApplyAll: () => void;
}) {
  const primary: (keyof CareerProfile)[] = [
    'name',
    'goals',
    'location',
    'careerStage',
    'contact',
    'skills',
    'interests',
    ...(data.educations?.length ? ['educations' as const] : ['education' as const]),
    ...(data.workExperiences?.length || data.projects?.length ? [] : ['experience' as const]),
    'workExperiences',
    'projects',
  ];
  const keys = [
    ...new Set([
      ...primary,
      ...proposals.map((p) => p.field),
      ...Object.keys(data).filter(
        (k) =>
          !primary.includes(k as keyof CareerProfile) &&
          k !== 'sharing' &&
          !!profileFieldLabels[k] &&
          present(data[k as keyof CareerProfile]),
      ),
    ]),
  ] as (keyof CareerProfile)[];
  return (
    <div className="profile-canvas">
      <div className="profile-canvas-toolbar">
        <span>
          <FilePenLine size={16} /> Live profile preview
        </span>
        <span role="status" aria-live="polite">
          {proposals.length
            ? `${proposals.length} suggested change${proposals.length === 1 ? '' : 's'}`
            : approved
              ? 'All changes saved'
              : 'Your working draft'}
        </span>
      </div>
      {!!proposals.length && (
        <div className="profile-change-summary">
          <p>Review the highlighted changes below.</p>
          <button
            className="secondary"
            disabled={busy || proposals.some((p) => !sameProfileField(data[p.field], p.before))}
            onClick={onApplyAll}
          >
            <CheckCheck size={15} />
            Use these details in my draft
          </button>
          <nav className="profile-change-jumps" aria-label="Suggested blocks">
            {proposals.map((p) => (
              <a key={p.id} href={`#profile-change-${p.field}`}>
                {profileFieldLabels[p.field] || p.field}
                <ArrowRight size={12} />
              </a>
            ))}
          </nav>
        </div>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="profile-document" aria-label="Profile document">
        {keys.map((field) => {
          const pending = proposals.filter((p) => p.field === field);
          const appliedState = applied[field];
          const justApplied =
            !approved && appliedState && sameProfileField(data[field], appliedState.value);
          const showEmpty = ['name', 'goals', 'skills', 'education'].includes(field);
          if (!showEmpty && !present(data[field]) && !pending.length) return null;
          return (
            <section
              className={`profile-document-block ${pending.length ? 'has-suggestion' : ''} ${justApplied ? 'is-applied' : ''}`}
              key={`${field}-${pending.map((p) => p.id).join('-') || (justApplied ? appliedState.stamp : 'current')}`}
              id={`profile-change-${field}`}
              data-field={field}
              aria-label={`${profileFieldLabels[field] || field} block`}
            >
              <div className="profile-block-heading">
                <h3>{profileFieldLabels[field] || field}</h3>
                {justApplied && (
                  <span className="profile-change-label">
                    <Check size={14} />
                    Added to draft
                  </span>
                )}
              </div>
              {pending.length ? (
                pending.map((p) => {
                  const [before, after] = changedValues(p.before, p.after);
                  const stale = !sameProfileField(data[field], p.before);
                  return (
                    <div className="profile-inline-change" key={p.id}>
                      <span className="profile-change-label">Suggested change</span>
                      <div className="profile-diff-before">
                        <span className="profile-diff-label">
                          {stale ? 'Your current edit' : 'Before'}
                        </span>
                        <FieldValue value={stale ? data[field] : before} />
                      </div>
                      <div className="profile-diff-after">
                        <span className="profile-diff-label">
                          <ArrowRight size={13} />
                          Suggested
                        </span>
                        <FieldValue value={after} />
                      </div>
                      {stale && (
                        <p className="profile-conflict" role="status">
                          You edited this block. Keep your edit or ask for a fresh suggestion.
                        </p>
                      )}
                      <div className="profile-block-actions">
                        <button
                          className="primary"
                          disabled={busy || stale}
                          onClick={() => onDecision(p, 'apply')}
                          aria-label={`Accept ${profileFieldLabels[field] || field} change`}
                        >
                          <Check size={15} />
                          Accept change
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => onDecision(p, 'reject')}
                          aria-label={`Keep current ${profileFieldLabels[field] || field}`}
                        >
                          <X size={14} />
                          Keep current
                        </button>
                      </div>
                      {!!p.evidence?.length && (
                        <details className="profile-change-source">
                          <summary>Source from your conversation</summary>
                          {p.evidence.map((e, i) => (
                            <blockquote key={i}>{e.quote}</blockquote>
                          ))}
                        </details>
                      )}
                    </div>
                  );
                })
              ) : (
                <FieldValue value={data[field]} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
