import { Check, Lock } from 'lucide-react';
import { countries } from '../../../../packages/recruitment/src/geography.js';
import { requirementChips } from './job-board.js';
import { skillBoard } from './progress.js';
import { rightsPattern } from './world.js';

// Graduate-style roles are the ones a recruiting season is about.
const seasonal = /\b(graduate|grad|intern(ship)?|entry[- ]level|junior|early career|cadet)\b/i;
// Below this many dated graduate roles, any "peak month" would be noise.
export const SEASON_MIN_RECORDS = 8;
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRACTICE_TARGET = 5;

type Dated = { r: any; at: Date; posted: boolean; missionId: string };

/** Roles tracked in this realm, de-duplicated, with the best date we actually have for each. */
export function seasonRecords(workspace: any, realm: string) {
  const seen = new Map<string, Dated>();
  for (const m of workspace?.missions || []) {
    if ((m.data?.jobSearch?.country || 'au') !== realm) continue;
    for (const r of m.data?.matches || []) {
      const raw = r.job.source?.postedAt || r.job.source?.fetchedAt || m.createdAt;
      const at = new Date(raw);
      if (Number.isNaN(at.getTime())) continue;
      const prev = seen.get(r.job.id);
      if (!prev || at < prev.at)
        seen.set(r.job.id, { r, at, posted: Boolean(r.job.source?.postedAt), missionId: m.id });
    }
  }
  const all = [...seen.values()];
  const grad = all.filter((x) => seasonal.test(`${x.r.job.title} ${x.r.job.employmentType || ''}`));
  // The peak only ever comes from graduate roles; with none yet, the chart shows all roles.
  const charted = grad.length ? grad : all;
  const byMonth = months.map((_, i) => charted.filter((x) => x.at.getMonth() === i).length);
  const peak = grad.length >= SEASON_MIN_RECORDS ? byMonth.indexOf(Math.max(...byMonth)) : -1;
  return {
    all,
    grad,
    byMonth,
    peak,
    chartsAll: !grad.length,
    posted: charted.filter((x) => x.posted).length,
  };
}

function daysUntilMonth(month: number, now = new Date()) {
  const year = now.getMonth() < month ? now.getFullYear() : now.getFullYear() + 1;
  const target = new Date(year, month, 1);
  if (now.getMonth() === month) return 0;
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function QuestSeason({
  workspace,
  realm,
  onNavigate,
  onOpenMission,
}: {
  workspace: any;
  realm: string;
  onNavigate: (id: 'jobs' | 'character' | 'world') => void;
  onOpenMission: (id: string, step: number | null) => void;
}) {
  if (!workspace) return <p className="quest-fine dark">Loading the season…</p>;
  const spec = countries.find((c) => c.code === realm) || countries[0];
  const s = seasonRecords(workspace, spec.code);
  const missions: any[] = workspace.missions || [];
  const inRealm = missions.filter((m) => (m.data?.jobSearch?.country || 'au') === spec.code);
  const rounds = inRealm.reduce((n, m) => n + (m.data?.rounds?.length || 0), 0);
  const approved = inRealm.filter((m) => m.data?.approvedResumeId).length;
  const locked = skillBoard(workspace).filter((t) => t.status === 'locked');
  const watch = (s.grad.length ? s.grad : s.all).slice(0, 8);
  const wait = s.peak >= 0 ? daysUntilMonth(s.peak) : null;

  const prep = [
    {
      key: 'watch',
      title: `Track ${SEASON_MIN_RECORDS} graduate or intern roles`,
      text: 'Enough dated records to estimate when this realm’s season peaks.',
      have: Math.min(s.grad.length, SEASON_MIN_RECORDS),
      need: SEASON_MIN_RECORDS,
      go: () => onNavigate('jobs'),
    },
    {
      key: 'practice',
      title: `Win ${PRACTICE_TARGET} boss rounds`,
      text: 'Interview practice rounds scored by the Evaluator in this realm.',
      have: Math.min(rounds, PRACTICE_TARGET),
      need: PRACTICE_TARGET,
      go: () => {
        const m = inRealm.find((x) => x.data?.questions?.length);
        if (m) onOpenMission(m.id, 4);
        else onNavigate('jobs');
      },
    },
    {
      key: 'resume',
      title: 'Approve one tailored resume here',
      text: 'A Critic-reviewed draft you approved for a role in this realm.',
      have: Math.min(approved, 1),
      need: 1,
      go: () => {
        const m = inRealm.find((x) => x.status === 'AWAITING_APPROVAL');
        if (m) onOpenMission(m.id, 3);
        else onNavigate('jobs');
      },
    },
    ...(locked[0]
      ? [
          {
            key: 'gap',
            title: `Close the ${locked[0].term} gap`,
            text: `Asked by ${locked[0].askedBy} of ${locked[0].jobs} ranked roles; no approved evidence yet.`,
            have: 0,
            need: 1,
            go: () => onNavigate('character'),
          },
        ]
      : []),
  ];
  const done = prep.filter((p) => p.have >= p.need).length;
  const rewarded = done === prep.length;
  const peakCount = Math.max(1, ...s.byMonth);

  return (
    <div className="quest-page ss">
      <section className="ss-banner" aria-labelledby="ss-title">
        <span className="ss-blob a" aria-hidden="true" />
        <span className="ss-blob b" aria-hidden="true" />
        <div className="ss-copy">
          <span className="quest-chip ink">Season event · {spec.name} realm</span>
          <h1 id="ss-title">Graduate Season</h1>
          <p>
            {s.peak >= 0
              ? `In your records, most graduate and intern roles here were first seen in ${months[s.peak]}. Get ready before the rush.`
              : `The season calendar is built from your own tracked graduate and intern roles. It needs ${SEASON_MIN_RECORDS - s.grad.length} more before it estimates a peak.`}
          </p>
        </div>
        <div className="ss-count">
          <span>{s.peak >= 0 ? `${months[s.peak]} peak expected in` : 'Season calendar'}</span>
          <div className="ss-cds">
            <div className="ss-cd" role={wait !== null ? 'timer' : undefined}>
              <b>{wait !== null ? wait : `${s.grad.length}/${SEASON_MIN_RECORDS}`}</b>
              <small>{wait !== null ? 'days' : 'records'}</small>
            </div>
            <div className="ss-cd light">
              <b>{watch.length}</b>
              <small>roles watched</small>
            </div>
          </div>
        </div>
      </section>

      <section className="quest-tile ss-cal" aria-labelledby="ss-cal">
        <div className="quest-tile-head">
          <h2 id="ss-cal">When roles appeared</h2>
          <span>
            {s.chartsAll
              ? `No graduate or intern roles yet, so all ${s.all.length} tracked roles`
              : `${s.grad.length} graduate/intern roles`}{' '}
            · {s.posted} with a provider posting date, the rest dated when first seen
          </span>
        </div>
        <ol className="ss-months" aria-label="Graduate roles first seen per month">
          {months.map((label, i) => (
            <li
              key={label}
              className={i === s.peak ? 'peak' : i === new Date().getMonth() ? 'now' : ''}
            >
              <span className="ss-bar" aria-hidden="true">
                <i style={{ height: `${(100 * s.byMonth[i]) / peakCount}%` }} />
              </span>
              <b>{s.byMonth[i]}</b>
              <small>{label}</small>
            </li>
          ))}
        </ol>
        <p className="quest-fine dark">
          Past behaviour in your records, not a promise of future opening dates.
        </p>
      </section>

      <div className="quest-row ss-row">
        <section className="quest-tile coral ss-prep" aria-labelledby="ss-prep">
          <div className="quest-tile-head">
            <h2 id="ss-prep">Prep quests</h2>
            <span>
              {done} of {prep.length} done
            </span>
          </div>
          <ul className="ss-quests">
            {prep.map((p) => {
              const complete = p.have >= p.need;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    className={`ss-quest${complete ? ' done' : ''}`}
                    onClick={p.go}
                  >
                    <span className="ss-icon" aria-hidden="true">
                      {complete ? <Check size={18} strokeWidth={3} /> : `${p.have}/${p.need}`}
                    </span>
                    <span className="ss-quest-text">
                      <strong>{p.title}</strong>
                      <small>{p.text}</small>
                    </span>
                    <span className={`quest-chip ${complete ? 'lime' : 'outline'}`}>
                      {complete ? 'Done' : `${p.have} of ${p.need}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={`ss-reward${rewarded ? ' on' : ''}`}>
            <span className="ss-badge" aria-hidden="true">
              {rewarded ? 'E' : <Lock size={18} />}
            </span>
            <span>
              <strong>Event reward: “Early bird” badge{rewarded ? ' unlocked' : ''}.</strong>{' '}
              Cosmetic only. Rewards never depend on how many applications you send.
            </span>
          </div>
        </section>

        <section className="quest-tile ss-watch" aria-labelledby="ss-watch">
          <div className="quest-tile-head">
            <h2 id="ss-watch">Watchlist</h2>
            <button
              type="button"
              className="quest-press lime ss-add"
              onClick={() => onNavigate('jobs')}
            >
              Find more roles
            </button>
          </div>
          {watch.length ? (
            <div className="ss-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">First seen</th>
                    <th scope="col">Work rights</th>
                    <th scope="col">Your readiness</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.map((x) => {
                    const gaps = requirementChips(x.r).filter(
                      (c) => c.level !== 'preferred' && c.state !== 'evidenced',
                    ).length;
                    const rights = rightsPattern.test(x.r.job.description || '');
                    return (
                      <tr key={x.r.job.id}>
                        <td>
                          <button
                            type="button"
                            className="ss-role"
                            onClick={() => onOpenMission(x.missionId, 2)}
                          >
                            <strong>{x.r.job.title}</strong>
                            <small>{x.r.job.company}</small>
                          </button>
                        </td>
                        <td>
                          {x.at.toLocaleDateString([], { day: 'numeric', month: 'short' })}
                          {x.posted ? '' : ' *'}
                        </td>
                        <td>
                          <span className={`quest-chip ${rights ? 'coral' : ''}`}>
                            {rights ? 'Mentions rights' : 'Not stated'}
                          </span>
                        </td>
                        <td>
                          <span className={`quest-chip ${gaps ? 'lilac' : 'ink'}`}>
                            {gaps ? `${gaps} gap${gaps === 1 ? '' : 's'}` : 'Ready'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="qh-empty">
              No roles tracked in {spec.name} yet. Start a quest to fill it.
            </p>
          )}
          <p className="quest-fine dark">
            * date first seen by your quest, not the employer’s posting date.{' '}
            {s.grad.length
              ? 'Showing graduate and intern roles.'
              : 'No graduate roles yet, so showing all tracked roles.'}{' '}
            <button type="button" className="ss-link" onClick={() => onNavigate('world')}>
              Change realm
            </button>
          </p>
        </section>
      </div>
    </div>
  );
}
