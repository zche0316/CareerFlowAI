import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ResumeReturnTarget } from '../../../../packages/contracts/src/index.js';
import { AgentAvatar, LeaderBadge, agentProfiles, type AgentId } from './characters.js';

type Team = {
  gaps?: { gaps?: string[] };
  handoffs?: { at: string; from: string; to: string; reason: string }[];
  critiques?: {
    pass: boolean;
    issues: { target: string; message: string }[];
    metrics: {
      requirementCoverage: number | null;
      keywordCoverage: number | null;
      rewrittenClaims: number;
      blockedRewrites: number;
      totalRequirements?: number;
      supportedRequirements?: number;
    };
  }[];
};

const members: AgentId[] = ['gap_analyzer', 'selector', 'rewriter', 'critic'];

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : `${Math.round(v * 100)}%`;

// A rules pass with zero supported requirements is not a real pass; say so.
export function critiqueState(team: Team | undefined) {
  const critique = team?.critiques?.at(-1);
  const m = critique?.metrics;
  const noEvidence = Boolean(m && (m.totalRequirements ?? 0) > 0 && m.supportedRequirements === 0);
  return { critique, metrics: m, noEvidence, passed: Boolean(critique?.pass) && !noEvidence };
}

/** The party's work for this draft: who did what, in order, including Critic returns. */
export function PartyTrack({ team, waiting }: { team: Team; waiting: boolean }) {
  const handoffs = team.handoffs || [];
  const critiques = team.critiques || [];
  const runs = (id: string) => handoffs.filter((h) => h.from === id).length;
  const latest = (id: string) => [...handoffs].reverse().find((h) => h.from === id)?.reason;
  const returned = critiques.filter((c) => !c.pass);
  return (
    <section className="quest-track" aria-labelledby="party-track-title">
      <div className="quest-track-head">
        <h2 id="party-track-title">How your party worked it out</h2>
        <span>
          {handoffs.length} handoffs · {critiques.length} Critic round
          {critiques.length === 1 ? '' : 's'}
        </span>
      </div>
      <ol className="quest-members">
        {members.map((id) => {
          const isCritic = id === 'critic';
          const text = isCritic
            ? returned.length
              ? `Sent it back ${returned.length}× (“${returned[0].issues[0]?.message ?? 'needs work'}”), then ${critiques.at(-1)?.pass ? 'passed it.' : 'escalated to you.'}`
              : critiques.length > 1
                ? `Passed all ${critiques.length} reviews, including your revision.`
                : critiques.length
                  ? 'Passed it on the first look.'
                  : 'Waiting for a draft.'
            : latest(id) || 'Not started yet.';
          return (
            <li key={id} className="quest-member">
              <AgentAvatar agent={id} size={56} outline="#fff" />
              <strong>
                {agentProfiles[id].name}
                {runs(id) > 1 && <span className="quest-runs"> ×{runs(id)}</span>}
              </strong>
              <span className={`quest-bubble${isCritic && returned.length ? ' lime' : ''}`}>
                {text}
              </span>
            </li>
          );
        })}
        <li className="quest-member">
          <span className="quest-you" aria-hidden="true">
            You
          </span>
          <strong>You</strong>
          <span className="quest-bubble light">
            {waiting ? 'Approve, or send it back to one teammate.' : 'Decision recorded.'}
          </span>
        </li>
      </ol>
    </section>
  );
}

/** Critic's scorecard plus the human decision: approve this exact draft, or return it. */
export function PartyDecision({
  team,
  userName,
  waiting,
  busy,
  approveBlocked,
  revisions,
  onApprove,
  onReturn,
}: {
  team: Team;
  userName: string;
  waiting: boolean;
  busy: boolean;
  approveBlocked: boolean;
  revisions: number;
  onApprove: () => Promise<void>;
  onReturn: (target: ResumeReturnTarget, feedback: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<ResumeReturnTarget>('selector');
  const [note, setNote] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const { critique, metrics: m, noEvidence, passed } = critiqueState(team);
  const gaps = team.gaps?.gaps || [];
  const left = Math.max(0, 2 - revisions);
  return (
    <div className="quest-side">
      {critique && m && (
        <section className="quest-score" aria-labelledby="score-title">
          <div className="quest-score-head">
            <h3 id="score-title">Critic’s scorecard</h3>
            <span className={`quest-chip ${passed ? 'lime' : 'coral'}`}>
              {passed ? 'Passed' : noEvidence ? 'No job evidence' : `${critique.issues.length} open`}
            </span>
          </div>
          <div className="quest-score-grid">
            <div>
              <b>
                {m.supportedRequirements ?? '–'}/{m.totalRequirements ?? '–'}
              </b>
              <span>requirements with your evidence</span>
            </div>
            <div>
              <b>{pct(m.keywordCoverage)}</b>
              <span>keywords present</span>
            </div>
            <div>
              <b>{m.rewrittenClaims}</b>
              <span>lines reworded</span>
            </div>
            <div>
              <b>{m.blockedRewrites}</b>
              <span>rewrites blocked by the guard</span>
            </div>
          </div>
          {critique.issues.length > 0 && (
            <ul className="quest-issues">
              {critique.issues.map((issue, index) => (
                <li key={index}>
                  <strong>{agentProfiles[issue.target as AgentId]?.name ?? issue.target}:</strong>{' '}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {noEvidence && (
            <p className="quest-note coral">
              None of this job’s requirements has approved evidence yet. Add experience to your
              profile, or pick a different job.
            </p>
          )}
          {gaps.length > 0 && (
            <p className="quest-note">
              <strong>Not claimed:</strong> {gaps.join(', ')}. No approved evidence, so it stays a gap
              instead of a resume line.
            </p>
          )}
        </section>
      )}

      {waiting && (
        <section className="quest-call" aria-labelledby="call-title">
          <h3 id="call-title">Your call</h3>
          <label className="quest-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I read this exact draft.
          </label>
          <button
            type="button"
            className="quest-press lime"
            disabled={!reviewed || busy || approveBlocked}
            onClick={() => void onApprove()}
          >
            <Check size={18} strokeWidth={2.8} />
            Approve this draft
          </button>
          <form
            className="quest-return"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) void onReturn(target, note.trim()).then(() => setNote(''));
            }}
          >
            <fieldset>
              <legend>Or send it back to</legend>
              <div className="quest-picks">
                {(['selector', 'rewriter', 'gap_analyzer'] as const).map((id) => (
                  <label key={id} className={`quest-pick${target === id ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="return-target"
                      value={id}
                      checked={target === id}
                      onChange={() => setTarget(id)}
                    />
                    <AgentAvatar agent={id} size={40} label={false} />
                    {agentProfiles[id].name.replace('Evidence ', '')}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="quest-field">
              What should change?
              <textarea
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Lead with the reporting project for this role."
              />
            </label>
            <button
              type="submit"
              className="quest-press"
              disabled={busy || left === 0 || !note.trim()}
            >
              <RotateCcw size={16} />
              {left === 0 ? 'Revision limit reached' : `Send back · ${left} left`}
            </button>
          </form>
          <p className="quest-fine">
            <LeaderBadge name={userName} size={22} /> Only you can approve. Agents can’t.
          </p>
        </section>
      )}
    </div>
  );
}
