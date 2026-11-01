import React, { useEffect, useState } from 'react';
import { visibleResumeText } from '../../../packages/contracts/src/resume-review.js';
export function ResumeManualEdit({
  draft,
  busy,
  onSave,
  onDirty,
}: {
  draft: any;
  busy: boolean;
  onSave: (factId: string, text: string) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const claims = draft.claims || [];
  const [id, setId] = useState(claims[0]?.factId || '');
  const claim = claims.find((c: any) => c.factId === id) || claims[0];
  const original = claim ? visibleResumeText(claim) : '';
  const [text, setText] = useState(original);
  const dirty = text !== original;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  useEffect(() => {
    setText(original);
  }, [draft.hash, id]);
  return (
    <details className="resume-manual-editor">
      <summary>Edit wording yourself</summary>
      <p className="small muted">
        Edit a statement below, then review its highlighted change. Keep facts unchanged; update My
        profile first to add new experience.
      </p>
      <label>
        Resume statement
        <select
          aria-label="Resume statement"
          value={claim?.factId || ''}
          disabled={busy || dirty || !claim}
          onChange={(e) => setId(e.target.value)}
        >
          {claims.map((c: any) => (
            <option key={c.factId} value={c.factId}>
              {visibleResumeText(c).slice(0, 100)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Your wording
        <textarea
          aria-label="Your wording"
          value={text}
          disabled={busy || !claim}
          rows={5}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button
          className="secondary"
          disabled={busy || !claim || !dirty || !text.trim()}
          onClick={() => void onSave(claim.factId, text.trim())}
        >
          Apply wording change
        </button>
        <button className="text-button" disabled={busy || !dirty} onClick={() => setText(original)}>
          Discard edit
        </button>
      </div>
    </details>
  );
}
