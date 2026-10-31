import React, { useState } from 'react';
import { ApplicationReadiness } from './application-readiness.js';
import { countries } from '../../../packages/recruitment/src/geography.js';
export const defaultJobSearch = {
  provider: 'auto',
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
  tavilyConfigured,
  tavilyAccessMode,
}: {
  value: typeof defaultJobSearch;
  adzunaConfigured?: boolean;
  tavilyConfigured?: boolean;
  tavilyAccessMode?: string;
  onChange: (v: typeof defaultJobSearch) => void;
}) {
  const update = (p: Partial<typeof defaultJobSearch>) => onChange({ ...value, ...p });
  return (
    <section>
      <h3>Job source and location</h3>
      <p className="small muted">
        {value.provider === 'fixtures'
          ? 'Offline demo listings are selected explicitly.'
          : value.provider === 'manual'
            ? 'Use the listing you provide below.'
            : 'Searches connected job sources, not the entire job market.'}
      </p>
      <details>
        <summary>Advanced source options</summary>
        <label>
          Job source
          <select
            aria-label="Job source"
            value={value.provider}
            onChange={(e) => update({ provider: e.target.value })}
          >
            <option value="auto">Automatic · all available sources</option>
            <option value="employers">Official employer boards · multiple companies</option>
            <option value="greenhouse">Live company careers (Greenhouse)</option>
            <option value="tavily">Tavily discovery · verified public job boards</option>
            <option value="adzuna">Live country-wide search (Adzuna credentials required)</option>
            <option value="manual">SEEK / Indeed · paste a listing</option>
            <option value="fixtures">Fictional demo jobs (explicit offline choice)</option>
          </select>
        </label>
      </details>
      {value.provider === 'tavily' && (
        <p role="status" className="info">
          {tavilyConfigured
            ? `Tavily ${tavilyAccessMode === 'keyless' ? 'limited keyless access' : 'API access'}: one basic search, up to five links. Only postings confirmed through official Greenhouse, Lever or Ashby APIs are matched.`
            : 'Tavily is not configured. Set TAVILY_API_KEY on the server, or explicitly choose limited TAVILY_ACCESS_MODE=keyless, then restart.'}
        </p>
      )}
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
      <details className="source-help">
        <summary>About job sources</summary>
        <p>
          Jobs are retrieved when the mission reaches matching. Source failures are reported; sample
          jobs are never substituted. Availability and location must be checked on the original
          listing.
        </p>
      </details>
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
      <ApplicationReadiness key={mission.id} missionId={mission.id} api={request} />
      <p>
        Check your approved resume and destination. You submit the application on the employer’s
        site.
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
          <details>
            <summary>Preview attached resume</summary>
            <pre>{packet.resumeText}</pre>
          </details>
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
      {['greenhouse', 'lever', 'ashby'].includes(job.source?.provider) && (
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
