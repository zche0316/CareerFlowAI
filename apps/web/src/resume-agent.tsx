import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

export function ResumeAgent({
  draft,
  messages,
  busy,
  onEdit,
}: {
  draft: any;
  messages: { role: string; text: string }[];
  busy: boolean;
  onEdit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMessage('');
  }, [draft.hash]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length, busy]);
  const suggestions = [
    'Emphasise my most relevant experience',
    'Make this more concise',
    'Highlight my personal contributions',
  ];
  return (
    <section className="resume-agent" aria-label="Resume agent">
      <div className="resume-agent-messages" ref={log} role="log" aria-live="polite">
        {!messages.length && (
          <p className="muted">
            Your draft is ready for {draft.jobTitle}. What would you like to change?
          </p>
        )}
        {messages.map((entry, i) => (
          <div key={i} className={`resume-chat-${entry.role}`}>
            <strong>{entry.role === 'user' ? 'You' : 'Resume agent'}</strong>
            <p>{entry.text}</p>
          </div>
        ))}
        {busy && <p role="status">Updating your resume…</p>}
      </div>
      {!messages.length && (
        <div className="resume-agent-suggestions">
          {suggestions.map((text) => (
            <button
              className="secondary"
              key={text}
              disabled={busy}
              onClick={() => void onEdit(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (message.trim() && !busy) {
            void onEdit(message.trim());
          }
        }}
      >
        <label htmlFor="resume-message">Ask for a change</label>
        <textarea
          id="resume-message"
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="E.g. Focus on my logistics internship and shorten the introduction."
          rows={3}
        />
        <div className="resume-agent-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onEdit(
                'Refine the wording throughout this resume. Keep every fact, number and scope qualifier unchanged.',
              )
            }
          >
            <Sparkles size={15} />
            Refine wording
          </button>
          <button
            className="primary"
            disabled={busy || !message.trim()}
            aria-label="Send resume message"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
    </section>
  );
}
