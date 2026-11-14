import { CapabilityLevels } from './capabilities.js';
import { ProfileSources } from './profile-sources.js';
import { Lock } from 'lucide-react';
import { AgentAvatar, LeaderBadge } from './characters.js';
import { XP_PER_LEVEL, XP_RULES, factUsage, progressFrom, skillBoard } from './progress.js';

export { prettyTerm } from './terms.js';

const kindLabel: Record<string, string> = {
  experience: 'Experience',
  education: 'Education',
  skill: 'Skill',
  interest: 'Interest',
};

const statusLabel = {
  unlocked: 'You have evidence',
  partial: 'Partly shown',
  locked: 'No evidence yet',
} as const;

/** RPG-style view of the approved profile: stats only grow from facts the user approved. */
export function CharacterSheet({
  workspace,
  userName,
  onBuildProfile,
  onOpenMission,
  request,
  onProfileChanged,
}: {
  workspace: any;
  userName: string;
  onBuildProfile: () => void;
  onOpenMission: (id: string) => void;
  request?: (path: string, method?: string, body?: unknown) => Promise<any>;
  onProfileChanged?: () => void;
}) {
  const profile = workspace?.profile;
  if (!profile)
    return (
      <section className="quest-tile quest-empty">
        <AgentAvatar agent="coach" size={72} />
        <h1 className="quest-display">No character yet</h1>
        <p>Your character sheet appears once you approve a profile. Coach can help you build one.</p>
        <button type="button" className="quest-press lime" onClick={onBuildProfile}>
          Build my profile
        </button>
      </section>
    );
  const facts: any[] = profile.facts || [];
  const progress = progressFrom(workspace);
  const board = skillBoard(workspace);
  const usage = factUsage(workspace);
  const latest = (workspace.missions || []).find((m: any) => m.data?.analysis);
  const quests: any[] = latest?.data?.analysis?.actions?.slice(0, 3) || [];
  const rawPath =
    latest?.data?.analysis?.directions?.[0]?.text?.split(/[.:;]/)[0] ||
    profile.data?.goals?.split(/[.:;]/)[0] ||
    'Career path';
  const path = rawPath.length > 64 ? rawPath.slice(0, 61).trimEnd() + '…' : rawPath;
  const inventory = [...facts]
    .filter((f) => f.kind !== 'skill' && !/^none yet$/i.test(f.text))
    .sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0))
    .slice(0, 4);
  const jobs = board[0]?.jobs || 0;

  return (
    <div className="quest-page" aria-labelledby="character-title">
      <div className="quest-row">
        <section className="quest-tile ink quest-hero-card" style={{ flex: '1 1 340px' }}>
          <div className="quest-who">
            <LeaderBadge name={userName} size={96} />
            <div>
              <h1 id="character-title" className="quest-display">
                {profile.data?.name || userName}
              </h1>
              <span className="quest-sub">
                {path} · Level {progress.level}
              </span>
              <span className="quest-chip dark">Profile v{profile.version} · approved by you</span>
            </div>
          </div>
          <div className="quest-xp" role="img" aria-label={`${progress.intoLevel} of ${XP_PER_LEVEL} XP into level ${progress.level}`}>
            <span style={{ width: `${(100 * progress.intoLevel) / XP_PER_LEVEL}%` }} />
          </div>
          <span className="quest-sub">
            {progress.xp.toLocaleString()} XP · {XP_PER_LEVEL - progress.intoLevel} to level{' '}
            {progress.level + 1}
          </span>
          <div className="quest-stats3">
            <div>
              <b>{facts.length}</b>
              <span>approved facts</span>
            </div>
            <div>
              <b>{workspace.resumes?.length || 0}</b>
              <span>resumes approved</span>
            </div>
            <div>
              <b>{workspace.missions?.length || 0}</b>
              <span>runs</span>
            </div>
          </div>
          <p className="quest-fine dark">
            Stats only grow from facts you approve. Agents can suggest; they can’t level you up.
          </p>
        </section>

        {request && (
          <div style={{ flex: '2 1 480px', minWidth: 0 }}>
            <CapabilityLevels request={request} profileVersion={profile.version} compact />
          </div>
        )}
      </div>

      <section className="quest-tile violet" aria-labelledby="board-title">
        <div className="quest-tile-head">
          <div>
            <h2 id="board-title">What roles ask for</h2>
            <span>
              {jobs
                ? `What your top ${jobs} ranked jobs ask for, against what you’ve proved.`
                : 'Run a job search to see what employers ask for.'}
            </span>
          </div>
        </div>
        <div className="cs-board">
          {(['unlocked', 'partial', 'locked'] as const).map((status) => {
            const tiles = board.filter((t) => t.status === status);
            return (
              <div key={status} className={`cs-col ${status}`}>
                <h3>
                  {statusLabel[status]} <span>{tiles.length}</span>
                </h3>
                {tiles.length ? (
                  <ul>
                    {tiles.slice(0, 8).map((tile) => (
                      <li key={tile.term} title={`Asked by ${tile.askedBy} of ${tile.jobs} roles`}>
                        {status === 'locked' && <Lock size={13} aria-hidden="true" />}
                        <span>{tile.term}</span>
                        {tile.askedBy > 1 && <b>×{tile.askedBy}</b>}
                      </li>
                    ))}
                    {tiles.length > 8 && <li className="muted">+{tiles.length - 8} more</li>}
                  </ul>
                ) : (
                  <p className="muted">None yet</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="quest-row">
        <section className="quest-tile coral" style={{ flex: '1 1 340px' }} aria-labelledby="side-title">
          <div className="quest-tile-head">
            <h2 id="side-title">Side quests from Coach</h2>
            <AgentAvatar agent="coach" size={40} />
          </div>
          {quests.length ? (
            quests.map((q, i) => (
              <article className="quest-card" key={i}>
                <div className="quest-card-top">
                  <strong>{q.text}</strong>
                  <span className="quest-chip lime">+{XP_RULES.coachQuest}</span>
                </div>
                <span className="quest-sub dark">{q.reason}</span>
              </article>
            ))
          ) : (
            <p>Coach will suggest side quests after your next career analysis.</p>
          )}
          {latest && (
            <button type="button" className="quest-press" onClick={() => onOpenMission(latest.id)}>
              Open the run
            </button>
          )}
        </section>

        <section className="quest-tile" style={{ flex: '2 1 520px' }} aria-labelledby="inv-title">
          <div className="quest-tile-head">
            <h2 id="inv-title">Most used approved facts</h2>
            <span>{facts.length} total</span>
          </div>
          <div className="quest-inventory">
            {inventory.map((f) => (
              <article key={f.id} className="quest-item">
                <div className="quest-card-top">
                  <span className="quest-chip outline">{kindLabel[f.kind] || f.kind}</span>
                  {(usage.get(f.id) || 0) > 0 && (
                    <span className="quest-sub dark">
                      in {usage.get(f.id)} resume{usage.get(f.id) === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <span className="cs-fact">{f.text.split('\n')[0]}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
      {request && (
        <ProfileSources request={request} onApproved={() => onProfileChanged?.()} />
      )}
    </div>
  );
}
