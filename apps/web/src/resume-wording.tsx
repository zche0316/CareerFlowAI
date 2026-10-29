import React, { useEffect, useState } from 'react';
import type { Request } from './profile-conversation.js';
export function WordingStudio({
  api,
  resumes,
  onSaved,
}: {
  api: Request;
  resumes: any[];
  onSaved: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState(''),
    [fact, setFact] = useState(''),
    [rows, setRows] = useState<any[]>([]),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<any>(null);
  const resume = resumes.find((r) => r.id === selected);
  const load = async () => setRows(await api(`/resumes/${selected}/wording`));
  useEffect(() => {
    if (!selected && resumes[0]) setSelected(resumes[0].id);
  }, [resumes[0]?.id]);
  useEffect(() => {
    let active = true;
    setRows([]);
    setEdits({});
    setReviewed(false);
    setSaved(null);
    setFact(resume?.content.claims[0]?.factId || '');
    if (selected)
      void api(`/resumes/${selected}/wording`)
        .then((r) => {
          if (active) setRows(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!resumes.length) return null;
  return (
    <section className="panel" aria-label="Evidence-grounded wording workshop">
      <h2>Review resume wording</h2>
      <p>
        Facts and expression are saved separately. Suggestions are constrained to source-supported
        words, numbers and qualifiers; you still review every sentence. Unsupported new claims
        require a profile correction.
      </p>
      <label>
        Resume for wording review
        <select
          disabled={busy}
          aria-label="Resume for wording review"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.content.jobTitle} · {new Date(r.approvedAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <label>
        Source claim
        <select
          disabled={busy}
          aria-label="Source claim"
          value={fact}
          onChange={(e) => setFact(e.target.value)}
        >
          {resume?.content.claims.map((c: any) => (
            <option value={c.factId} key={c.factId}>
              {c.text.slice(0, 130)}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I
        allow the configured model to process this selected approved claim.
      </label>
      <button
        className="secondary"
        disabled={busy || !fact || !consent}
        onClick={() =>
          void run(async () => {
            await api(`/resumes/${selected}/wording`, 'POST', { factId: fact, consent: true });
            await load();
            setReviewed(false);
          })
        }
      >
        Suggest source-grounded wording
      </button>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {rows.map((p) => (
        <article className="evidence-card" key={p.id}>
          <strong>
            {p.factId} · {p.status}
          </strong>
          <div className="grid-2">
            <div>
              <h4>Original expression</h4>
              <pre>{p.before}</pre>
            </div>
            <label>
              Suggested expression
              <textarea
                disabled={p.status !== 'PENDING' || busy}
                aria-label="Suggested expression"
                value={edits[p.id] ?? p.after}
                onChange={(e) => {
                  setEdits({ ...edits, [p.id]: e.target.value });
                  setReviewed(false);
                }}
              />
            </label>
          </div>
          <p>{p.reason}</p>
          <small>
            Source snapshot: {p.sourceHash} · {p.model}
          </small>
          {p.status === 'PENDING' && (
            <div className="form-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/resume-wordings/${p.id}`, 'PATCH', {
                      decision: 'accept',
                      reviewed: true,
                      after: edits[p.id] ?? p.after,
                    });
                    await load();
                    setReviewed(false);
                  })
                }
              >
                Accept reviewed wording
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/resume-wordings/${p.id}`, 'PATCH', {
                      decision: 'reject',
                      reviewed: true,
                    });
                    await load();
                  })
                }
              >
                Reject wording
              </button>
            </div>
          )}
        </article>
      ))}
      <label className="checkbox">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        I reviewed the accepted wording and want a separate approved resume edition.
      </label>
      <button
        className="secondary"
        disabled={busy || !reviewed || !rows.some((r) => r.status === 'ACCEPTED')}
        onClick={() =>
          void run(async () => {
            const r = await api(`/resumes/${selected}/wording/finalize`, 'POST', {
              reviewed: true,
            });
            setSaved(r);
            setReviewed(false);
            await onSaved();
          })
        }
      >
        Save reviewed wording edition
      </button>
      {saved && (
        <div role="status">
          <p>
            Saved a new approved edition. Original facts and previous documents are retained.
            Existing mission application packages keep their original approved version; use this
            edition for your manual upload.
          </p>
          {['txt', 'pdf', 'docx'].map((format) => (
            <a
              className="secondary"
              key={format}
              href={`/api/resumes/${saved.id}/download?format=${format}`}
            >
              Download reviewed {format.toUpperCase()}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
