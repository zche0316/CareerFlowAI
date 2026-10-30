import React, { useState } from 'react';
import type { Request } from './profile-conversation.js';
export function ApplicationReadiness({ missionId, api }: { missionId: string; api: Request }) {
  const [data, setData] = useState<any>(null),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="profile-assistant">
      <h3>Application fields &amp; gaps</h3>
      <p>
        Check published employer questions and your preparation gaps. Work rights, sponsorship,
        salary and demographic answers are never inferred. Answers stay with this application; they
        do not become profile facts.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const r = await api(`/missions/${missionId}/application-readiness`);
            setData(r);
            setAnswers(r.answers || {});
            setReviewed(false);
          })
        }
      >
        Check application fields
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">{data.notice}</p>
          <p>
            {data.schemaKnown
              ? 'Public question schema loaded'
              : 'Full application schema unknown — check the official page'}
          </p>
          {data.sourceUrl && (
            <a href={data.sourceUrl} target="_blank" rel="noreferrer">
              Official question source
            </a>
          )}
          {data.fields.map((f: any) => (
            <label key={f.id}>
              {f.label} {f.required ? '(required)' : '(optional)'}
              {f.options.length ? (
                <select
                  value={answers[f.id] || ''}
                  onChange={(e) => {
                    setAnswers({ ...answers, [f.id]: e.target.value });
                    setReviewed(false);
                  }}
                >
                  <option value="">Review and choose</option>
                  {f.options.map((o: any) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={answers[f.id] || ''}
                  maxLength={2000}
                  onChange={(e) => {
                    setAnswers({ ...answers, [f.id]: e.target.value });
                    setReviewed(false);
                  }}
                />
              )}
              <small>
                {f.origin} · {f.state}
                {f.sensitive
                  ? ' · Sensitive/eligibility: answer yourself on the official form when appropriate.'
                  : ''}
              </small>
              {f.suggested && !answers[f.id] && (
                <button
                  className="secondary"
                  onClick={() => {
                    setAnswers({ ...answers, [f.id]: f.suggested });
                    setReviewed(false);
                  }}
                >
                  Use and review supplied value
                </button>
              )}
            </label>
          ))}
          <p>
            Required gaps at the last check: {data.fields.filter((f: any) => f.missing).length}.
            Save your reviewed answers to recheck. This does not guarantee employer form acceptance.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed these application-only answers. Nothing will be submitted.
          </label>
          <button
            className="secondary"
            disabled={busy || !reviewed || !data.fields.length}
            onClick={() =>
              void run(async () => {
                const r = await api(`/missions/${missionId}/application-readiness`, 'POST', {
                  hash: data.hash,
                  answers,
                  reviewed: true,
                });
                setData(r);
                setReviewed(false);
              })
            }
          >
            Save reviewed application preparation
          </button>
        </>
      )}
    </section>
  );
}
