import React, { useState } from 'react';
import { countries } from '../../../packages/recruitment/src/geography.js';
export const defaultJobSearch = {
  provider: 'employers',
  board: 'spaceship',
  country: 'au',
  region: '',
  location: '',
  keyword: '',
  listing: { url: '', title: '', company: '', location: '', description: '' },
};
export function JobSearchFields({
  value,
  onChange,
  adzunaConfigured,
}: {
  value: typeof defaultJobSearch;
  adzunaConfigured?: boolean;
  onChange: (v: typeof defaultJobSearch) => void;
}) {
  const update = (p: Partial<typeof defaultJobSearch>) => onChange({ ...value, ...p });
  return (
    <section>
      <h3>Job source and location</h3>
      <label>
        Job source
        <select
          aria-label="Job source"
          value={value.provider}
          onChange={(e) => update({ provider: e.target.value })}
        >
          <option value="employers">Official employer boards · multiple companies</option>
          <option value="greenhouse">Live company careers (Greenhouse)</option>
          <option value="adzuna">Live country-wide search (Adzuna credentials required)</option>
          <option value="manual">SEEK / Indeed · paste a listing</option>
          <option value="fixtures">Fictional demo jobs (explicit offline choice)</option>
        </select>
      </label>
      {value.provider === 'adzuna' && (
        <p role="status" className="info">
          {adzunaConfigured
            ? 'Adzuna search is configured. Only search terms and location are sent.'
            : 'Adzuna is not configured. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to the server .env and restart. Groq credentials cannot be used. No sample jobs will be substituted.'}
        </p>
      )}
      {value.provider === 'manual' && (
        <div className="grid-2">
          {(['url', 'title', 'company', 'location', 'description'] as const).map((key) => (
            <label key={key}>
              Listing {key}
              {key === 'description' ? (
                <textarea
                  value={value.listing[key]}
                  onChange={(e) => update({ listing: { ...value.listing, [key]: e.target.value } })}
                />
              ) : (
                <input
                  value={value.listing[key]}
                  onChange={(e) => update({ listing: { ...value.listing, [key]: e.target.value } })}
                />
              )}
            </label>
          ))}
          <p>
            User-pasted content, not API-retrieved or verified. No SEEK/Indeed account access or
            automated submission.
          </p>
        </div>
      )}
      {value.provider !== 'fixtures' && value.provider !== 'manual' && (
        <div className="grid-2">
          {value.provider === 'greenhouse' && (
            <label>
              Company board token
              <input value={value.board} onChange={(e) => update({ board: e.target.value })} />
              <small>One company board, not every employer in the country.</small>
            </label>
          )}
          <label>
            Job country
            <select
              aria-label="Job country"
              value={value.country}
              onChange={(e) => update({ country: e.target.value, region: '', location: '' })}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            State / region
            <select
              aria-label="Job region"
              value={value.region}
              onChange={(e) => update({ region: e.target.value, location: '' })}
            >
              <option value="">All regions in selected country</option>
              {countries
                .find((c) => c.code === value.country)
                ?.regions.map((r) => (
                  <option key={r[0]}>{r[0]}</option>
                ))}
            </select>
          </label>
          <label>
            City / locality
            <input value={value.location} onChange={(e) => update({ location: e.target.value })} />
          </label>
          <label>
            Job keywords
            <input value={value.keyword} onChange={(e) => update({ keyword: e.target.value })} />
          </label>
        </div>
      )}
      <p className="small muted">
        Jobs are fetched during the matching step. No fixture fallback after API errors. Unknown
        global-remote locations are excluded when country eligibility is unclear. Adzuna needs
        separate server credentials.
      </p>
    </section>
  );
}
export function ApplicationPanel({
  mission,
  request,
  onRecord,
}: {
  mission: any;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onRecord: (body: unknown) => Promise<void>;
}) {
  const [packet, P] = useState<any>(null),
    [error, E] = useState(''),
    [confirmed, C] = useState(false),
    [reference, R] = useState(''),
    [busy, B] = useState(false);
  const load = async () => {
    E('');
    B(true);
    try {
      P(await request(`/missions/${mission.id}/application`));
      C(false);
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  };
  return (
    <section className="panel">
      <h2>Prepare your real application</h2>
      <p>
        Review the exact approved resume and official destination before continuing. SEEK/Indeed
        direct auto-submit is unavailable without platform partner authorization.
      </p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Review application package
      </button>
      {error && <p role="alert">{error}</p>}
      {packet && (
        <>
          <h3>
            {packet.company} · {packet.title}
          </h3>
          <p>{packet.destination}</p>
          <pre>{packet.resumeText}</pre>
          <p>{packet.notice}</p>
          <div className="mission-actions">
            <a className="secondary" href={`/api/resumes/${packet.approvedResumeId}/download`}>
              Download approved resume
            </a>
            <a
              href={packet.destination}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                void onRecord({
                  status: 'opened_official_site',
                  contextHash: packet.contextHash,
                  reference: '',
                })
              }
            >
              Open official application ↗
            </a>
          </div>
          <label>
            Optional receipt reference
            <input value={reference} onChange={(e) => R(e.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(e) => C(e.target.checked)} />I
            personally completed and submitted this application on the official site.
          </label>
          <button
            className="primary"
            disabled={!confirmed || busy}
            onClick={async () => {
              B(true);
              try {
                await onRecord({
                  status: 'submitted_self_reported',
                  contextHash: packet.contextHash,
                  reference,
                  confirmed: true,
                });
                C(false);
              } finally {
                B(false);
              }
            }}
          >
            Record my completed submission
          </button>
        </>
      )}
      {mission.data.applicationHistory?.map((h: any) => (
        <p key={h.id}>
          {h.at} · {h.status} · {h.verification}
        </p>
      ))}
    </section>
  );
}

export function JobSourceActions({
  job,
  missionId,
  request,
}: {
  job: any;
  missionId: string;
  request: (p: string) => Promise<any>;
}) {
  const [availability, A] = useState(job.availability),
    [busy, B] = useState(false),
    [error, E] = useState('');
  const check = async () => {
    B(true);
    E('');
    try {
      A(await request(`/missions/${missionId}/jobs/${encodeURIComponent(job.id)}/availability`));
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  };
  if (!job.applicationUrl) return null;
  return (
    <div className="job-source-actions">
      <p className="small">
        {job.source?.externalListing
          ? 'User-pasted listing · unverified'
          : 'Source: ' + job.source.name + ' · ' + job.company}
        <br />
        Retrieved:{' '}
        {job.source?.fetchedAt ? new Date(job.source.fetchedAt).toLocaleString() : 'Not recorded'}
      </p>
      {availability && (
        <p className="small" role="status">
          {availability.status === 'closed_or_removed'
            ? 'Closed or removed from official source'
            : availability.status === 'published_at_check'
              ? 'Published on official API at last check'
              : availability.status === 'published_at_retrieval'
                ? 'Published when retrieved'
                : availability.status === 'listed_at_retrieval'
                  ? 'Listed by recruitment provider at retrieval'
                  : 'Availability unverified'}{' '}
          · {new Date(availability.checkedAt).toLocaleString()}
        </p>
      )}
      {job.source?.provider === 'greenhouse' && (
        <button className="secondary" disabled={busy} onClick={() => void check()}>
          {busy ? 'Checking official source…' : 'Recheck availability'}
        </button>
      )}
      {error && <p role="alert">{error} Previous status is historical; a fresh check failed.</p>}
      {availability?.status !== 'closed_or_removed' && (
        <a
          className="secondary full"
          href={job.applicationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {job.source?.provider === 'adzuna'
            ? 'Open recruitment listing ↗'
            : 'Open official job & application ↗'}
        </a>
      )}
      <p className="small muted">
        Availability may change after checking. Opening a page does not submit an application.
      </p>
    </div>
  );
}
