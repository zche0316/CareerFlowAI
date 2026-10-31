import React, { useState } from 'react';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import { experienceOverview } from '../../../packages/contracts/src/experience-view.js';
import {
  recordKeys,
  type ProfileRecord,
  type RecordKey,
} from '../../../packages/contracts/src/profile-records.js';
const labels = {
  workExperiences: 'Work experience',
  projects: 'Projects',
  educations: 'Education records',
};
export function ProfileRecords({
  form,
  onChange,
  errors,
}: {
  form: CareerProfile;
  onChange: (key: keyof CareerProfile, value: any) => void;
  errors: Record<string, string[]>;
}) {
  const [technologyInputs, setTechnologyInputs] = useState<Record<string, string>>({});
  const update = (key: RecordKey, id: string, patch: Partial<ProfileRecord>) =>
    onChange(
      key,
      (form[key] || []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  return (
    <section className="structured-profile wide">
      <h3>Experience, projects and education</h3>
      <p className="small muted">
        Add separate records with month and year dates. Only list your own contributions.
        Overlapping jobs and projects are not added together as employment years.
      </p>
      {recordKeys.map((key) => (
        <section key={key} className="record-section">
          <h4>{labels[key]}</h4>
          {(form[key] || []).map((r, index) => (
            <fieldset className="profile-record" key={r.id}>
              <legend>
                {labels[key]} {index + 1}
              </legend>
              <div className="form-grid">
                {(['title', 'organisation', 'location'] as const).map((field) => (
                  <label key={field}>
                    {field === 'title'
                      ? key === 'educations'
                        ? 'Degree / qualification'
                        : key === 'projects'
                          ? 'Project name / role'
                          : 'Position title'
                      : field === 'organisation'
                        ? key === 'educations'
                          ? 'Institution'
                          : 'Organisation / company'
                        : 'Location'}
                    <input
                      aria-label={`${labels[key]} ${index + 1} ${field}`}
                      value={r[field]}
                      maxLength={field === 'location' ? 120 : 200}
                      onChange={(e) => update(key, r.id, { [field]: e.target.value })}
                    />
                  </label>
                ))}
                <label>
                  Start month
                  <input
                    aria-label={`${labels[key]} ${index + 1} start month`}
                    type="month"
                    value={r.startMonth || ''}
                    onChange={(e) => update(key, r.id, { startMonth: e.target.value || null })}
                  />
                </label>
                {key === 'educations' && (
                  <>
                    <label>
                      Major / Specialisation (optional)
                      <input
                        aria-label={`Education records ${index + 1} major`}
                        value={r.major || ''}
                        maxLength={200}
                        onChange={(e) => update(key, r.id, { major: e.target.value })}
                      />
                    </label>
                    <label>
                      Relevant coursework (optional, one per line)
                      <textarea
                        aria-label={`Education records ${index + 1} relevant coursework`}
                        value={(r.relevantCoursework || []).join('\n')}
                        onChange={(e) =>
                          update(key, r.id, {
                            relevantCoursework: e.target.value.split('\n').slice(0, 20),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  {key === 'educations' ? 'Completion month' : 'End month'}
                  <input
                    aria-label={`${labels[key]} ${index + 1} end month`}
                    type="month"
                    disabled={r.current}
                    value={r.endMonth || ''}
                    onChange={(e) => update(key, r.id, { endMonth: e.target.value || null })}
                  />
                </label>
                {key === 'educations' && (
                  <label>
                    Expected completion month
                    <input
                      aria-label={`Education records ${index + 1} expected completion month`}
                      type="month"
                      value={r.expectedEndMonth || ''}
                      onChange={(e) =>
                        update(key, r.id, { expectedEndMonth: e.target.value || null })
                      }
                    />
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={r.current}
                    onChange={(e) =>
                      update(key, r.id, {
                        current: e.target.checked,
                        endMonth: e.target.checked ? null : r.endMonth,
                      })
                    }
                  />
                  Current / Present
                </label>
                <label className="wide">
                  {key === 'educations'
                    ? 'Academic notes / achievements (optional, one per line)'
                    : 'Experience overview · responsibilities, tools and scope'}
                  <textarea
                    aria-label={`${labels[key]} ${index + 1} details`}
                    value={key === 'educations' ? r.details.join('\n') : experienceOverview(r)}
                    onChange={(e) =>
                      update(
                        key,
                        r.id,
                        key === 'educations'
                          ? { details: e.target.value.split('\n') }
                          : {
                              overview: e.target.value,
                              details: [
                                e.target.value,
                                ...Object.values(r.starStory || {}).filter(Boolean),
                              ],
                              organisedStory: undefined,
                            },
                      )
                    }
                  />
                </label>
                {key !== 'educations' && (
                  <details className="wide">
                    <summary>Personal STAR example (optional)</summary>
                    {(['situation', 'task', 'action', 'result'] as const).map((part) => (
                      <label key={part}>
                        {part[0].toUpperCase() + part.slice(1)}
                        <textarea
                          aria-label={`${labels[key]} ${index + 1} STAR ${part}`}
                          value={r.starStory?.[part] || ''}
                          onChange={(e) => {
                            const story = {
                              situation: '',
                              task: '',
                              action: '',
                              result: '',
                              ...r.starStory,
                              [part]: e.target.value,
                            };
                            update(key, r.id, {
                              starStory: story,
                              details: [
                                experienceOverview(r),
                                ...Object.values(story).filter(Boolean),
                              ],
                              organisedStory: undefined,
                            });
                          }}
                        />
                      </label>
                    ))}
                  </details>
                )}
                <label>
                  Technologies · comma separated
                  <input
                    aria-label={`${labels[key]} ${index + 1} technologies`}
                    value={technologyInputs[r.id] ?? r.technologies.join(', ')}
                    onChange={(e) => {
                      setTechnologyInputs((current) => ({ ...current, [r.id]: e.target.value }));
                      update(key, r.id, {
                        technologies: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                </label>
                <label>
                  Public link
                  <input
                    aria-label={`${labels[key]} ${index + 1} link`}
                    type="url"
                    value={r.url}
                    onChange={(e) => update(key, r.id, { url: e.target.value })}
                  />
                </label>
              </div>
              {r.evidence?.map((e, i) => (
                <details key={i}>
                  <summary>Original import evidence · page {e.page}</summary>
                  <blockquote>{e.quote}</blockquote>
                  <p className="small muted">
                    Source {e.importId}. Check this original excerpt against any edits before
                    approval.
                  </p>
                </details>
              ))}
              <div className="form-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={index === 0}
                  onClick={() => {
                    const list = [...(form[key] || [])];
                    [list[index - 1], list[index]] = [list[index], list[index - 1]];
                    onChange(key, list);
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={index === (form[key]?.length || 0) - 1}
                  onClick={() => {
                    const list = [...(form[key] || [])];
                    [list[index + 1], list[index]] = [list[index], list[index + 1]];
                    onChange(key, list);
                  }}
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    onChange(
                      key,
                      (form[key] || []).filter((x) => x.id !== r.id),
                    )
                  }
                >
                  Remove {labels[key]} {index + 1}
                </button>
              </div>
            </fieldset>
          ))}
          {Object.entries(errors)
            .filter(([path]) => path === key || path.startsWith(key + '.'))
            .flatMap(([path, messages]) =>
              messages.map((message) => (
                <p role="alert" className="field-error" key={path + message}>
                  {path}: {message}
                </p>
              )),
            )}
          <button
            type="button"
            className="secondary"
            disabled={(form[key]?.length || 0) >= (key === 'educations' ? 10 : 20)}
            onClick={() =>
              onChange(key, [
                ...(form[key] || []),
                {
                  id: crypto.randomUUID(),
                  title: '',
                  organisation: '',
                  location: '',
                  startMonth: null,
                  endMonth: null,
                  current: false,
                  details: [],
                  technologies: [],
                  url: '',
                  evidence: [],
                },
              ])
            }
          >
            Add {labels[key]}
          </button>
        </section>
      ))}
      <details>
        <summary>Contact details and Australian work rights · optional</summary>
        <p className="small muted">
          Only enter work rights you can confirm. A photo, birth date and nationality are not
          needed.
        </p>
        <div className="form-grid">
          {(['email', 'phone', 'city', 'linkedin', 'portfolio', 'workRights'] as const).map(
            (key) => (
              <label key={key}>
                {key === 'workRights' ? 'Australian work rights' : key}
                <input
                  aria-label={`Contact ${key}`}
                  value={form.contact?.[key] || ''}
                  onChange={(e) =>
                    onChange('contact', {
                      email: '',
                      phone: '',
                      city: '',
                      linkedin: '',
                      portfolio: '',
                      workRights: '',
                      ...form.contact,
                      [key]: e.target.value,
                    })
                  }
                />
              </label>
            ),
          )}
        </div>
      </details>
    </section>
  );
}
