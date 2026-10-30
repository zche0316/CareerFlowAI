import React from 'react';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import {
  hasCareerContent,
  storyFingerprint,
} from '../../../packages/contracts/src/profile-records.js';

const labels: Record<string, string> = {
  background: 'Background',
  responsibility: 'Personal responsibility',
  action: 'Personal actions',
  result: 'Outcomes (individual or team as stated)',
  reflection: 'Learning & reflection',
  other: 'Additional context',
};
// A source statement is selectable evidence, not a separate employment record.
export function ProfileSummary({ data }: { data: CareerProfile }) {
  const groups = [
    ['educations', 'Education'],
    ['workExperiences', 'Work experience'],
    ['projects', 'Projects & other experience'],
  ] as const;
  return (
    <div className="profile-summary">
      <p>
        <strong>{data.name || 'Name to add'}</strong>
      </p>
      <p>{data.goals || 'Career direction to explore'}</p>
      {!!data.location && (
        <p>{[data.location, data.workArrangement].filter(Boolean).join(' · ')}</p>
      )}
      {!!data.skills.length && (
        <p>
          <strong>Skills:</strong> {data.skills.join(', ')}
        </p>
      )}
      {groups.map(([key, label]) => (
        <section key={key} aria-label={label}>
          <h3>{label}</h3>
          {(data[key] || []).map((r) => {
            const story =
              r.organisedStory?.sourceHash === storyFingerprint(r.details)
                ? r.organisedStory
                : undefined;
            return (
              <article className="career-record-card" key={r.id}>
                <h4>{r.title}</h4>
                <p className="muted">
                  {[
                    r.organisation,
                    r.location,
                    r.startMonth || r.endMonth || r.current
                      ? `${r.startMonth || 'Start date unknown'} – ${r.current ? 'Present' : r.endMonth || 'End date unknown'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {!!story?.groups.length &&
                  story.groups.map(
                    (group) =>
                      group.items.length > 0 && (
                        <section key={group.category} aria-label={labels[group.category]}>
                          <h5>{labels[group.category]}</h5>
                          <ul>
                            {group.items.map((item, i) => (
                              <li key={i}>{item.text}</li>
                            ))}
                          </ul>
                        </section>
                      ),
                  )}
                {!!r.details.length && !story && (
                  <ul>
                    {r.details.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {!!story && (
                  <details>
                    <summary>Original answers & supporting evidence</summary>
                    <ul>
                      {r.details.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!r.technologies.length && (
                  <p className="small">Technologies: {r.technologies.join(', ')}</p>
                )}
                {!r.details.length && key !== 'educations' && (
                  <p className="muted">Your contribution is still to be explored.</p>
                )}
              </article>
            );
          })}
          {!data[key]?.length && key === 'educations' && hasCareerContent(data.education) && (
            <p>{data.education}</p>
          )}
          {!data[key]?.length &&
            key === 'workExperiences' &&
            !data.projects?.length &&
            hasCareerContent(data.experience) && <p>{data.experience}</p>}
          {!data[key]?.length && (
            <p className="small muted">
              {(key === 'educations' && hasCareerContent(data.education)) ||
              (key === 'workExperiences' &&
                !data.projects?.length &&
                hasCareerContent(data.experience))
                ? ''
                : 'No records added. You can continue the conversation.'}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

// A small overview while chatting; the complete snapshot is shown before approval.
export function ProfileOverview({ data }: { data: CareerProfile }) {
  const groups = [
    ['educations', 'Education'],
    ['workExperiences', 'Work experience'],
    ['projects', 'Projects'],
  ] as const;
  const records = groups.flatMap(([key]) => data[key] || []);
  const legacyEducation = hasCareerContent(data.education);
  const legacyExperience = hasCareerContent(data.experience);
  const hasBackground = records.length > 0 || legacyEducation || legacyExperience;
  return (
    <div className="profile-overview">
      <div className="profile-identity">
        <span className="profile-monogram" aria-hidden="true">
          {data.name?.trim().charAt(0).toUpperCase() || '↗'}
        </span>
        <div>
          <h3>{data.name || 'Your story starts here'}</h3>
          <p className="muted">{data.location || 'Add a few details in the conversation.'}</p>
        </div>
      </div>
      {data.goals && <p className="profile-goal">{data.goals}</p>}
      {!!data.skills.length && (
        <div className="profile-skill-list" aria-label="Skills">
          {data.skills.slice(0, 4).map((skill, i) => (
            <span key={i}>{skill}</span>
          ))}
          {data.skills.length > 4 && <span>+{data.skills.length - 4} more</span>}
        </div>
      )}
      {hasBackground && (
        <dl className="profile-record-counts">
          {groups.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {data[key]?.length ||
                  (key === 'educations' && legacyEducation
                    ? 'Added'
                    : key === 'workExperiences' && !data.projects?.length && legacyExperience
                      ? 'Added'
                      : '—')}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!hasBackground && (
        <p className="profile-empty-note">
          Your education and experiences will appear here as you add them.
        </p>
      )}
    </div>
  );
}
