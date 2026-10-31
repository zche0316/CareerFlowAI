import React, { useEffect, useState } from 'react';
import type { Request } from './profile-conversation.js';

export function JobFit({
  missionId,
  api,
  compact = false,
}: {
  missionId: string;
  api: Request;
  compact?: boolean;
}) {
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
  if (compact) {
    const missing = result.items.filter((item: any) => !item.evidence.length);
    return (
      <section className="job-gap-notice" aria-label="Job requirements to review">
        <strong>Role requirements to review</strong>
        {missing.length ? (
          <ul>
            {missing.slice(0, 3).map((item: any) => (
              <li key={item.term}>{item.term} — no exact wording match in this profile</li>
            ))}
          </ul>
        ) : (
          <p>
            {result.items.length
              ? 'Review the depth and scope of your evidence against the original listing.'
              : 'Read the original listing; its requirements could not be extracted reliably.'}
          </p>
        )}
        {missing.length > 3 && (
          <details>
            <summary>{missing.length - 3} more requirements to review</summary>
            <ul>
              {missing.slice(3).map((item: any) => (
                <li key={item.term}>
                  <strong>{item.term}</strong>
                  <p>{item.excerpt}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p>
          Missing evidence is not proof that you lack a skill. Confirm relevant experience before
          adding a claim.
        </p>
      </section>
    );
  }
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
