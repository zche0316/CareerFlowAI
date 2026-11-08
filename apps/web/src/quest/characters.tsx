// Original geometric party members. Each shape and face carries a personality;
// `can` lists what each agent may read or call; `cannot` lists the server-side guard it can't get past.

export type AgentId =
  | 'scout'
  | 'gap_analyzer'
  | 'selector'
  | 'rewriter'
  | 'critic'
  | 'coach'
  | 'matcher'
  | 'interviewer';

export const agentProfiles: Record<
  AgentId,
  { name: string; color: string; quote: string; can: string[]; cannot: string[] }
> = {
  scout: {
    name: 'Scout',
    color: '#D4F55B',
    quote: 'Reads forty pages before breakfast.',
    can: ['public job boards (planned)'],
    cannot: ['apply for you', 'log in anywhere'],
  },
  matcher: {
    name: 'Job Matcher',
    color: '#8FD3FF',
    quote: 'Quotes the ad before it scores it.',
    can: ['read_approved_context', 'job ad text'],
    cannot: ['requirements without a quote', 'predict hiring'],
  },
  gap_analyzer: {
    name: 'Gap Analyzer',
    color: '#FFC24B',
    quote: 'Blunt, but fair. Here’s what’s missing.',
    can: ['job mapping citations', 'approved facts'],
    cannot: ['write resume lines', 'call a model'],
  },
  selector: {
    name: 'Evidence Selector',
    color: '#8FD3FF',
    quote: 'A picky librarian. Only shelves what you approved.',
    can: ['read_approved_context', 'choose fact IDs'],
    cannot: ['write new text', 'use unapproved facts'],
  },
  rewriter: {
    name: 'Rewriter',
    color: '#FF8A6B',
    quote: 'A wordsmith on a short leash.',
    can: ['read_approved_context', 'reorder words'],
    cannot: ['pass the wording guard with new facts', 'drop “team” or numbers'],
  },
  critic: {
    name: 'Critic',
    color: '#7C5CFF',
    quote: 'Hard to please. Sends drafts back without blinking.',
    can: ['rule checks', 'read_approved_context ×1 / cycle'],
    cannot: ['edit the draft', 'approve for you'],
  },
  coach: {
    name: 'Coach',
    color: '#5ED6C4',
    quote: 'Every no comes with a next step.',
    can: ['read_approved_context', 'past practice feedback'],
    cannot: ['cite unknown evidence', 'approve facts'],
  },
  interviewer: {
    name: 'The Panel',
    color: '#3B3D47',
    quote: 'One follow-up per answer. Make it count.',
    can: ['read_approved_context', 'selected job'],
    cannot: ['store answers as facts', 'see other users'],
  },
};

const ink = '#111218';

export function AgentAvatar({
  agent,
  size = 44,
  outline = ink,
  label = true,
}: {
  agent: AgentId;
  size?: number;
  outline?: string;
  label?: boolean;
}) {
  const p = agentProfiles[agent];
  const a11y = label
    ? { role: 'img' as const, 'aria-label': p.name }
    : { 'aria-hidden': true as const };
  const eyes = (y: number, r = 2.8) => (
    <>
      <circle cx="16" cy={y} r={r} fill={ink} />
      <circle cx="28" cy={y} r={r} fill={ink} />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" {...a11y} className="quest-avatar">
      {agent === 'scout' && (
        <>
          <circle cx="22" cy="24" r="17" fill={p.color} stroke={outline} strokeWidth="2.5" />
          <path d="M22 7V2" stroke={outline} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="22" cy="2.5" r="2.5" fill={outline} />
          {eyes(22)}
          <path d="M16 29q6 5 12 0" fill="none" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {(agent === 'gap_analyzer' || agent === 'matcher') && (
        <>
          <path
            d="M22 3l16 9v20l-16 9-16-9V12z"
            fill={p.color}
            stroke={outline}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M12 16l7 1M25 15l7-2" stroke={ink} strokeWidth="2.3" strokeLinecap="round" />
          {eyes(21)}
          <path d="M17 29h10" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {agent === 'selector' && (
        <>
          <rect x="3" y="9" width="38" height="28" rx="14" fill={p.color} stroke={outline} strokeWidth="2.5" />
          <rect x="11" y="18" width="10" height="7" rx="3" fill="none" stroke={ink} strokeWidth="2" />
          <rect x="23" y="18" width="10" height="7" rx="3" fill="none" stroke={ink} strokeWidth="2" />
          <path d="M21 21h2" stroke={ink} strokeWidth="2" />
          <circle cx="16" cy="21.5" r="1.8" fill={ink} />
          <circle cx="28" cy="21.5" r="1.8" fill={ink} />
          <path d="M18 31h8" stroke={ink} strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {agent === 'rewriter' && (
        <>
          <path
            d="M22 5c9 0 18 14 18 22 0 7-6 11-18 11S4 34 4 27C4 19 13 5 22 5z"
            fill={p.color}
            stroke={outline}
            strokeWidth="2.5"
          />
          {eyes(24)}
          <ellipse cx="22" cy="31" rx="2.4" ry="2.8" fill={ink} />
        </>
      )}
      {agent === 'critic' && (
        <>
          <rect x="5" y="6" width="34" height="34" rx="10" fill={p.color} stroke={outline} strokeWidth="2.5" />
          <path d="M10 15l9 4M34 15l-9 4" stroke={ink} strokeWidth="3" strokeLinecap="round" />
          {eyes(24)}
          <path d="M16 32h12" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
      {agent === 'coach' && (
        <>
          <circle cx="22" cy="25" r="16" fill={p.color} stroke={outline} strokeWidth="2.5" />
          <path d="M8 17c4-9 24-9 28 0z" fill={ink} />
          <path d="M33 17h7" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
          <path
            d="M14 24q2-2 4 0M26 24q2-2 4 0"
            fill="none"
            stroke={ink}
            strokeWidth="2.3"
            strokeLinecap="round"
          />
          <path d="M15 30q7 6 14 0" fill="none" stroke={ink} strokeWidth="2.3" strokeLinecap="round" />
        </>
      )}
      {agent === 'interviewer' && (
        <>
          <rect x="4" y="6" width="36" height="34" rx="11" fill={p.color} stroke={outline} strokeWidth="2.5" />
          <path d="M10 16l9 4M34 16l-9 4" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="16" cy="25" r="2.8" fill="#fff" />
          <circle cx="28" cy="25" r="2.8" fill="#fff" />
          <path d="M16 33h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// Initials badge for the human party leader.
export function LeaderBadge({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="quest-leader" style={{ width: size, height: size }} aria-hidden="true">
      {initials}
    </span>
  );
}
