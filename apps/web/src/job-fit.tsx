import React, { useEffect, useState } from 'react';
import type { Request } from './profile-conversation.js';

export function JobFit({ missionId, api }: { missionId: string; api: Request }) {
  const [result, setResult] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setResult(null);
    setError('');
    void api(`/missions/${missionId}/job-fit`)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [missionId]);
  if (error) return <div role="alert">Could not load job evidence: {error}</div>;
  if (!result) return <p role="status">Preparing your fit review…</p>;
  return (
    <section className="panel job-fit" aria-label="Job fit review">
      <div className="section-heading">
        <div>
          <h2>Your fit for {result.job.title}</h2>
          <p className="muted">Review the job alongside your approved profile.</p>
        </div>
      </div>
      <p className="small">
        {result.interpretation === 'mentioned'
          ? 'The following skills are mentioned in the listing; confirm whether each is required.'
          : 'Skills identified in the listing.'}{' '}
        {result.notice}
      </p>
      {!result.items.length && (
        <p>
          No supported skills were extracted. Read the original listing and check the requirements
          manually.
        </p>
      )}
      {result.items.map((item: any) => (
        <article className="fit-row" key={item.term}>
          <div>
            <h3>{item.term}</h3>
            <span className={item.evidence.length ? 'fit-found' : 'fit-review'}>
              {item.evidence.length ? 'Evidence to review' : 'No exact match found'}
            </span>
          </div>
          <div>
            <p>
              <strong>From the listing:</strong> {item.excerpt}
            </p>
            {item.evidence.length ? (
              <ul>
                {item.evidence.map((fact: any) => (
                  <li key={fact.id}>{fact.text}</li>
                ))}
              </ul>
            ) : (
              <p>Check your profile or add relevant experience if you have it.</p>
            )}
            {item.evidence.length > 0 && (
              <details>
                <summary>Evidence references</summary>
                <p>
                  Approved profile v{result.profileVersion}:{' '}
                  {item.evidence.map((e: any) => e.id).join(', ')}
                </p>
              </details>
            )}
          </div>
        </article>
      ))}
      {result.job.sourceUrl && (
        <a href={result.job.sourceUrl} target="_blank" rel="noreferrer">
          View the original listing ↗
        </a>
      )}
    </section>
  );
}
