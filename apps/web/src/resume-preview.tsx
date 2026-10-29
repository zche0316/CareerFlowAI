import React from 'react';
import { resumeLayout, type ResumeView } from '../../../packages/contracts/src/resume-layout.js';
export function ResumePreview({ content }: { content: ResumeView }) {
  return (
    <article className="resume-document" aria-label="Resume preview">
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
                  <p>{title}</p>
                ) : (
                  <h4>{title}</h4>
                )}
                {lines
                  .filter((s) => !s.startsWith('• '))
                  .map((s, j) => (
                    <p className="muted" key={j}>
                      {s}
                    </p>
                  ))}
                {lines.some((s) => s.startsWith('• ')) && (
                  <ul>
                    {lines
                      .filter((s) => s.startsWith('• '))
                      .map((s, j) => (
                        <li key={j}>{s.slice(2)}</li>
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
