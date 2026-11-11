import { Lock } from 'lucide-react';
import { AgentAvatar, LeaderBadge } from './characters.js';
import { XP_PER_LEVEL, XP_RULES, attributes, factUsage, progressFrom, skillBoard } from './progress.js';

const acronyms = new Set(['sql', 'aws', 'bi', 'api', 'etl', 'gcp', 'ui', 'ux', 'ml', 'ai', 'kpi', 'crm', 'erp', 'qa', 'ci', 'cd']);
// Requirement terms arrive lowercase from matching; restore conventional casing for display.
export const prettyTerm = (term: string) =>
  term
    .split(/(\s+|\/)/)
    .map((w) => (acronyms.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');

const statusLabel = { unlocked: 'Unlocked', partial: 'Partial', locked: 'Locked' } as const;

/** RPG-style view of the approved profile: stats only grow from facts the user approved. */
export function CharacterSheet({
  workspace,
  userName,
  onBuildProfile,
  onOpenMission,
}: {
  workspace: any;
  userName: string;
  onBuildProfile: () => void;
  onOpenMission: (id: string) => void;
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
  const attrs = attributes(workspace);
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
    .slice(0, 6);
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
              <span>missions</span>
            </div>
          </div>
          <p className="quest-fine dark">
            Stats only grow from facts you approve. Agents can suggest; they can’t level you up.
          </p>
        </section>

        <section className="quest-tile" style={{ flex: '2 1 480px' }} aria-labelledby="attrs-title">
          <div className="quest-tile-head">
            <h2 id="attrs-title">Attributes</h2>
            <span>Strength = approved facts that back it</span>
          </div>
          {attrs.length ? (
            <div className="quest-attrs">
              {attrs.map((a) => (
                <div className="quest-attr" key={a.skill}>
                  <strong>{a.skill}</strong>
                  <div className="quest-seg" role="img" aria-label={`${a.points} of 5`}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className={i < a.points ? 'on' : ''} />
                    ))}
                  </div>
                  <span className="quest-sub dark">
                    {a.facts} fact{a.facts === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p>Add skills to your profile to see your attributes.</p>
          )}
        </section>
      </div>

      <section className="quest-tile violet" aria-labelledby="board-title">
        <div className="quest-tile-head">
          <div>
            <h2 id="board-title">Skill board</h2>
            <span>
              {jobs
                ? `What your top ${jobs} ranked jobs ask for, against what you’ve proved.`
                : 'Run a job search to see what employers ask for.'}
            </span>
          </div>
          <div className="quest-legend">
            <span className="quest-chip lime">Unlocked</span>
            <span className="quest-chip outline">Partial</span>
            <span className="quest-chip lilac">Locked</span>
          </div>
        </div>
        <div className="quest-skills">
          {board.map((tile) => (
            <div key={tile.term} className={`quest-skill ${tile.status}`}>
              <span className="quest-kicker">
                Asked by {tile.askedBy} of {tile.jobs}
              </span>
              <span className="quest-skill-name">
                {tile.status === 'locked' && <Lock size={16} aria-hidden="true" />}
                {prettyTerm(tile.term)}
              </span>
              <span className="quest-sub dark">
                {statusLabel[tile.status]}
                {tile.factIds.length ? ` · ${tile.factIds.length} fact${tile.factIds.length === 1 ? '' : 's'}` : ''}
              </span>
            </div>
          ))}
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
              Open the mission
            </button>
          )}
        </section>

        <section className="quest-tile" style={{ flex: '2 1 520px' }} aria-labelledby="inv-title">
          <div className="quest-tile-head">
            <h2 id="inv-title">Inventory · approved facts</h2>
            <span>{facts.length} total</span>
          </div>
          <div className="quest-inventory">
            {inventory.map((f) => (
              <article key={f.id} className="quest-item">
                <div className="quest-card-top">
                  <span className="quest-chip ink">{f.id}</span>
                  <span className="quest-sub dark">
                    in {usage.get(f.id) || 0} resume{usage.get(f.id) === 1 ? '' : 's'}
                  </span>
                </div>
                <span>{f.text}</span>
                <span className="quest-sub dark">{f.source}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
