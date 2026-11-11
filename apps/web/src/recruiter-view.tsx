import { useEffect, useState } from 'react';

// Recruiter view (CFS-116): how a screening system and a recruiter would read this resume.

const statusLabel: Record<string, string> = {
  met: 'Met',
  not_met: 'Not met',
  check: 'Check',
  unknown: 'Not stated',
};

export function RecruiterView({
  id,
  api,
}: {
  id: string;
  api: (path: string) => Promise<any>;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    api(`/resumes/${id}/recruiter-check`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p className="muted">Reading the resume the way a screening system would…</p>;
  const s = data.scores;
  const score = (label: string, value: number | null, suffix = '%') => (
    <div>
      <dt>{label}</dt>
      <dd>{value === null ? 'n/a' : `${value}${suffix}`}</dd>
    </div>
  );
  return (
    <section className="panel recruiter-view" aria-label="Recruiter view">
      <h3>
        Recruiter view · {data.jobTitle}
        {data.company && ` at ${data.company}`}
      </h3>
      <dl className="rv-scores">
        {score('Read back from PDF', s.parse)}
        {score('Required terms present', s.keywords)}
        {score('…in experience lines', s.inExperience)}
        {score('Level fit', s.levelFit)}
        <div>
          <dt>Knock-outs not met</dt>
          <dd>{s.knockouts}</dd>
        </div>
      </dl>
      <details open>
        <summary>Knock-out questions</summary>
        <ul>
          {data.knockouts.map((k: any) => (
            <li key={k.kind}>
              <strong>{k.kind}:</strong> {statusLabel[k.status]} · {k.detail}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Keywords</summary>
        <ul>
          {data.keywords.rows.map((r: any) => (
            <li key={r.term}>
              {r.term} ({r.level}):{' '}
              {r.where === 'missing'
                ? 'not in the resume'
                : `${r.exact ? 'exact term' : 'another name for it'}, ${r.where}`}
            </li>
          ))}
        </ul>
        {data.keywords.swaps.length > 0 && (
          <>
            <p>
              Recruiters search for exact terms. These approved lines name the same skill
              differently; you can use the employer’s word in Polish wording:
            </p>
            <ul>
              {data.keywords.swaps.map((w: any) => (
                <li key={w.term}>
                  Use “{w.term}” in: {w.line}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
      {data.levelGaps.length > 0 && (
        <details>
          <summary>Level gaps</summary>
          <ul>
            {data.levelGaps.map((g: any) => (
              <li key={g.term}>
                {g.skill}: role asks for level {g.need}, your evidence shows {g.have} ({g.level})
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>PDF read-back</summary>
        <ul>
          {data.parse.checks.map((c: any) => (
            <li key={c.label}>
              {c.ok ? '✓' : '✗'} {c.label}
              {c.detail ? ` · ${c.detail}` : ''}
            </li>
          ))}
        </ul>
      </details>
      <p className="small muted">{data.limitations.join(' ')}</p>
    </section>
  );
}
