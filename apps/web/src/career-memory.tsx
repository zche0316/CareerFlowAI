import React, { useEffect, useRef, useState } from 'react';
import type { Request } from './profile-conversation.js';
const empty = () => ({
  kind: 'NOTE',
  title: '',
  text: '',
  star: { situation: '', task: '', action: '', result: '' },
  source: { kind: 'user', id: '', quote: '' },
  recordId: '',
  missionId: '',
  supersedesId: null as string | null,
});
export function CareerMemoryPanel({
  api,
  incoming,
  profileVersion,
  onDiscuss,
}: {
  onDiscuss?: (memory: any) => void;
  api: Request;
  incoming: any;
  profileVersion: number;
}) {
  const [data, setData] = useState<any>({ memories: [], records: [], missions: [] }),
    [form, setForm] = useState(empty),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [record, setRecord] = useState(''),
    [application, setApplication] = useState(''),
    [hits, setHits] = useState<any>(null),
    [editorOpen, setEditorOpen] = useState(false),
    [libraryQuery, setLibraryQuery] = useState(''),
    [deleteId, setDeleteId] = useState<string | null>(null);
  const latestForm = useRef(form);
  latestForm.current = form;
  const refresh = async () => setData(await api('/career-memories'));
  useEffect(() => {
    let active = true;
    void api('/career-memories')
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [profileVersion]);
  useEffect(() => {
    if (incoming) {
      setForm({ ...empty(), ...incoming });
      setEditorOpen(true);
    }
  }, [incoming]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(
        Object.values((e as any).fields || {})
          .flat()
          .join(' ') || (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const snapshot = JSON.stringify(form);
      const text = form.kind === 'STAR' ? Object.values(form.star).join('\n') : form.text;
      await api('/career-memories', 'POST', {
        ...form,
        recordId: form.recordId || null,
        missionId: form.missionId || null,
        source: { ...form.source, quote: form.source.quote || text },
      });
      setForm((current) => (JSON.stringify(current) === snapshot ? empty() : current));
      if (JSON.stringify(latestForm.current) === snapshot) setEditorOpen(false);
      setHits(null);
      await refresh();
      setNotice('Draft memory saved. Review it below before confirmation and retrieval.');
    });
  return (
    <section
      className="profile-assistant memory-workspace"
      aria-label="Career memory and STAR library"
    >
      <h3>Career memory &amp; STAR stories</h3>
      <p className="muted">Keep useful stories, achievements and notes for future applications.</p>
      <details className="memory-help">
        <summary>How memory works</summary>
        <p className="muted">
          Drafts are private review copies. Only memories you confirm can support future
          suggestions, and they never change your approved profile automatically. Editing a
          confirmed memory keeps its earlier version for traceability.
        </p>
      </details>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details
        className="memory-editor"
        open={editorOpen}
        onToggle={(e) => setEditorOpen(e.currentTarget.open)}
      >
        <summary>{form.supersedesId ? 'Edit memory' : 'Add a memory'}</summary>
        <div className="form-grid">
          <label>
            Memory type
            <select
              aria-label="Memory type"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="NOTE">Career note</option>
              <option value="STAR">STAR story</option>
            </select>
          </label>
          <label>
            Memory title
            <input
              aria-label="Memory title"
              value={form.title}
              maxLength={180}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          {form.kind === 'NOTE' ? (
            <label className="wide">
              Memory text
              <textarea
                aria-label="Memory text"
                value={form.text}
                maxLength={4000}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </label>
          ) : (
            (['situation', 'task', 'action', 'result'] as const).map((k) => (
              <label key={k}>
                STAR {k}
                <textarea
                  aria-label={`STAR ${k}`}
                  value={form.star[k]}
                  maxLength={2000}
                  onChange={(e) =>
                    setForm({ ...form, star: { ...form.star, [k]: e.target.value } })
                  }
                />
              </label>
            ))
          )}
          <label>
            Applicable project or work record
            <select
              aria-label="Applicable project or work record"
              value={form.recordId}
              onChange={(e) => setForm({ ...form, recordId: e.target.value })}
            >
              <option value="">General career memory</option>
              {data.records.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.text.split('\n')[0]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Applicable application or mission
            <select
              aria-label="Applicable application or mission"
              value={form.missionId}
              onChange={(e) => setForm({ ...form, missionId: e.target.value })}
            >
              <option value="">All applications</option>
              {data.missions.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.goal}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Source quote (optional for a new personal note)
            <textarea
              aria-label="Source quote (optional for a new personal note)"
              value={form.source.quote}
              onChange={(e) =>
                setForm({ ...form, source: { ...form.source, quote: e.target.value } })
              }
            />
          </label>
        </div>
        <p className="small">
          Source: {form.source.kind}
          {form.source.id ? ` · ${form.source.id}` : ' · your own attestation'}
          {form.supersedesId ? ` · corrects ${form.supersedesId}` : ''}
        </p>
        <button
          className="secondary"
          disabled={busy || !form.title.trim()}
          onClick={() => void save()}
        >
          Save draft memory
        </button>{' '}
        <button className="secondary" onClick={() => setForm(empty())}>
          Clear memory editor
        </button>
      </details>
      <div className="memory-library-heading">
        <h3>Your memories</h3>
        <label>
          Search memories
          <input
            aria-label="Search memories"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            placeholder="Search by title or content"
          />
        </label>
      </div>
      {data.memories
        .filter((m: any) =>
          `${m.title} ${m.text} ${JSON.stringify(m.star)}`
            .toLowerCase()
            .includes(libraryQuery.toLowerCase()),
        )
        .map((m: any) => (
          <details className="evidence-card memory-item" key={m.id}>
            <summary>
              <strong>{m.title}</strong>{' '}
              <span className="tag">
                {m.status === 'CONFIRMED' ? 'Confirmed' : m.status === 'DRAFT' ? 'Draft' : m.status}
              </span>
            </summary>
            <small>
              Version {m.revision} · {m.kind}
              {m.supersedesId ? ' · revised note' : ''}
            </small>
            <p>{m.text}</p>
            {m.kind === 'STAR' &&
              Object.entries(m.star).map(([k, v]) => (
                <p key={k}>
                  <strong>{k}:</strong> {String(v) || 'Not yet known'}
                </p>
              ))}
            <details>
              <summary>Source and applicability</summary>
              <p>
                {m.source.kind} · {m.source.id || 'Self-attested'}
              </p>
              <blockquote>{m.source.quote}</blockquote>
              <p>
                Record: {m.recordId || 'General'} · Application: {m.missionId || 'All'}
              </p>
            </details>
            {m.status === 'CONFIRMED' && onDiscuss && (
              <button className="secondary" onClick={() => onDiscuss(m)}>
                Discuss with my agent
              </button>
            )}
            {m.status === 'DRAFT' && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`/career-memories/${m.id}`, 'PATCH', {
                      revision: m.revision,
                      reviewed: true,
                    });
                    setHits(null);
                    await refresh();
                  })
                }
              >
                Confirm reviewed memory
              </button>
            )}{' '}
            {['DRAFT', 'CONFIRMED'].includes(m.status) && (
              <button
                className="secondary"
                onClick={() => {
                  setEditorOpen(true);
                  setForm({
                    ...empty(),
                    kind: m.kind,
                    title: m.title,
                    text: m.text,
                    star: m.star,
                    recordId: m.recordId || '',
                    missionId: m.missionId || '',
                    source: m.source,
                    supersedesId: m.id,
                  });
                  document
                    .querySelector('.memory-editor')
                    ?.scrollIntoView({ block: 'start', behavior: 'auto' });
                }}
              >
                Edit / correct memory
              </button>
            )}{' '}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (deleteId !== m.id) {
                  setDeleteId(m.id);
                  return;
                }
                void run(async () => {
                  const r = await api(`/career-memories/${m.id}`, 'DELETE', {
                    revision: m.revision,
                  });
                  setNotice(r.notice);
                  setHits(null);
                  await refresh();
                  setDeleteId(null);
                });
              }}
            >
              {deleteId === m.id ? 'Confirm delete memory' : 'Delete memory'}
            </button>
          </details>
        ))}
      <details className="memory-search">
        <summary>Find confirmed evidence</summary>
        <label>
          Evidence search
          <input
            aria-label="Evidence search"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Search within record
          <select
            aria-label="Search within record"
            value={record}
            onChange={(e) => setRecord(e.target.value)}
          >
            <option value="">All records</option>
            {data.records.map((r: any) => (
              <option key={r.id} value={r.id}>
                {r.text.split('\n')[0]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search within application
          <select
            aria-label="Search within application"
            value={application}
            onChange={(e) => setApplication(e.target.value)}
          >
            <option value="">General memories only</option>
            {data.missions.map((m: any) => (
              <option key={m.id} value={m.id}>
                {m.goal}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy || !query.trim()}
          onClick={() =>
            void run(async () =>
              setHits(
                await api(
                  `/career-evidence?q=${encodeURIComponent(query)}${record ? `&recordId=${encodeURIComponent(record)}` : ''}${application ? `&missionId=${encodeURIComponent(application)}` : ''}`,
                ),
              ),
            )
          }
        >
          Search confirmed evidence
        </button>
        {hits && (
          <div role="status">
            <p>{hits.notice}</p>
            <small>
              {hits.strategy} · searched {hits.searched} sources
            </small>
            {hits.hits.map((h: any) => (
              <article className="evidence-card" key={h.id}>
                <code>{h.id}</code>
                <p>{h.text}</p>
                <small>Matched: {h.matched.join(', ')}</small>
              </article>
            ))}
            {hits.semanticStatus === 'unavailable' && (
              <p>
                Related-memory search is temporarily unavailable. Keyword results are shown above.
              </p>
            )}
            {hits.semanticHits?.length > 0 && (
              <section aria-label="Possibly related memories">
                <h4>Possibly related</h4>
                <p>
                  These suggestions may be relevant. Check the original details before using them.
                </p>
                {hits.semanticHits.map((h: any) => (
                  <article className="evidence-card" key={h.id}>
                    <p>{h.text}</p>
                  </article>
                ))}
              </section>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
