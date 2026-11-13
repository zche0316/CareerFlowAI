import { useState } from 'react';
import { ArrowRight, CircleHelp } from 'lucide-react';
import { AgentAvatar } from './characters.js';

// The run's one evidence question (CFS-123): required skills with no approved evidence. Each
// answer is saved as a career memory; only confirmed answers are used in this resume.

type Answer = { text: string; recordId: string; confirmed: boolean };

export function EvidenceQuestion({
  question,
  busy,
  onSubmit,
}: {
  question: { skills: string[]; records?: { id: string; label: string }[] };
  busy: boolean;
  onSubmit: (
    answers: { skill: string; text: string; recordId: string | null; confirmed: boolean }[],
  ) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const records = question.records || [];
  const blank: Answer = { text: '', recordId: '', confirmed: false };
  const set = (skill: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [skill]: { ...blank, ...a[skill], ...patch } }));
  const filled = question.skills.filter((s) => answers[s]?.text.trim());
  const submit = () =>
    onSubmit(
      filled.map((skill) => ({
        skill,
        text: answers[skill].text.trim(),
        recordId: answers[skill].recordId || null,
        confirmed: answers[skill].confirmed,
      })),
    );
  return (
    <section className="panel quest-tile evidence-question" aria-labelledby="evidence-question">
      <div className="evidence-head">
        <AgentAvatar agent="gap_analyzer" size={48} label={false} />
        <div>
          <span className="quest-sub dark">GAP ANALYZER · ONE QUESTION</span>
          <h2 id="evidence-question">Have you used these?</h2>
          <p>
            The role requires {question.skills.length === 1 ? 'this' : 'these'}, and your approved
            profile has no evidence for {question.skills.length === 1 ? 'it' : 'them'}. If you have
            real experience, say where and what you did. Leave one empty to skip it; it stays a gap.
          </p>
        </div>
      </div>
      {question.skills.map((skill, i) => {
        const a = answers[skill];
        return (
          <fieldset key={skill} className="evidence-skill">
            <legend>
              <CircleHelp size={16} aria-hidden="true" /> {skill}
            </legend>
            <label>
              Where and how did you use it?
              <textarea
                aria-label={`Your experience with ${skill}`}
                value={a?.text || ''}
                maxLength={1500}
                placeholder="For example: in my capstone project I built weekly dashboards for the client team."
                onChange={(e) => set(skill, { text: e.target.value })}
              />
            </label>
            {records.length > 0 && (
              <label>
                Which experience was it?
                <select
                  aria-label={`Experience for ${skill}`}
                  value={a?.recordId || ''}
                  onChange={(e) => set(skill, { recordId: e.target.value })}
                >
                  <option value="">Not in my profile (list it with my skills)</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                id={`evidence-confirm-${i}`}
                checked={Boolean(a?.confirmed)}
                disabled={!a?.text.trim()}
                onChange={(e) => set(skill, { confirmed: e.target.checked })}
              />
              This is true. Use it in this resume and save it as a confirmed career memory.
            </label>
          </fieldset>
        );
      })}
      <p className="muted">
        Unconfirmed answers are kept as draft career memories for you to review later; they are not
        used in this resume.
      </p>
      <div className="evidence-actions">
        <button
          type="button"
          className="quest-press lime"
          disabled={busy || !filled.length}
          onClick={submit}
        >
          Continue with my answers <ArrowRight size={16} strokeWidth={2.6} />
        </button>
        <button type="button" className="quest-press" disabled={busy} onClick={() => onSubmit([])}>
          Skip, keep them as gaps
        </button>
      </div>
    </section>
  );
}
