import React, { useEffect, useRef, useState } from 'react';
import { groupResumeClaims } from '../../../packages/contracts/src/resume-document.js';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  ShieldCheck,
  X,
} from 'lucide-react';

type Claim = { factId: string; kind: string; text: string; source: string; reason: string };

export function ResumeReview({
  mission: m,
  busy,
  onAction,
  onNavigate,
  onBack,
  embedded = false,
}: {
  mission: any;
  busy: boolean;
  onAction: (kind: string, body?: unknown) => Promise<void>;
  onNavigate: (phase: number) => void;
  onBack?: () => void;
  embedded?: boolean;
}) {
  const d = m.data,
    draft = d.resumeDraft,
    job = d.selectedJob?.job;
  const claims: Claim[] = draft?.claims || [];
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revisionOpen, setRevisionOpen] = useState(false);
  const revisionDialog = useRef<HTMLDialogElement>(null);
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  const saved = Boolean(d.approvedResumeId);
  const waiting = m.status === 'AWAITING_APPROVAL' && Boolean(draft) && !saved;
  const running = ['QUEUED', 'RUNNING'].includes(m.status) && !saved;
  const cancelled = ['CANCELLED', 'STALE'].includes(m.status);
  const selectingJob = m.pendingDecision?.kind === 'job' && running;
  const status = saved
    ? 'Approved & saved'
    : cancelled
      ? m.status === 'STALE'
        ? 'Profile changed'
        : 'Cancelled'
      : m.status === 'FAILED'
        ? m.pendingDecision?.kind === 'resume' && m.pendingDecision?.decision === 'approve'
          ? 'Save failed'
          : 'Action needed'
        : running
          ? m.pendingDecision?.decision === 'approve'
            ? 'Saving approved version'
            : 'Preparing draft'
          : waiting
            ? 'Ready for review'
            : 'Select a target job';

  useEffect(() => {
    // Consent applies only to the exact draft currently displayed.
    setConfirmed(false);
    setRevisionOpen(false);
  }, [m.id, draft?.hash]);

  useEffect(() => setFeedback(''), [m.id]);

  useEffect(() => {
    const dialog = revisionDialog.current;
    if (!dialog) return;
    if (revisionOpen && !dialog.open) {
      dialog.showModal();
      feedbackInput.current?.focus();
    } else if (!revisionOpen && dialog.open) dialog.close();
  }, [revisionOpen]);

  const groups = groupResumeClaims(claims);
  const requirements: string[] = d.selectedJob?.requirements?.required || [];
  const revisionCount = draft?.revision ?? d.revisions ?? 0;
  const showActions = !saved && !cancelled;

  return (
    <section
      id="resume-tailoring"
      className={`resume-review${embedded ? ' resume-review-embedded' : ''}`}
      aria-label="Resume review workspace"
    >
      {!embedded && (
        <button className="back" onClick={onBack}>
          ← All missions
        </button>
      )}
      <header className="resume-review-heading">
        <div>
          <span className="eyebrow">04 / RESUME TAILOR</span>
          {embedded ? <h2>Your evidence-grounded resume</h2> : <h1>Resume tailoring</h1>}
          <p>
            {job?.title ||
              (selectingJob
                ? 'Confirming your selected opportunity…'
                : 'Choose a target to get started')}
            {job?.company && <span> · {job.company}</span>}
          </p>
        </div>
        <span className={`resume-state${saved ? ' is-saved' : ''}`} role="status">
          {saved ? (
            <CheckCircle2 size={15} />
          ) : (
            <span className={running ? 'resume-state-dot is-working' : 'resume-state-dot'} />
          )}
          {status}
        </span>
      </header>

      {!embedded && m.error && (
        <div className="error-banner" role="alert">
          {m.error}
        </div>
      )}
      {cancelled && (
        <div className="resume-state-note" role="status">
          {m.status === 'STALE'
            ? 'Your profile changed. Start a new mission with your current approved facts.'
            : 'This draft was not saved. Your previously approved resumes remain available.'}
        </div>
      )}

      <details className="resume-details" key={m.id}>
        <summary>
          <span className="resume-details-icon">
            <ShieldCheck size={18} />
          </span>
          <span>
            <strong>Job & tailoring details</strong>
            <small>Requirements, sources and selected evidence</small>
          </span>
          <ChevronDown className="resume-details-chevron" size={18} />
        </summary>
        <div className="resume-details-body">
          <div className="resume-context-grid">
            <div>
              <h3>Target job</h3>
              <p>{job?.title || 'Not selected yet'}</p>
              <p>{[job?.company, job?.location].filter(Boolean).join(' · ')}</p>
              <p>
                {m.mode === 'fixture'
                  ? 'AI mode: demo fixtures · no live AI'
                  : 'AI mode: live provider'}
              </p>
              <p>
                Job source:{' '}
                {job?.source?.name || job?.source?.type || 'See Job matching for source details.'}
              </p>
            </div>
            <div>
              <h3>Approved context</h3>
              <p>
                Profile v{draft?.profileVersion || m.profile?.version || '—'} · {claims.length}{' '}
                selected facts
              </p>
              <p>
                Only user-approved facts are selected and reordered. Candidate wording remains
                unchanged.
              </p>
              <p>
                Draft {(draft?.revision ?? d.revisions ?? 0) + 1} · {revisionCount}/2 revisions used
              </p>
            </div>
          </div>
          {requirements.length > 0 && (
            <div className="resume-required">
              <h3>Required skills from this job</h3>
              <div>
                {requirements.map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </div>
            </div>
          )}
          <h3>Review proposed changes</h3>
          <p className="resume-explainer">
            The following facts are included in this draft. This is a selection review, not a
            comparison with a previous version.
          </p>
          <ol className="resume-evidence-list">
            {claims.map((c) => (
              <li key={c.factId}>
                <strong>{c.text}</strong>
                <p>{c.reason}</p>
                <small>
                  Source: {c.source} · {c.factId} · Profile v{draft.profileVersion}
                </small>
              </li>
            ))}
          </ol>
          <h3>Omitted for this target role</h3>
          {draft?.omittedFacts?.length ? (
            <ul className="resume-omitted">
              {draft.omittedFacts.map((f: any) => (
                <li key={f.id}>{f.text}</li>
              ))}
            </ul>
          ) : (
            <p className="resume-explainer">No eligible approved facts were omitted.</p>
          )}
          {!embedded && (
            <p className="resume-technical">
              {d.apiCalls || 0} / 12 model calls ·{' '}
              {((d.inputTokens || 0) + (d.outputTokens || 0)).toLocaleString()} tokens recorded.
              Full events are available in Activity.
            </p>
          )}
        </div>
      </details>

      {draft ? (
        <div className={`resume-workspace${showActions ? ' has-review-actions' : ''}`}>
          <article className="resume-paper" aria-label="Resume preview">
            <div className="resume-paper-caption">
              <FileCheck2 size={14} />
              <span>{saved ? 'APPROVED RESUME' : 'RESUME PREVIEW · NOT SAVED'}</span>
              <span>Draft {revisionCount + 1}</span>
            </div>
            <div className="resume-paper-content">
              <header className="resume-paper-header">
                <h2>{draft.name}</h2>
                <p>Application target: {draft.jobTitle}</p>
              </header>
              {groups.map(({ kind, title, claims: items }) => {
                return (
                  <section className={`resume-paper-section resume-${kind}`} key={kind}>
                    <h3>{title}</h3>
                    {kind === 'skill' ? (
                      <ul className="resume-skill-list">
                        {items.map((c) => (
                          <li key={c.factId}>{c.text}</li>
                        ))}
                      </ul>
                    ) : (
                      <ul className="resume-fact-list">
                        {items.map((c) => (
                          <li key={c.factId}>{c.text}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            <footer className="resume-paper-footer">
              <ShieldCheck size={14} />
              {claims.length} claims linked to approved profile v{draft.profileVersion}
            </footer>
          </article>

          {showActions && (
            <aside
              className={`resume-decision${embedded ? '' : ' resume-decision-docked'}`}
              aria-label="Review and approval"
            >
              <div className="resume-decision-intro">
                <span className="eyebrow">YOUR FINAL SAY</span>
                <h2>Review & approve</h2>
                <p>Check the resume, then approve this exact version or request a revision.</p>
              </div>
              <div className="resume-action-dock">
                <div className="resume-action-caption">
                  <strong>Draft {revisionCount + 1}</strong>
                  <span>{status}</span>
                </div>
                {waiting && (
                  <label className="checkbox resume-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I reviewed the selected claims and approve this exact resume draft.
                  </label>
                )}
                <div className="resume-action-buttons">
                  {waiting && (
                    <button
                      className="primary"
                      disabled={!confirmed || busy}
                      onClick={() =>
                        void onAction('decisions', {
                          kind: 'resume',
                          decision: 'approve',
                          draftHash: draft.hash,
                        })
                      }
                    >
                      <Check size={17} />
                      Approve & save resume
                    </button>
                  )}
                  {waiting && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => setRevisionOpen(true)}
                    >
                      Request a revision instead
                    </button>
                  )}
                  {m.status === 'FAILED' && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void onAction('retry')}
                    >
                      Retry failed step
                    </button>
                  )}
                  {running && (
                    <p className="resume-saving" role="status">
                      <span className="pulse" />
                      {status}…
                    </p>
                  )}
                </div>
                <div className="resume-decision-foot">
                  <span>{revisionCount}/2 revisions used</span>
                  {!embedded && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void onAction('cancel')}
                    >
                      Cancel further work
                    </button>
                  )}
                </div>
              </div>
              <p className="resume-preservation">
                <ShieldCheck size={15} />
                Your previously approved resumes stay available.
              </p>
            </aside>
          )}

          {saved && (
            <aside className="resume-saved-panel" aria-label="Saved resume">
              <CheckCircle2 size={29} />
              <h2>Your resume is saved.</h2>
              <p>This exact approved version is available in your document library.</p>
              <p>Plain-text download · grouped like this preview.</p>
              <a className="primary" href={`/api/resumes/${d.approvedResumeId}/download`}>
                Download approved resume
              </a>
              <button className="secondary" onClick={() => onNavigate(4)}>
                Continue to interview
                <ArrowRight size={16} />
              </button>
            </aside>
          )}
        </div>
      ) : (
        <div className="resume-empty-state" role="status">
          <FileCheck2 size={28} />
          <h2>
            {running || cancelled
              ? status
              : m.status === 'FAILED'
                ? 'Draft preparation paused'
                : 'Your resume starts with a target job'}
          </h2>
          <p>
            {running
              ? 'Your approved facts are being prepared for this role. You can stay here while the draft is generated.'
              : m.status === 'FAILED'
                ? 'Your approved data remains available. Retry the failed step or check its input requirements.'
                : 'Choose an opportunity in Job matching to prepare a resume using your approved facts.'}
          </p>
          {!running && !cancelled && (
            <button className="secondary" onClick={() => onNavigate(2)}>
              Go to 03 Job matching
            </button>
          )}
          {m.status === 'FAILED' && (
            <button className="primary" disabled={busy} onClick={() => void onAction('retry')}>
              Retry failed step
            </button>
          )}
          {running && (
            <button className="text-button" disabled={busy} onClick={() => void onAction('cancel')}>
              Cancel further work
            </button>
          )}
        </div>
      )}

      <dialog
        className="resume-revision-dialog"
        ref={revisionDialog}
        onClose={() => setRevisionOpen(false)}
        aria-labelledby={`resume-revision-title-${m.id}`}
      >
        <div className="resume-dialog-heading">
          <div>
            <span className="eyebrow">REFINE YOUR DRAFT</span>
            <h2 id={`resume-revision-title-${m.id}`}>Request a revision</h2>
          </div>
          <button aria-label="Close revision form" onClick={() => setRevisionOpen(false)}>
            <X size={21} />
          </button>
        </div>
        <p>Ask for a different emphasis or order. Your approved facts stay unchanged.</p>
        <label>
          Emphasis or ordering feedback
          <textarea
            ref={feedbackInput}
            value={feedback}
            maxLength={2000}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="For example: prioritise my SQL project experience for this role."
          />
        </label>
        <p className="resume-revision-budget">{revisionCount}/2 revisions used</p>
        {revisionCount >= 2 && (
          <p className="resume-revision-limit" role="status">
            Both revisions have been used. You can approve this draft, or cancel and start a new
            mission with updated inputs.
          </p>
        )}
        <div className="resume-dialog-actions">
          <button className="secondary" onClick={() => setRevisionOpen(false)}>
            Back to resume
          </button>
          <button
            className="primary"
            disabled={busy || !waiting || feedback.trim().length < 3 || revisionCount >= 2}
            onClick={async () => {
              await onAction('decisions', {
                kind: 'resume',
                decision: 'revise',
                draftHash: draft.hash,
                feedback,
              });
              setRevisionOpen(false);
            }}
          >
            Request revision · {revisionCount}/2 used
          </button>
        </div>
      </dialog>
    </section>
  );
}
