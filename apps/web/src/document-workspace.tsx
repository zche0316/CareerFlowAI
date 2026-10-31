import React, { useState } from 'react';
import { FileText, Download, Sparkles } from 'lucide-react';
import { ResumePreview } from './resume-preview.js';
import { WordingStudio } from './resume-wording.js';
import type { Request } from './profile-conversation.js';
export function DocumentWorkspace({
  resumes,
  api,
  onSaved,
}: {
  resumes: any[];
  api: Request;
  onSaved: () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState(''),
    [polish, setPolish] = useState(false);
  const resume = resumes.find((r) => r.id === selected) || resumes[0];
  if (!resume)
    return (
      <div className="empty-state">
        <FileText size={26} />
        <h2>No saved resumes yet</h2>
        <p>Approve a tailored resume to keep it here.</p>
      </div>
    );
  return (
    <div className="document-workspace">
      <nav className="document-version-list" aria-label="Saved resume versions">
        {resumes.map((r) => (
          <button
            key={r.id}
            aria-current={r.id === resume.id ? 'true' : undefined}
            onClick={() => {
              setSelected(r.id);
              setPolish(false);
            }}
          >
            <FileText size={16} />
            <span>
              <strong>{r.content.jobTitle}</strong>
              <small>
                {new Date(r.approvedAt).toLocaleDateString('en-AU')} · Profile v
                {r.content.profileVersion}
              </small>
            </span>
          </button>
        ))}
      </nav>
      <section className="document-selected" aria-label="Selected resume">
        <header className="document-actions">
          <div>
            <h2>{resume.content.jobTitle}</h2>
            <span>Approved version · Profile v{resume.content.profileVersion}</span>
          </div>
          <button className="secondary" aria-expanded={polish} onClick={() => setPolish(!polish)}>
            <Sparkles size={15} />
            Polish wording
          </button>
          <details className="download-formats">
            <summary>
              <Download size={15} />
              Download
            </summary>
            <div>
              {['pdf', 'docx', 'txt'].map((format) => (
                <a key={format} href={`/api/resumes/${resume.id}/download?format=${format}`}>
                  Download {format.toUpperCase()}
                </a>
              ))}
            </div>
          </details>
        </header>
        {polish && (
          <WordingStudio
            api={api}
            resume={resume}
            onSaved={onSaved}
            onClose={() => setPolish(false)}
          />
        )}
        <ResumePreview content={resume.content} />
      </section>
    </div>
  );
}
