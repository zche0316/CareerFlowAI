import React, { useEffect, useRef, useState } from 'react';
import type { RecordKey, ProfileRecord } from '../../../packages/contracts/src/profile-records.js';
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export function ProfileImport({
  api,
  onApply,
  disabled,
}: {
  api: Api;
  disabled: boolean;
  onApply: (records: ({ section: RecordKey } & ProfileRecord)[]) => void;
}) {
  const [source, setSource] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [pages, setPages] = useState<number[]>([]),
    [organizePages, setOrganizePages] = useState<number[]>([]);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void api('/profiles/imports')
      .then((rows) => {
        if (mounted.current && generation.current === 0) setHistory(rows);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  async function run(operation: () => Promise<any>, replace = false) {
    const token = ++generation.current;
    if (replace) {
      setSource(null);
      setPages([]);
      setOrganizePages([]);
      setReviewed(false);
      setConsent(false);
    }
    setBusy(true);
    setReviewed(false);
    setError('');
    try {
      const r = await operation();
      if (!mounted.current || generation.current !== token) return;
      setSource(r);
      setReviewed(false);
      setPages(
        r.pages
          .filter((p: any) => p.route === 'vision')
          .slice(0, 3)
          .map((p: any) => p.page),
      );
      let chars = 0;
      const included: number[] = [];
      for (const p of r.pages) {
        if (!p.text.trim() || p.route === 'vision') continue;
        if (chars + p.text.length > 16000) break;
        chars += p.text.length;
        included.push(p.page);
      }
      const organized = [...r.events]
        .reverse()
        .find((e: any) => e.action === 'proposed' && e.sourcePages);
      setOrganizePages(organized?.sourcePages || included);
      const rows = await api('/profiles/imports').catch(() => null);
      if (rows && mounted.current && generation.current === token) setHistory(rows);
    } catch (e) {
      if (mounted.current && generation.current === token) {
        setError((e as Error).message);
        if (!replace && source?.id) {
          const latest = await api('/profiles/imports/' + source.id).catch(() => null);
          if (latest && mounted.current && generation.current === token) setSource(latest);
        }
      }
    } finally {
      if (mounted.current && generation.current === token) setBusy(false);
    }
  }
  return (
    <section className="sharing import-panel">
      <h3>Import an existing resume</h3>
      <p>
        PDF, UTF-8 TXT, PNG or JPEG · up to 4 MB and 10 PDF pages. Text extraction runs locally on
        this server. Importing never approves or replaces your profile.
      </p>
      <label>
        Resume file
        <input
          aria-label="Resume file"
          type="file"
          accept=".pdf,.txt,.png,.jpg,.jpeg"
          disabled={busy || disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setSource(null);
            setPages([]);
            setOrganizePages([]);
            setReviewed(false);
            setConsent(false);
            if (f.size > 4 * 1024 * 1024) {
              setError('Choose a file up to 4 MB.');
              return;
            }
            setConsent(false);
            void run(async () => {
              const data = new Uint8Array(await f.arrayBuffer());
              let binary = '';
              for (let i = 0; i < data.length; i += 32768)
                binary += String.fromCharCode(...data.subarray(i, i + 32768));
              return api('/profiles/imports', 'POST', {
                filename: f.name,
                mime: f.type || (f.name.endsWith('.txt') ? 'text/plain' : 'application/pdf'),
                base64: btoa(binary),
              });
            }, true);
          }}
        />
      </label>
      {history.length > 0 && (
        <label>
          Saved imports
          <select
            aria-label="Saved imports"
            disabled={busy || disabled}
            value={source?.id || ''}
            onChange={(e) => {
              if (e.target.value) {
                setConsent(false);
                void run(() => api('/profiles/imports/' + e.target.value), true);
              }
            }}
          >
            <option value="">Select an import</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {h.filename} · {h.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {busy && <p role="status">Processing your import… Your approved profile is unchanged.</p>}
      {source && (
        <>
          <h4>
            {source.filename} ·{' '}
            {source.status === 'READY_FOR_REVIEW' && !source.proposed.records.length
              ? 'NEEDS_CORRECTION'
              : source.status}
          </h4>
          <p role="status">
            Current file: {source.pages.length} page(s). This view contains only this import; saved
            imports are separate.
          </p>
          <p className="info">
            {source.proposed.records.length
              ? 'Next: compare the proposed records with the source, then add them to the editable profile below. Review and approve the full profile separately.'
              : source.pages.some((p: any) => p.route === 'text')
                ? 'Text is available. Qwen is optional: check the text preview, select source pages below, then organize the text into records.'
                : 'No readable text yet. Select pages and allow visual recognition, or continue manually.'}
          </p>
          <p className="small muted">
            Router: local text first · Text: {source.router.lightModel} · Vision:{' '}
            {source.router.visionModel} · {source.calls}/8 model calls
          </p>
          {source.pages.map((p: any) => (
            <details key={`${source.id}:${p.page}`} open={source.pages.length === 1}>
              <summary>
                Page {p.page} · {p.method} ·{' '}
                {p.route === 'vision' ? 'visual recognition suggested' : 'text available'}
              </summary>
              <pre className="source-preview">{p.text || 'No readable text extracted.'}</pre>
              <p className="small muted">{p.warning}</p>
            </details>
          ))}
          <p>
            For columns or incorrect reading order, select pages for visual recognition. At most
            three pages are sent per request.
          </p>
          <div>
            {source.pages.map((p: any) => (
              <label className="checkbox" key={p.page}>
                <input
                  type="checkbox"
                  checked={pages.includes(p.page)}
                  disabled={busy || disabled || (!pages.includes(p.page) && pages.length >= 3)}
                  onChange={(e) =>
                    setPages(
                      e.target.checked ? [...pages, p.page] : pages.filter((n) => n !== p.page),
                    )
                  }
                />
                Recognize page {p.page}
              </label>
            ))}
          </div>
          <h4>Source pages for record organization</h4>
          <p>
            For a bilingual resume, choose one language version to avoid duplicate records. Up to
            16,000 characters per request; long files start with the first text pages that fit.
          </p>
          {source.pages.map((p: any) => (
            <label className="checkbox" key={`organize-${source.id}-${p.page}`}>
              <input
                type="checkbox"
                checked={organizePages.includes(p.page)}
                disabled={busy || disabled || !p.text.trim()}
                onChange={(e) => {
                  setOrganizePages(
                    e.target.checked
                      ? [...organizePages, p.page]
                      : organizePages.filter((n) => n !== p.page),
                  );
                  setReviewed(false);
                }}
              />
              Include page {p.page} in record organization · {p.text.length.toLocaleString()}{' '}
              characters
            </label>
          ))}
          <p role="status">
            Selected organization pages: {organizePages.join(', ') || 'none'} ·{' '}
            {source.pages
              .filter((p: any) => organizePages.includes(p.page))
              .reduce((n: number, p: any) => n + p.text.length, 0)
              .toLocaleString()}{' '}
            / 16,000 characters
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || disabled}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I allow the selected page images or extracted resume text to be sent to the configured
            model provider for this import.
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || disabled || !consent || !pages.length || source.calls >= 8}
              onClick={() =>
                void run(() =>
                  api(`/profiles/imports/${source.id}/recognize`, 'POST', { consent: true, pages }),
                )
              }
            >
              Recognize selected pages with Qwen
            </button>
            <button
              type="button"
              className="secondary"
              disabled={
                busy ||
                disabled ||
                !consent ||
                !organizePages.length ||
                source.pages
                  .filter((p: any) => organizePages.includes(p.page))
                  .reduce((n: number, p: any) => n + p.text.length, 0) > 16000 ||
                source.calls >= 8
              }
              onClick={() =>
                void run(() =>
                  api(`/profiles/imports/${source.id}/structure`, 'POST', {
                    consent: true,
                    pages: organizePages,
                  }),
                )
              }
            >
              Organize extracted text into records
            </button>
          </div>
          {source.mode !== 'openai' && (
            <p className="small muted">
              Live AI is disabled. Local extraction works; enable PROVIDER_MODE=openai on the server
              to organize or recognize. You can copy the preview into the manual form.
            </p>
          )}
          {source.proposed.records.length > 0 && (
            <>
              <h4>Proposed records · not approved</h4>
              {source.proposed.records.map((r: any) => (
                <div className="profile-record" key={r.id}>
                  <strong>
                    {
                      {
                        workExperiences: 'Work experience',
                        projects: 'Project',
                        educations: 'Education',
                      }[r.section as RecordKey]
                    }{' '}
                    · {r.title}
                  </strong>
                  <p>
                    {r.organisation} · {r.startMonth || 'Unknown start'} –{' '}
                    {r.current ? 'Present' : r.endMonth || 'Unknown end'}
                  </p>
                  {r.details.map((d: string, i: number) => (
                    <p key={i}>{d}</p>
                  ))}
                  {r.evidence.map((e: any, i: number) => (
                    <blockquote key={i}>
                      Page {e.page}: {e.quote}
                    </blockquote>
                  ))}
                </div>
              ))}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || disabled}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I compared these proposed records with the source preview.
              </label>
              <button
                type="button"
                className="secondary"
                disabled={busy || disabled || !reviewed || Boolean(error)}
                onClick={() => {
                  onApply(source.proposed.records);
                  setReviewed(false);
                }}
              >
                Add proposed records to editable profile
              </button>
            </>
          )}
          {source.proposed.questions.map((q: string) => (
            <p key={q}>{q}</p>
          ))}
          {source.proposed.rejected.length > 0 && (
            <p role="status">
              Excluded {source.proposed.rejected.length} records that failed source/date validation.
              This does not mean your resume is false. Check the details below, choose the correct
              source pages, or add verified information manually.
            </p>
          )}
          {source.proposed.repairs?.length > 0 && (
            <details open>
              <summary>Fields needing your confirmation</summary>
              <p>
                Source-supported record content was retained. These model-suggested values were
                omitted because their quotes do not support them. Add them manually only if you can
                confirm them.
              </p>
              {source.proposed.repairs.map((r: any, i: number) => (
                <div key={i}>
                  <strong>{r.title}</strong>
                  {r.fields.map((f: any, j: number) => (
                    <p key={j}>
                      {f.field}: “{f.value}”
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
          {source.proposed.rejectedDetails?.length > 0 && (
            <details>
              <summary>Why records were excluded</summary>
              {source.proposed.rejectedDetails.map((r: any, i: number) => (
                <div key={i}>
                  <strong>{r.title}</strong>
                  <ul>
                    {r.reasons.map((reason: string) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {r.fields?.map((f: any, i: number) => (
                    <p key={i}>
                      <strong>{f.field}</strong>: “{f.value}” — not found in this record’s cited
                      excerpts.
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
          <details>
            <summary>Import activity and model usage</summary>
            {source.events.map((event: any, i: number) => (
              <p key={i}>
                {event.agent} · {event.action}
                {event.page ? ` · page ${event.page}` : ''}
                {event.sourcePages ? ` · source pages ${event.sourcePages.join(', ')}` : ''}
                {event.model
                  ? ` · ${event.model} · ${event.inputTokens} input / ${event.outputTokens} output tokens`
                  : ''}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
