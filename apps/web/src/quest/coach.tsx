import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { AgentAvatar } from './characters.js';
import { reloadEstimates, RunEstimate } from './run-estimate.js';

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
  boardKey,
  onFind,
  onTailor,
  onQuests,
  onProfile,
  onOpen,
}: {
  onOpen?: () => void;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
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
      reloadEstimates();
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
                  <dd>{adviceItem(item).text}</dd>
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
          <RunEstimate kind="coach" className="qh-coach-cost" />
          {onOpen && (
            <button type="button" className="auth-switch" onClick={onOpen}>
              Open the Coach: full advice and what to revisit
            </button>
          )}
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

// Older saved analyses hold plain strings; current ones hold { text, reason, evidenceIds }.
export const adviceItem = (item: any) =>
  typeof item === 'string'
    ? { text: item, reason: '', evidenceIds: [] as string[] }
    : {
        text: String(item?.text || ''),
        reason: String(item?.reason || ''),
        evidenceIds: item?.evidenceIds || [],
      };

const sections: [key: string, title: string][] = [
  ['strengths', 'Strengths to build on'],
  ['gaps', 'Development opportunities'],
  ['directions', 'Suitable career directions'],
  ['actions', 'Recommended actions'],
];

/**
 * The Coach page (CFS-121): the workspace's career advice for the current profile version, with
 * the reason and evidence behind each point, and a request to revisit that refreshes the advice.
 * It replaces the analysis step that every run used to repeat.
 */
export function CoachPage({
  request,
  onProfile,
}: {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onProfile: () => void;
}) {
  const [coach, setCoach] = useState<any>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/coach')
      .then(setCoach)
      .catch((e) => setError((e as Error).message));
  }, []);
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setCoach(await request('/coach/refresh', 'POST', { feedback }));
      reloadEstimates();
      setFeedback('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!coach && !error) return <p className="quest-fine dark">Loading your Coach…</p>;
  if (!coach || typeof coach !== 'object' || Array.isArray(coach))
    return (
      <section className="quest-tile">
        <p role="alert">{error}</p>
      </section>
    );
  const a = coach.analysis;
  const actions: Action[] = Array.isArray(coach.actions) ? coach.actions : [];
  return (
    <div className="quest-page coach-page">
      <div className="ql-head">
        <div>
          <span className="quest-sub dark">
            {coach.analysedAt
              ? `Advice for profile v${coach.profileVersion} · ${new Date(coach.analysedAt).toLocaleDateString()}`
              : `Profile v${coach.profileVersion}`}
          </span>
          <h1 className="quest-display">Your Coach</h1>
          <p>
            Advice for your whole career search, from your approved profile and the roles you
            pursue. Every point cites your own evidence.
          </p>
        </div>
        <AgentAvatar agent="coach" size={72} />
      </div>
      <div className="coach-grid">
        <section className="quest-tile" aria-labelledby="coach-advice">
          <h2 id="coach-advice">Career direction</h2>
          {!a ? (
            <p className="qh-empty">No advice for this profile version yet. Ask the Coach below.</p>
          ) : (
            sections.map(([key, title]) =>
              a[key]?.length ? (
                <div key={key} className="coach-section">
                  <h3>{title}</h3>
                  <ul>
                    {a[key].map(adviceItem).map((item: ReturnType<typeof adviceItem>) => (
                      <li key={item.text}>
                        {item.text}
                        {item.reason && (
                          <details>
                            <summary>Why this fits</summary>
                            <p>{item.reason}</p>
                            <CoachCitations ids={item.evidenceIds} sources={coach.sources} />
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )
          )}
        </section>
        <aside className="quest-tile coach-ask" aria-labelledby="coach-ask">
          <h2 id="coach-ask">Ask the Coach again</h2>
          <label>
            What should the Coach revisit?
            <textarea
              value={feedback}
              maxLength={2000}
              placeholder="For example: focus on data engineering roles, or explain why a direction fits."
              onChange={(e) => setFeedback(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="quest-press lime ql-go"
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw size={15} strokeWidth={2.6} />
            {busy ? 'Coach is reading…' : 'Refresh advice'}
          </button>
          <RunEstimate kind="coach" />
          <small className="muted">The previous advice stays saved.</small>
          {error && <p role="alert">{error}</p>}
          <button type="button" className="auth-switch" onClick={onProfile}>
            Add evidence to my profile
          </button>
          {actions.length > 0 && (
            <>
              <h3>Next steps</h3>
              <ul className="coach-next">
                {actions.map((x: Action) => (
                  <li key={x.id}>
                    <strong>{x.text}</strong>
                    <span>{x.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
      {coach.sources?.docs?.length > 0 && (
        <p className="coach-attribution small muted">{coach.sources.attribution}</p>
      )}
    </div>
  );
}

// Your evidence and the public sources a point cites, kept apart (CFS-125).
function CoachCitations({ ids, sources }: { ids: string[]; sources: any }) {
  const facts = ids.filter((id) => !id.startsWith('onet:'));
  const refs = ids
    .filter((id) => id.startsWith('onet:'))
    .map((id) => sources?.docs?.find((d: any) => d.id === id))
    .filter(Boolean);
  return (
    <>
      {facts.length > 0 && <small className="muted">Your evidence: {facts.join(', ')}</small>}
      {refs.length > 0 && (
        <small className="coach-refs">
          Source:{' '}
          {refs.map((d: any, i: number) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <a href={d.url} target="_blank" rel="noopener noreferrer">
                {d.title} (O*NET)
              </a>
            </span>
          ))}
        </small>
      )}
    </>
  );
}
