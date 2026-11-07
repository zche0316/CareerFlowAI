import { useState } from 'react';
import { RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ResumeReturnTarget } from '../../../packages/contracts/src/index.js';

const labels: Record<string, string> = {
  gap_analyzer: 'Gap Analyzer',
  selector: 'Evidence Selector',
  rewriter: 'Rewriter',
  critic: 'Critic',
  human_review: 'You',
  end: 'Approved',
};

const targets: { value: ResumeReturnTarget; label: string; hint: string }[] = [
  { value: 'selector', label: 'Evidence Selector', hint: 'Choose or order different approved evidence.' },
  { value: 'rewriter', label: 'Rewriter', hint: 'Change wording only; facts stay the same.' },
  { value: 'gap_analyzer', label: 'Gap Analyzer', hint: 'Re-focus on the requirements you name.' },
];

const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);

// Shows how the resume team collaborated and lets the reviewer return the draft to one specialist.
export function ResumeTeamPanel({
  team,
  busy,
  canReturn,
  revisions,
  onReturn,
}: {
  team: any;
  busy: boolean;
  canReturn: boolean;
  revisions: number;
  onReturn: (target: ResumeReturnTarget, feedback: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<ResumeReturnTarget>('selector');
  const [note, setNote] = useState('');
  const critique = team?.critiques?.at(-1);
  const handoffs: any[] = (team?.handoffs || []).slice(-8);
  const limitReached = revisions >= 2;
  const m = critique?.metrics;
  // Rules pass trivially when no requirement has evidence; show that as a warning, not a clean pass.
  const noEvidence = Boolean(m && (m.totalRequirements ?? 0) > 0 && m.supportedRequirements === 0);
  const passed = Boolean(critique?.pass) && !noEvidence;
  const gaps: string[] = team?.gaps?.gaps || [];
  return (
    <section className="resume-team" aria-label="Resume team review">
      <div className="section-heading">
        <h3>Resume team review</h3>
        {critique && (
          <span className={`tag ${passed ? 'success' : 'warning'}`}>
            {passed ? <ShieldCheck size={14} /> : <TriangleAlert size={14} />}
            {passed
              ? 'Critic passed'
              : noEvidence && critique.pass
                ? 'No job evidence'
                : `${critique.issues.length} open issue(s)`}
          </span>
        )}
      </div>
      {critique && (
        <p className="small muted">
          {m.totalRequirements !== undefined &&
            `${m.supportedRequirements} of ${m.totalRequirements} requirements evidenced · `}
          Requirement coverage {pct(critique.metrics.requirementCoverage)} · keyword coverage{' '}
          {pct(critique.metrics.keywordCoverage)} · {critique.metrics.rewrittenClaims} reworded
          {critique.metrics.blockedRewrites ? `, ${critique.metrics.blockedRewrites} kept verbatim` : ''}
        </p>
      )}
      {noEvidence && (
        <p className="small resume-team-warning">
          None of this job's requirements has approved evidence in your profile, so the draft cannot be
          tailored to it. Add or approve relevant experience, or consider a different job.
        </p>
      )}
      {critique?.issues?.length > 0 && (
        <ul className="resume-team-issues">
          {critique.issues.map((i: any, index: number) => (
            <li key={index}>
              <strong>{labels[i.target]}:</strong> {i.message}
            </li>
          ))}
        </ul>
      )}
      {gaps.length > 0 && (
        <div className="small">
          <strong>Not evidenced, so not claimed ({gaps.length}):</strong>
          <ul className="resume-team-gaps">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {handoffs.length > 0 && (
        <ol className="resume-team-timeline" aria-label="Handoffs">
          {handoffs.map((h, index) => (
            <li key={`${h.at}-${index}`}>
              <span className="handoff-route">
                {labels[h.from] || h.from} → {labels[h.to] || h.to}
              </span>
              <span className="small muted">{h.reason}</span>
            </li>
          ))}
        </ol>
      )}
      {canReturn && (
        <form
          className="resume-team-return"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void onReturn(target, note.trim()).then(() => setNote(''));
          }}
        >
          <label>
            Send back to
            <select value={target} onChange={(e) => setTarget(e.target.value as ResumeReturnTarget)}>
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">{targets.find((t) => t.value === target)?.hint}</p>
          <label>
            What should change?
            <textarea
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: lead with the SQL reporting work for this role."
            />
          </label>
          <button className="secondary" type="submit" disabled={busy || limitReached || !note.trim()}>
            <RotateCcw size={15} />
            {limitReached ? 'Revision limit reached' : `Send back (${2 - revisions} left)`}
          </button>
        </form>
      )}
    </section>
  );
}
