import { useState } from 'react';
import { MISSION_MODEL_CALL_LIMIT } from '../../../../packages/contracts/src/mission-limits.js';
import { AgentAvatar, LeaderBadge, type AgentId } from './characters.js';

type Event = { at: string; agent: string; action: string; detail: string };

const agentIds: Record<string, AgentId> = {
  'Career Coach': 'coach',
  'Job Matcher': 'matcher',
  Scout: 'scout',
  'Gap Analyzer': 'gap_analyzer',
  'Evidence Selector': 'selector',
  'Resume Tailor': 'selector',
  Rewriter: 'rewriter',
  Critic: 'critic',
  'Interview Coach': 'interviewer',
};

const roleNames: Record<string, string> = {
  resume: 'Evidence Selector',
  rewrite: 'Rewriter',
  critic: 'Critic',
  coach: 'Career Coach',
  questions: 'Interview Coach',
  feedback: 'Interview Coach',
  interview: 'Interview Coach',
  matcher: 'Job Matcher',
};

type Filter = 'all' | 'critic' | 'rewriter' | 'guards' | 'you';
const filterLabels: Record<Filter, string> = {
  all: 'All',
  critic: 'Critic',
  rewriter: 'Rewriter',
  guards: 'Guards',
  you: 'Your decisions',
};

// Actions that mean a check stopped or sent back work.
const isYou = (e: Event) => e.agent === 'Job Seeker';
// A check stopped or sent back agent work. Your own returns are decisions, not guards.
const guardAction = (e: Event) =>
  !isYou(e) &&
  e.action !== 'handoff' &&
  (['returned', 'skipped', 'failed', 'blocked', 'rejected'].includes(e.action) ||
    /\bblocked\b|guard|verbatim because|could not be verified/i.test(e.detail));

const verb: Record<string, string> = {
  tool: 'used a tool',
  context: 'read approved context',
  completed: 'finished',
  passed: 'passed the draft',
  returned: 'sent it back',
  skipped: 'held back',
  handoff: 'handed off',
  mapped: 'mapped requirements',
  failed: 'hit an error',
  queued: 'queued the quest',
};

const clock = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Mini({ e }: { e: Event }) {
  if (isYou(e)) return <span className="bl-mini you" aria-hidden="true" />;
  const id = agentIds[e.agent];
  if (!id) return <span className="bl-mini system" aria-hidden="true" />;
  return <AgentAvatar agent={id} size={28} label={false} />;
}

/** Battle log: the mission's event trail with usage totals and guard interventions. */
export function QuestBattleLog({ mission: m, userName }: { mission: any; userName: string }) {
  const d = m.data || {};
  // Tool and context events record the model role key; show the party member instead.
  const events: Event[] = ((m.events || []) as Event[]).map((e) => ({
    ...e,
    agent: roleNames[e.agent] || e.agent,
  }));
  const ordered = [...events].reverse();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState(0);
  const shown = ordered.filter((e) =>
    filter === 'all'
      ? true
      : filter === 'critic'
        ? e.agent === 'Critic'
        : filter === 'rewriter'
          ? e.agent === 'Rewriter'
          : filter === 'guards'
            ? guardAction(e)
            : isYou(e),
  );
  const pick = shown[Math.min(selected, shown.length - 1)];
  const calls = d.apiCalls || 0;
  const tokensIn = d.inputTokens || 0;
  const tokensOut = d.outputTokens || 0;
  const span =
    events.length > 1 ? Date.parse(events.at(-1)!.at) - Date.parse(events[0].at) : Number.NaN;
  const critiques: any[] = d.resumeTeam?.critiques || [];
  const blocked = critiques.reduce((n, c) => n + (c.metrics?.blockedRewrites || 0), 0);
  const returns = critiques.filter((c) => !c.pass).length;
  const toolCalls = events.filter((e) => e.action === 'tool').length;
  const gapBefore = (e: Event) => {
    const i = events.indexOf(e);
    return i > 0 ? Date.parse(e.at) - Date.parse(events[i - 1].at) : Number.NaN;
  };
  const pct = Math.min(100, Math.round((100 * calls) / MISSION_MODEL_CALL_LIMIT));

  return (
    <div className="quest-page bl">
      <div className="bl-stats">
        <section className="quest-tile lime bl-stat" aria-label="Model calls">
          <span>Mana · model calls</span>
          <div className="bl-big">
            <b>{calls}</b>
            <span>/ {MISSION_MODEL_CALL_LIMIT}</span>
          </div>
          <div
            className="bl-meter"
            role="img"
            aria-label={`${calls} of ${MISSION_MODEL_CALL_LIMIT} model calls used`}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
        </section>
        <section className="quest-tile bl-stat" aria-label="Tokens">
          <span>Tokens</span>
          <b className="bl-num">{((tokensIn + tokensOut) / 1000).toFixed(1)}k</b>
          <small>
            {(tokensIn / 1000).toFixed(1)}k in · {(tokensOut / 1000).toFixed(1)}k out
          </small>
        </section>
        <section className="quest-tile bl-stat" aria-label="Time in battle">
          <span>Time in battle</span>
          <b className="bl-num">{duration(span)}</b>
          <small>
            {events.length} events · {toolCalls} tool use{toolCalls === 1 ? '' : 's'}
          </small>
        </section>
        <section className="quest-tile coral bl-stat" aria-label="Guards">
          <span>Guards stepped in</span>
          <b className="bl-num">{blocked + returns}</b>
          <small>
            {blocked} rewrite{blocked === 1 ? '' : 's'} blocked · {returns} Critic return
            {returns === 1 ? '' : 's'}
          </small>
        </section>
      </div>

      <div className="quest-row bl-main">
        <section className="quest-tile ink bl-log" aria-labelledby="bl-title">
          <div className="quest-tile-head">
            <h2 id="bl-title">Log</h2>
            <div className="bl-filters" role="group" aria-label="Filter the log">
              {(Object.keys(filterLabels) as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`bl-filter${filter === f ? ' on' : ''}`}
                  aria-pressed={filter === f}
                  onClick={() => {
                    setFilter(f);
                    setSelected(0);
                  }}
                >
                  {filterLabels[f]}
                </button>
              ))}
            </div>
          </div>
          {shown.length ? (
            <ol className="bl-list">
              {shown.map((e, i) => (
                <li key={e.at + i}>
                  <button
                    type="button"
                    className={`bl-row${guardAction(e) ? ' guard' : ''}${pick === e ? ' sel' : ''}`}
                    aria-pressed={pick === e}
                    onClick={() => setSelected(i)}
                  >
                    <span className="bl-time">{clock(e.at)}</span>
                    <Mini e={e} />
                    <span className="bl-text">
                      <strong>{isYou(e) ? 'You' : e.agent}</strong>{' '}
                      {verb[e.action] || e.action.replace(/_/g, ' ')}
                      {e.action === 'tool' ? <em> {e.detail}</em> : null}
                    </span>
                    <span className="bl-tag">
                      {e.action === 'tool'
                        ? 'tool'
                        : e.action === 'handoff'
                          ? 'handoff'
                          : guardAction(e)
                            ? 'guard'
                            : isYou(e)
                              ? 'decision'
                              : e.action}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="bl-empty">Nothing in this filter yet.</p>
          )}
        </section>

        <aside className="quest-tile bl-detail" aria-labelledby="bl-detail-title">
          {pick ? (
            <>
              <span className={`quest-chip ${guardAction(pick) ? 'coral' : 'lilac'}`}>
                Selected · {clock(pick.at)}
              </span>
              <div className="bl-who">
                {isYou(pick) ? <LeaderBadge name={userName} size={44} /> : <Mini e={pick} />}
                <h2 id="bl-detail-title">{isYou(pick) ? 'Your decision' : pick.agent}</h2>
              </div>
              <dl className="bl-facts">
                <div>
                  <dt>Action</dt>
                  <dd>{pick.action.replace(/_/g, ' ')}</dd>
                </div>
                <div>
                  <dt>Since previous step</dt>
                  <dd>{duration(gapBefore(pick))}</dd>
                </div>
              </dl>
              <p className="bl-detail-text">{pick.detail}</p>
              <pre className="bl-span">
                {`event: ${pick.agent.toLowerCase().replace(/\s+/g, '_')}.${pick.action}\nat: ${pick.at}\nmission: ${m.id.slice(0, 8)}…`}
              </pre>
              <p className="quest-fine">
                Totals come from the mission’s usage counter. Per-step tokens and latency need
                tracing, which is planned (M6).
              </p>
            </>
          ) : (
            <p className="bl-empty dark">Select an event to see its details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
