import { useState } from 'react';
import { estimateText, useEstimates } from './run-estimate.js';
import { ArrowRight, RotateCw } from 'lucide-react';

// The board of roles the user is pursuing. Each card is one quest: a long-lived application that
// keeps every resume and practice run for that role. Runs are the party's work on it.

export const stageCopy: Record<string, { label: string; tone: string; next: string }> = {
  discovered: {
    label: 'New from Scout',
    tone: 'lilac',
    next: 'Scout found this role and scored it. Tailor a resume if it is worth pursuing, or remove it.',
  },
  saved: {
    label: 'Saved',
    tone: 'outline',
    next: 'Saved from a shortlist. Tailor a resume when you are ready.',
  },
  tailoring: {
    label: 'Party at work',
    tone: 'lilac',
    next: 'A run is in progress. Open it to see who has the ball.',
  },
  ready: {
    label: 'Resume ready',
    tone: 'lime',
    next: 'An approved resume is saved. Apply on the employer’s site, then record it here.',
  },
  applied: {
    label: 'Applied',
    tone: 'lime',
    next: 'Waiting to hear back. Practise the interview meanwhile.',
  },
  interview: {
    label: 'Interviewing',
    tone: 'coral',
    next: 'Practise again with your latest resume.',
  },
  offer: {
    label: 'Offer',
    tone: 'lime',
    next: 'Compare the offer with your goals before you reply.',
  },
  rejected: { label: 'Not successful', tone: 'ink', next: 'Kept for your record and the Coach.' },
  closed: { label: 'Closed', tone: 'ink', next: 'Kept for your record.' },
};

/**
 * The stage of a ranked role if it is already on the board. Runs made since the role library
 * carry the role's fingerprint; older shortlists fall back to title and company.
 */
export function boardStage(board: any[] | undefined, match: any): string | null {
  const key = (s = '') =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const found = (board || []).find((a) =>
    match?.fingerprint
      ? a.fingerprint === match.fingerprint
      : key(a.title) === key(match?.job?.title) && key(a.company) === key(match?.job?.company),
  );
  return found ? found.stage : null;
}

const statusOptions = [
  ['discovered', 'New from Scout'],
  ['saved', 'Not applied yet'],
  ['applied', 'Applied'],
  ['interview', 'Interviewing'],
  ['offer', 'Offer'],
  ['rejected', 'Not successful'],
  ['closed', 'Closed'],
];

const groups = [
  { id: 'open', title: 'Getting ready', stages: ['discovered', 'saved', 'tailoring', 'ready'] },
  { id: 'applied', title: 'Applied', stages: ['applied', 'interview', 'offer'] },
  { id: 'closed', title: 'Closed', stages: ['rejected', 'closed'] },
];

function ApplicationCard({
  a,
  busy,
  onOpenRun,
  onTailor,
  onStatus,
  onPractice,
  onRemove,
}: {
  a: any;
  busy: boolean;
  onOpenRun: (missionId: string) => void;
  onTailor: (applicationId: string) => void;
  onStatus: (applicationId: string, status: string) => void;
  onPractice?: (applicationId: string) => void;
  onRemove?: (applicationId: string) => void;
}) {
  const copy = stageCopy[a.stage] || stageCopy.saved;
  const resumes = a.runs.filter((r: any) => r.approvedResumeId).length;
  const latest = a.runs.find((r: any) => r.approvedResumeId) || a.runs[0];
  return (
    <li className="qa-card" data-stage={a.stage}>
      <div className="qa-card-top">
        <div className="ql-card-title">
          <h3>{a.title}</h3>
          <span>{[a.company, a.location].filter(Boolean).join(' · ')}</span>
        </div>
        <span className={`quest-chip ${copy.tone}`}>{copy.label}</span>
      </div>
      <p className="ql-next">{copy.next}</p>
      {a.history?.some((h: any) => h.note === 'Re-advertised') && (
        <span className="quest-chip coral">Re-advertised · seen again after a while</span>
      )}
      {a.levelGaps?.length > 0 && (
        <div className="qa-gaps" aria-label="Level gaps">
          {a.levelGaps.slice(0, 3).map((g: any) => (
            <span key={g.term} className={`quest-chip ${g.level === 'required' ? 'coral' : 'outline'}`}>
              {g.skill} {g.have}→{g.need}
            </span>
          ))}
        </div>
      )}
      <div className="qa-facts">
        {a.score !== null && <span>Match {a.score}</span>}
        <span>
          {resumes} resume{resumes === 1 ? '' : 's'}
        </span>
        <span>
          {a.runs.length} run{a.runs.length === 1 ? '' : 's'}
        </span>
        <span>
          {a.source === 'scout'
            ? 'Found by Scout'
            : a.source === 'link'
              ? 'Pasted link'
              : 'From a search'}
        </span>
      </div>
      <div className="qa-actions">
        <label className="qa-status">
          <span className="sr-only">Status for {a.title}</span>
          <select
            aria-label={`Status for ${a.title}`}
            value={a.status}
            disabled={busy}
            onChange={(e) => onStatus(a.id, e.target.value)}
          >
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {a.activeRunId ? (
          <button
            type="button"
            className="quest-press lime ql-go"
            onClick={() => onOpenRun(a.activeRunId)}
          >
            Open run
            <ArrowRight size={16} strokeWidth={2.6} />
          </button>
        ) : (
          <>
            {latest && (
              <button
                type="button"
                className="quest-press ql-go"
                onClick={() => onOpenRun(latest.id)}
              >
                {resumes ? 'Open resume' : 'Open last run'}
              </button>
            )}
            <button
              type="button"
              className={`quest-press ql-go${resumes ? '' : ' lime'}`}
              disabled={busy}
              onClick={() => onTailor(a.id)}
            >
              {resumes ? (
                <>
                  <RotateCw size={15} strokeWidth={2.6} /> Tailor again
                </>
              ) : (
                <>
                  Tailor resume <ArrowRight size={16} strokeWidth={2.6} />
                </>
              )}
            </button>
            {resumes > 0 && onPractice && (
              <button
                type="button"
                className="quest-press ql-go"
                disabled={busy}
                onClick={() => onPractice(a.id)}
              >
                Practise interview
              </button>
            )}
            {a.runs.length === 0 && onRemove && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => onRemove(a.id)}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function QuestApplications({
  applications,
  busy,
  onOpenRun,
  onTailor,
  onStatus,
  onPractice,
  onRemove,
}: {
  applications: any[];
  busy: boolean;
  onOpenRun: (missionId: string) => void;
  onTailor: (applicationId: string) => void;
  onStatus: (applicationId: string, status: string) => void;
  onPractice?: (applicationId: string) => void;
  onRemove?: (applicationId: string) => void;
}) {
  if (!applications.length)
    return (
      <section className="quest-tile ql-empty qa-empty" aria-labelledby="qa-empty">
        <h2 id="qa-empty">No roles on your board yet</h2>
        <p>
          Find roles, then choose one to tailor a resume or save a few to come back to. Each role
          keeps all of its resumes and practice runs here.
        </p>
      </section>
    );
  return (
    <>
      <TailorEstimate />
      {groups.map((g) => {
        const items = applications.filter((a) => g.stages.includes(a.stage));
        if (!items.length) return null;
        return (
          <section
            key={g.id}
            className={`ql-group qa-group ${g.id}`}
            aria-labelledby={`qa-${g.id}`}
          >
            <div className="ql-group-head">
              <h2 id={`qa-${g.id}`}>
                {g.title} <span className="ql-count">{items.length}</span>
              </h2>
            </div>
            <ul className="ql-grid">
              {items.map((a) => (
                <ApplicationCard
                  key={a.id}
                  a={a}
                  busy={busy}
                  onOpenRun={onOpenRun}
                  onTailor={onTailor}
                  onStatus={onStatus}
                  onPractice={onPractice}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Add a role straight to the board: a public job link, or an advertisement pasted in full. */
export function AddRole({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (body: unknown) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'link' | 'paste'>('link');
  const [url, setUrl] = useState('');
  const [listing, setListing] = useState({ title: '', company: '', location: '', description: '' });
  const set = (k: keyof typeof listing) => (e: any) =>
    setListing({ ...listing, [k]: e.target.value });
  return (
    <details className="quest-tile qa-add">
      <summary>Add a role</summary>
      <div className="qa-add-modes" role="group" aria-label="How to add the role">
        <label>
          <input
            type="radio"
            name="add-role"
            checked={mode === 'link'}
            onChange={() => setMode('link')}
          />
          Public job link
        </label>
        <label>
          <input
            type="radio"
            name="add-role"
            checked={mode === 'paste'}
            onChange={() => setMode('paste')}
          />
          Paste the advertisement
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(mode === 'link' ? { url } : { listing: { ...listing } }).then((ok) => {
            if (!ok) return;
            setUrl('');
            setListing({ title: '', company: '', location: '', description: '' });
          });
        }}
      >
        {mode === 'link' ? (
          <label>
            Job link
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              required
            />
            <small className="muted">
              Company careers pages and boards that allow reading. For SEEK or LinkedIn, paste the
              advertisement instead.
            </small>
          </label>
        ) : (
          <>
            <label>
              Role title
              <input value={listing.title} onChange={set('title')} required />
            </label>
            <label>
              Company
              <input value={listing.company} onChange={set('company')} required />
            </label>
            <label>
              Location
              <input value={listing.location} onChange={set('location')} />
            </label>
            <label>
              Advertisement
              <textarea
                value={listing.description}
                onChange={set('description')}
                required
                minLength={200}
              />
            </label>
          </>
        )}
        <button type="submit" className="quest-press lime ql-go" disabled={busy}>
          Add to my quests
        </button>
      </form>
    </details>
  );
}

// What tailoring and practice cost in live mode, shown once above the role cards (CFS-124).
function TailorEstimate() {
  const data = useEstimates();
  if (!data) return null;
  return (
    <p className="qa-estimate muted" data-testid="estimate-tailor">
      {data.live
        ? `Tailor resume: ${estimateText(data, 'tailor', '')} Practise interview: ${estimateText(data, 'practice', '')}`
        : estimateText(data, 'tailor')}
    </p>
  );
}
