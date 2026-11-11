import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AgentAvatar } from './characters.js';

// The Career Coach on Home: advice that belongs to the profile version, not to one run, and the
// next actions across every role on the board. Refreshing makes one counted model call.

type Action = {
  id: string;
  text: string;
  reason: string;
  action: { kind: 'find' | 'tailor' | 'quests' | 'profile' | 'refresh'; applicationId?: string };
};

export function QuestCoach({
  request,
  live,
  boardKey,
  onFind,
  onTailor,
  onQuests,
  onProfile,
}: {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  live: boolean;
  /** Changes when the board changes, so the actions reload. */
  boardKey: string;
  onFind: () => void;
  onTailor: (applicationId: string) => void;
  onQuests: () => void;
  onProfile: () => void;
}) {
  const [coach, setCoach] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    request('/coach')
      .then((c) => current && setCoach(c))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [boardKey]);
  // Hide the tile rather than break Home if the reply is missing or not a Coach overview.
  if (!coach || !Array.isArray(coach.actions)) return null;
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setCoach(await request('/coach/refresh', 'POST'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = (a: Action) => {
    if (a.action.kind === 'refresh') return void refresh();
    if (a.action.kind === 'find') return onFind();
    if (a.action.kind === 'tailor' && a.action.applicationId)
      return onTailor(a.action.applicationId);
    if (a.action.kind === 'profile') return onProfile();
    onQuests();
  };
  const analysis = coach.analysis;
  const highlights = analysis
    ? [
        ['Strength', analysis.strengths?.[0]],
        ['Gap', analysis.gaps?.[0]],
        ['Direction', analysis.directions?.[0]],
      ].filter(([, item]) => item)
    : [];
  return (
    <section className="quest-tile qh-coach" aria-labelledby="qh-coach">
      <div className="quest-tile-head">
        <h2 id="qh-coach">
          <AgentAvatar agent="coach" size={36} label={false} /> Coach
        </h2>
        <span>
          {coach.analysedAt
            ? `Advice for profile v${coach.profileVersion} · ${new Date(coach.analysedAt).toLocaleDateString()}`
            : `Profile v${coach.profileVersion}`}
        </span>
      </div>
      <div className="qh-coach-body">
        <div>
          <h3>Next steps</h3>
          {coach.actions.length ? (
            <ul className="qh-list">
              {coach.actions.map((a: Action) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="qh-quest"
                    disabled={busy && a.action.kind === 'refresh'}
                    onClick={() => run(a)}
                  >
                    <span className="qh-bullet" aria-hidden="true" />
                    <span className="qh-quest-text">
                      <strong>{a.text}</strong>
                      <span>{a.reason}</span>
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="qh-empty">Nothing to chase right now. Find roles when you are ready.</p>
          )}
        </div>
        <div>
          <h3>Advice</h3>
          {highlights.length ? (
            <dl className="qh-advice">
              {highlights.map(([label, item]: any) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{item.text}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="qh-empty">No advice for this profile version yet.</p>
          )}
          <button type="button" className="quest-press ql-go" disabled={busy} onClick={refresh}>
            <RefreshCw size={15} strokeWidth={2.6} />
            {busy ? 'Coach is reading…' : 'Refresh advice'}
          </button>
          <small className="qh-coach-cost">
            {live ? 'One model call on your approved profile.' : 'Rehearsal mode: no model cost.'}
          </small>
          {error && (
            <p role="alert" className="qh-empty">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
