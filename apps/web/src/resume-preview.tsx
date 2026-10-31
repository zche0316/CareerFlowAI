import React, { useEffect, useRef, useState } from 'react';
import { resumeLayout, type ResumeView } from '../../../packages/contracts/src/resume-layout.js';
import type { ResumeChange } from '../../../packages/contracts/src/resume-review.js';
export function ResumePreview({
  content,
  changes = [],
  busy = false,
  onRestore,
}: {
  content: ResumeView;
  changes?: ResumeChange[];
  busy?: boolean;
  onRestore?: (factId: string) => Promise<void>;
}) {
  const [opened, setOpened] = useState('');
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!changes.length) return;
    const first = preview.current?.querySelector<HTMLButtonElement>('[data-resume-change]');
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }, [(content as any).hash]);
  const review = (text: string) => {
    const matching = changes.filter(
      (change) => change.after && (change.after === text || text.includes(change.after)),
    );
    if (!matching.length) return text;
    return (
      <span className="resume-change">
        <button
          type="button"
          className="resume-change-text"
          data-resume-change
          aria-expanded={opened === text}
          onClick={() => setOpened(opened === text ? '' : text)}
        >
          <span className="resume-change-label">Changed</span>
          {text}
        </button>
        {opened === text &&
          matching.map((change) => (
            <span
              className="resume-change-comparison"
              key={change.factId}
              role="group"
              aria-label="Wording comparison"
            >
              <span className="resume-change-label">Before</span>
              <span>{change.before || 'Not included'}</span>
              <span className="resume-change-label">After</span>
              <span>{change.after}</span>
              {onRestore && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void onRestore(change.factId)}
                >
                  Keep original
                </button>
              )}
            </span>
          ))}
      </span>
    );
  };
  return (
    <article ref={preview} className="resume-document" aria-label="Resume preview">
      {changes.length > 0 && (
        <p className="resume-review-status" role="status">
          {changes.length} {changes.length === 1 ? 'change' : 'changes'} to review · Select
          highlighted text to compare.
        </p>
      )}
      {changes
        .filter((c) => !c.after)
        .map((change) => (
          <details className="resume-removed-change" key={change.factId}>
            <summary data-resume-change>Removed from this draft</summary>
            <p>{change.before}</p>
            {onRestore && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void onRestore(change.factId)}
              >
                Keep original
              </button>
            )}
          </details>
        ))}
      <header className="resume-header">
        <h3>{content.name}</h3>
        <p>
          {[
            content.contact?.email,
            content.contact?.phone,
            content.contact?.city,
            content.contact?.linkedin,
            content.contact?.portfolio,
          ]
            .filter(Boolean)
            .join(' | ')}
        </p>
        {content.contact?.workRights && <p>Work rights: {content.contact.workRights}</p>}
        <p>Application target: {content.jobTitle}</p>
      </header>
      {resumeLayout(content).map((section) => (
        <section key={section.title} aria-label={section.title}>
          <h3>{section.title}</h3>
          {section.items.map((item, i) => {
            const [title, ...lines] = item.split('\n');
            return (
              <div className="career-record-card" key={i}>
                {['Skills', 'Career Objective'].includes(section.title) ? (
                  <p>{review(title)}</p>
                ) : (
                  <h4>{review(title)}</h4>
                )}
                {lines
                  .filter((s) => !s.startsWith('• '))
                  .map((s, j) => (
                    <p className="muted" key={j}>
                      {review(s)}
                    </p>
                  ))}
                {lines.some((s) => s.startsWith('• ')) && (
                  <ul>
                    {lines
                      .filter((s) => s.startsWith('• '))
                      .map((s, j) => (
                        <li key={j}>{review(s.slice(2))}</li>
                      ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </article>
  );
}
