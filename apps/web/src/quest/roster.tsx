import { AgentAvatar, LeaderBadge, agentProfiles, type AgentId } from './characters.js';

type Card = { id: AgentId; status: 'active' | 'coming'; stats: { label: string; value: string }[] };

// Real counters from this user's missions; personalities are flavour, these numbers are not.
function teamStats(workspace: any) {
  const missions: any[] = workspace?.missions || [];
  const teams = missions.map((m) => m.data?.resumeTeam).filter(Boolean);
  const critiques = teams.flatMap((t) => t.critiques || []);
  const returned = critiques.filter((c: any) => !c.pass).length;
  const rewrites = teams.reduce(
    (acc, t) => ({
      accepted: acc.accepted + (t.rewrites?.accepted || 0),
      blocked: acc.blocked + (t.rewrites?.blocked?.length || 0),
    }),
    { accepted: 0, blocked: 0 },
  );
  const gaps = teams.reduce((n, t) => n + (t.gaps?.gaps?.length || 0), 0);
  const selections = missions.reduce((n, m) => n + (m.data?.resumeDraft?.claims?.length || 0), 0);
  const ranked = missions.reduce((n, m) => n + (m.data?.matches?.length || 0), 0);
  const analyses = missions.filter((m) => m.data?.analysis).length;
  const scouted = missions.filter((m) => m.data?.scout).length;
  return {
    critiques: critiques.length,
    returned,
    rewrites,
    gaps,
    selections,
    ranked,
    analyses,
    scouted,
  };
}

export function PartyRoster({ workspace, userName }: { workspace: any; userName: string }) {
  const s = teamStats(workspace);
  const cards: Card[] = [
    {
      id: 'scout',
      status: 'active',
      stats: [{ label: 'Quests started from sweeps', value: String(s.scouted) }],
    },
    {
      id: 'matcher',
      status: 'active',
      stats: [{ label: 'Jobs ranked', value: String(s.ranked) }],
    },
    {
      id: 'gap_analyzer',
      status: 'active',
      stats: [{ label: 'Gaps named', value: String(s.gaps) }],
    },
    {
      id: 'selector',
      status: 'active',
      stats: [{ label: 'Claims shelved', value: String(s.selections) }],
    },
    {
      id: 'rewriter',
      status: 'active',
      stats: [
        { label: 'Lines reworded', value: String(s.rewrites.accepted) },
        { label: 'Stopped by the guard', value: String(s.rewrites.blocked) },
      ],
    },
    {
      id: 'critic',
      status: 'active',
      stats: [
        { label: 'Reviews', value: String(s.critiques) },
        { label: 'Sent back', value: s.critiques ? `${s.returned} of ${s.critiques}` : '0' },
        { label: 'Strictness', value: 'Up to 2 returns, then you decide' },
      ],
    },
    {
      id: 'coach',
      status: 'active',
      stats: [{ label: 'Analyses', value: String(s.analyses) }],
    },
    {
      id: 'interviewer',
      status: 'active',
      stats: [{ label: 'Style', value: 'Role-specific practice questions' }],
    },
  ];
  return (
    <div className="quest-page">
      <div className="qr-head">
        <div>
          <h1 className="quest-display">Meet your party.</h1>
          <p>
            Personalities are for fun. The rest is not: each card lists what that agent may read or
            call, and the server-side guards it can’t get past.
          </p>
        </div>
        <div className="qr-leader">
          <LeaderBadge name={userName} size={44} />
          <div>
            <strong>You · party leader</strong>
            <span>The only one who can approve facts or send anything out</span>
          </div>
        </div>
      </div>
      <div className="qr-grid">
        {cards.map((card) => {
          const p = agentProfiles[card.id];
          return (
            <article
              key={card.id}
              className={`qr-card ${card.id}`}
              aria-labelledby={`qr-${card.id}`}
            >
              <div className="qr-top">
                <AgentAvatar agent={card.id} size={72} />
                <div>
                  <h2 id={`qr-${card.id}`}>{p.name}</h2>
                  <span className="qr-quote">“{p.quote}”</span>
                </div>
              </div>
              {card.status === 'coming' && <span className="quest-chip ink">Joining soon</span>}
              <div className="qr-block">
                <span className="quest-kicker">Reads &amp; calls</span>
                <div className="qr-chips">
                  {p.can.map((c) => (
                    <span key={c} className="qr-can">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <div className="qr-block">
                <span className="quest-kicker">Blocked by the server</span>
                <div className="qr-chips">
                  {p.cannot.map((c) => (
                    <span key={c} className="qr-cant">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <dl className="qr-stats">
                {card.stats.map((stat) => (
                  <div key={stat.label}>
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
