import React, { useEffect, useState } from 'react';
export function ResumeSelection({
  draft,
  busy,
  onSave,
  onDirty,
}: {
  draft: any;
  busy: boolean;
  onSave: (ids: string[]) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [ids, setIds] = useState<string[]>(draft.claims.map((c: any) => c.factId));
  useEffect(() => {
    setIds(draft.claims.map((c: any) => c.factId));
    onDirty(false);
  }, [draft.hash]);
  const candidates = [
    ...draft.claims.map((c: any) => ({ ...c, id: c.factId })),
    ...(draft.omittedFacts || []),
  ].filter(
    (c: any, i: number, all: any[]) =>
      !/^none yet$/i.test(c.text) && all.findIndex((f) => f.id === c.id) === i,
  );
  const change = (next: string[]) => {
    setIds(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(draft.claims.map((c: any) => c.factId)));
  };
  return (
    <details className="profile-assistant">
      <summary>Choose and order source statements for this job</summary>
      <p>
        The complete career library is unchanged. Role/date headers are included with selected
        statements. Save your selection, then review the new draft before approval.
      </p>
      {candidates.map((c: any) => (
        <label className="checkbox" key={c.id}>
          <input
            type="checkbox"
            aria-label={`Include source ${c.id}`}
            disabled={busy}
            checked={ids.includes(c.id)}
            onChange={(e) =>
              change(e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))
            }
          />
          {c.text}
        </label>
      ))}
      <ol>
        {ids.map((id, i) => (
          <li key={id}>
            {candidates.find((c: any) => c.id === id)?.text}
            <button
              className="secondary"
              disabled={busy || i === 0}
              aria-label={`Move selected statement ${i + 1} up`}
              onClick={() => {
                const next = [...ids];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                change(next);
              }}
            >
              Move up
            </button>
          </li>
        ))}
      </ol>
      <button
        className="secondary"
        disabled={busy || !ids.length || ids.length > 20}
        onClick={() => void onSave(ids)}
      >
        Save job-specific content selection
      </button>
    </details>
  );
}
