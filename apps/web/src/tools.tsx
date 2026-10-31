import React, { useState, useEffect } from 'react';
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OptionalTools({
  missions,
  request,
  onRefresh,
}: {
  missions: any[];
  request: (p: string, m?: string, b?: unknown) => Promise<any>;
  onRefresh: () => Promise<any>;
}) {
  const [activeTool, setActiveTool] = useState('progress');
  const [selected, S] = useState(''),
    [dashboard, D] = useState<any>(null),
    [error, E] = useState(''),
    [busy, B] = useState(false),
    [status, ST] = useState('applied'),
    [review, R] = useState(false),
    [title, T] = useState('Application deadline'),
    [category, C] = useState('application'),
    [due, U] = useState(''),
    [offer, O] = useState(''),
    [response, P] = useState('');
  const targets = missions.filter((m) => m.data.selectedJob);
  const mission = targets.find((m) => m.id === selected) || targets[0];
  const data = mission?.data.optionalTools || {};
  const load = async () => D(await request('/tools/dashboard'));
  useEffect(() => {
    load().catch((e) => E(e.message));
  }, [missions]);
  useEffect(() => R(false), [mission?.id, data.letter?.at]);
  const act = async (fn: () => Promise<any>) => {
    E('');
    B(true);
    try {
      await fn();
      await onRefresh();
      await load();
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  };
  const command = (b: any) => request(`/missions/${mission.id}/tools`, 'POST', b);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Application tools</h1>
          <p>Work with the selected job and approved resume.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <section className="panel">
        <label>
          Target mission
          <select value={mission?.id || ''} onChange={(e) => S(e.target.value)}>
            <option value="" disabled>
              Select a mission with a target job
            </option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.data.selectedJob.job.title} · {m.goal}
              </option>
            ))}
          </select>
        </label>
        {!mission && <p>Select a job in Career missions to enable these tools.</p>}
      </section>
      <nav className="workspace-tabs" aria-label="Application tools">
        {[
          ['progress', 'Progress'],
          ['letter', 'Cover letter'],
          ['reminders', 'Reminders'],
          ['practice', 'Scripted practice'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={activeTool === id} onClick={() => setActiveTool(id)}>
            {label}
          </button>
        ))}
      </nav>
      <section className="panel tool-surface" hidden={activeTool !== 'progress'}>
        <h2>Application progress</h2>
        <p>Self-reported application statuses. Recording here does not submit an application.</p>
        <label>
          Status
          <select value={status} onChange={(e) => ST(e.target.value)}>
            {['applied', 'interview', 'rejected', 'offer'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          disabled={!mission || busy}
          className="secondary"
          onClick={() => void act(() => command({ kind: 'status', status }))}
        >
          Record target status
        </button>
        {dashboard && (
          <>
            <p>
              {dashboard.total} applications · {dashboard.interviewCount} reached interview/offer ·{' '}
              {dashboard.rejected} rejected
            </p>
            <p>
              Interview rate:{' '}
              {dashboard.interviewRate === null
                ? 'No data'
                : Math.round(dashboard.interviewRate * 100) + '%'}{' '}
              · Rejection rate:{' '}
              {dashboard.rejectionRate === null
                ? 'No data'
                : Math.round(dashboard.rejectionRate * 100) + '%'}
            </p>
            {dashboard.applications.map((a: any) => (
              <p key={a.missionId}>
                {a.title} · {a.status}
              </p>
            ))}
            <h3>Recurring gaps in latest matches</h3>
            {dashboard.recurringGaps.map(([gap, n]: any) => (
              <p key={gap}>
                {gap} · {n} roles
              </p>
            ))}
            <p className="muted">{dashboard.limitations.join(' ')}</p>
          </>
        )}
      </section>
      <section className="panel tool-surface" hidden={activeTool !== 'letter'}>
        <h2>Cover letter</h2>
        <button
          className="secondary"
          disabled={!mission || busy}
          onClick={() => void act(() => command({ kind: 'letter' }))}
        >
          Prepare source-backed letter
        </button>
        {data.letter && (
          <>
            <pre>{data.letter.text}</pre>
            <p>{data.letter.limitations.join(' ')}</p>
            <label className="checkbox">
              <input type="checkbox" checked={review} onChange={(e) => R(e.target.checked)} />I
              reviewed the letter against my approved evidence and target role.
            </label>
            <button
              className="secondary"
              disabled={!review}
              onClick={() =>
                download('careerflow-cover-letter.txt', data.letter.text, 'text/plain')
              }
            >
              Download reviewed letter
            </button>
          </>
        )}
      </section>
      <section className="panel tool-surface" hidden={activeTool !== 'reminders'}>
        <h2>Reminders</h2>
        <p>
          In-app reminders persist in the database. Export to your calendar for a 15-minute alarm
          when this app is closed.
        </p>
        <div className="grid-2">
          <label>
            Reminder title
            <input value={title} onChange={(e) => T(e.target.value)} />
          </label>
          <label>
            Kind
            <select value={category} onChange={(e) => C(e.target.value)}>
              {['application', 'interview', 'follow-up'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Local date & time
            <input type="datetime-local" value={due} onChange={(e) => U(e.target.value)} />
          </label>
        </div>
        <button
          className="secondary"
          disabled={!mission || busy || !due || !title.trim()}
          onClick={() =>
            void act(() =>
              command({ kind: 'reminder', title, category, dueAt: new Date(due).toISOString() }),
            )
          }
        >
          Save reminder
        </button>
        {dashboard?.reminders.map((r: any) => (
          <div key={r.id}>
            <p>
              <strong>
                {Date.parse(r.dueAt) <= Date.now() ? 'DUE · ' : ''}
                {r.title}
              </strong>{' '}
              · {new Date(r.dueAt).toLocaleString()} · {r.category}
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const c = await request(`/missions/${r.missionId}/reminders/${r.id}/calendar`);
                  download(c.filename, c.content, 'text/calendar');
                })
              }
            >
              Export calendar alarm
            </button>
          </div>
        ))}
      </section>
      <section className="panel tool-surface" hidden={activeTool !== 'practice'}>
        <h2>Scripted salary practice</h2>
        <p>Scripted local roleplay. No market salary estimate or employer message.</p>
        <label>
          Offer context
          <textarea value={offer} onChange={(e) => O(e.target.value)} />
        </label>
        <label>
          Your proposed response
          <textarea value={response} onChange={(e) => P(e.target.value)} />
        </label>
        <button
          className="secondary"
          disabled={!mission || busy || !offer.trim() || !response.trim()}
          onClick={() => void act(() => command({ kind: 'negotiation', offer, response }))}
        >
          Practice response
        </button>
        {data.negotiation && (
          <>
            <p>{data.negotiation.reply}</p>
            <ul>
              {data.negotiation.feedback.map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p>{data.negotiation.limitations.join(' ')}</p>
          </>
        )}
      </section>
    </>
  );
}
