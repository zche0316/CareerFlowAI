import React, { useEffect, useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { Request } from './profile-conversation.js';

export function WordingStudio({
  api,
  resume,
  onSaved,
  onClose,
}: {
  api: Request;
  resume: any;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [fact, setFact] = useState(''),
    [rows, setRows] = useState<any[]>([]),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<any>(null);

  const load = async () => setRows(await api(`/resumes/${resume.id}/wording`));
  useEffect(() => {
    let active = true;
    setRows([]);
    setEdits({});
    setReviewed(false);
    setSaved(null);
    setError('');
    setFact(resume.content.claims[0]?.factId || '');
    void api(`/resumes/${resume.id}/wording`)
      .then((result) => {
        if (active) setRows(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      });
    return () => {
      active = false;
    };
  }, [resume.id]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accepted = rows.some((row) => row.status === 'ACCEPTED');
  const currentProposal = rows.filter((row) => row.factId === fact).at(-1);

  return (
    <section className="wording-studio" aria-label={`Polish ${resume.content.jobTitle} wording`}>
      <header className="wording-studio-header">
        <div>
          <span className="wording-kicker">
            <Sparkles size={15} /> Optional polish
          </span>
          <h2>Improve one resume bullet</h2>
          <p>Get a clearer rewrite without changing the approved facts.</p>
        </div>
        <button className="icon-button" aria-label="Close wording editor" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="wording-controls">
        <label>
          Resume bullet
          <select
            disabled={busy}
            aria-label="Resume bullet"
            value={fact}
            onChange={(event) => setFact(event.target.value)}
          >
            {resume.content.claims.map((claim: any) => (
              <option value={claim.factId} key={claim.factId}>
                {claim.text.slice(0, 130)}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox wording-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Use AI to suggest a factual rewrite of this bullet.
        </label>
        <button
          className="primary compact-action"
          disabled={busy || !fact || !consent}
          onClick={() =>
            void run(async () => {
              await api(`/resumes/${resume.id}/wording`, 'POST', { factId: fact, consent: true });
              await load();
              setReviewed(false);
            })
          }
        >
          <Sparkles size={16} />
          {busy ? 'Working…' : 'Suggest rewrite'}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          We couldn’t prepare a rewrite. Your approved resume has not changed. Please try again.
        </p>
      )}
      <div className="wording-results">
        {currentProposal &&
          [currentProposal].map((proposal) => {
            if (proposal.status === 'BLOCKED' || proposal.status === 'FAILED')
              return (
                <div className="wording-withheld" key={proposal.id}>
                  <strong>No rewrite shown</strong>
                  <p>
                    The suggestion could not be verified against your approved information, so it
                    was withheld. Your original bullet remains unchanged.
                  </p>
                </div>
              );
            return (
              <article className="wording-comparison" key={proposal.id}>
                <div className="wording-original">
                  <span>Original</span>
                  <p>{proposal.before}</p>
                </div>
                <label>
                  Suggested wording
                  <textarea
                    disabled={proposal.status !== 'PENDING' || busy}
                    aria-label="Suggested wording"
                    value={edits[proposal.id] ?? proposal.after}
                    onChange={(event) => {
                      setEdits({ ...edits, [proposal.id]: event.target.value });
                      setReviewed(false);
                    }}
                  />
                </label>
                {proposal.status === 'PENDING' ? (
                  <div className="form-actions">
                    <button
                      className="primary compact-action"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/resume-wordings/${proposal.id}`, 'PATCH', {
                            decision: 'accept',
                            reviewed: true,
                            after: edits[proposal.id] ?? proposal.after,
                          });
                          await load();
                          setReviewed(false);
                        })
                      }
                    >
                      <Check size={16} /> Use this wording
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/resume-wordings/${proposal.id}`, 'PATCH', {
                            decision: 'reject',
                            reviewed: true,
                          });
                          await load();
                        })
                      }
                    >
                      Keep original
                    </button>
                  </div>
                ) : proposal.status === 'ACCEPTED' ? (
                  <p className="wording-accepted">
                    <Check size={15} /> Ready for a revised version
                  </p>
                ) : null}
              </article>
            );
          })}
      </div>
      {accepted && !saved && (
        <div className="wording-finalize">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I reviewed the accepted wording.
          </label>
          <button
            className="primary"
            disabled={busy || !reviewed}
            onClick={() =>
              void run(async () => {
                const result = await api(`/resumes/${resume.id}/wording/finalize`, 'POST', {
                  reviewed: true,
                });
                setSaved(result);
                setReviewed(false);
                await onSaved();
              })
            }
          >
            Create revised resume version
          </button>
          <small>Your current approved resume will remain available.</small>
        </div>
      )}
      {saved && (
        <div className="wording-saved" role="status">
          <Check size={18} />
          <div>
            <strong>Revised version created</strong>
            <p>Your original and revised resumes are both available in the library.</p>
            <div className="form-actions">
              {['pdf', 'docx'].map((format) => (
                <a
                  className="secondary"
                  key={format}
                  href={`/api/resumes/${saved.id}/download?format=${format}`}
                >
                  Download {format.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
