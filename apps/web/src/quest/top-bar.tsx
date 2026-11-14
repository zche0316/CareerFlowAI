import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { LeaderBadge } from './characters.js';

export type QuestNavId =
  | 'home'
  | 'quests'
  | 'world'
  | 'season'
  | 'scout'
  | 'jobs'
  | 'party'
  | 'character'
  | 'library'
  | 'approved-profile'
  | 'approvals'
  | 'applications'
  | 'activity'
  | 'coach';

const primary: { id: QuestNavId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'quests', label: 'Quests' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'scout', label: 'Scout' },
  { id: 'world', label: 'World' },
];
const more: { id: QuestNavId; label: string }[] = [
  { id: 'coach', label: 'Coach' },
  { id: 'party', label: 'Party' },
  { id: 'season', label: 'Season event' },
  { id: 'approvals', label: 'Decision inbox' },
  { id: 'applications', label: 'Applications' },
  { id: 'activity', label: 'Activity' },
];
// Things about you sit under your avatar, as in most products.
const account: { id: QuestNavId; label: string }[] = [
  { id: 'character', label: 'Character' },
  { id: 'approved-profile', label: 'My profile' },
  { id: 'library', label: 'My documents' },
];

/** Floating pill navigation for the Quest app. Navigation logic stays in the caller. */
export function QuestTopBar({
  active,
  userName,
  level,
  xp,
  waiting,
  fixture,
  onNavigate,
  onSignOut,
}: {
  active: QuestNavId | null;
  userName: string;
  level: number;
  xp: number;
  waiting: number;
  fixture: boolean;
  onNavigate: (id: QuestNavId) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState<'more' | 'account' | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      const box = open === 'more' ? menu.current : accountMenu.current;
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !box?.contains(event.target as Node)
      )
        setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const go = (id: QuestNavId) => {
    setOpen(null);
    onNavigate(id);
  };
  return (
    <header className="qt-bar">
      <a
        className="qt-brand"
        href="?view=home"
        onClick={(e) => {
          e.preventDefault();
          go('home');
        }}
      >
        <span className="qt-mark" aria-hidden="true">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D4F55B"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 18c4 0 4-8 8-8s4 8 8 8" />
            <circle cx="12" cy="6" r="2" />
          </svg>
        </span>
        careerflow
      </a>
      <nav aria-label="Main" className="qt-nav">
        {primary.map((item) => (
          <button
            key={item.id}
            type="button"
            className="qt-link"
            aria-current={active === item.id ? 'page' : undefined}
            onClick={() => go(item.id)}
          >
            {item.label}
            {item.id === 'home' && waiting > 0 && (
              <span className="qt-count" aria-label={`${waiting} waiting for you`}>
                {waiting}
              </span>
            )}
          </button>
        ))}
        <div className="qt-more" ref={menu}>
          <button
            type="button"
            className="qt-link"
            aria-expanded={open === 'more'}
            aria-haspopup="menu"
            aria-current={more.some((m) => m.id === active) ? 'page' : undefined}
            onClick={() => setOpen(open === 'more' ? null : 'more')}
          >
            More <ChevronDown size={14} aria-hidden="true" />
          </button>
          {open === 'more' && (
            <div className="qt-menu" role="menu">
              {more.map((item) => (
                <button key={item.id} type="button" role="menuitem" onClick={() => go(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
      <div className="qt-right">
        {fixture && (
          <span className="qt-mode" title="Deterministic fixture provider; no live AI calls">
            Demo mode
          </span>
        )}
        <button
          type="button"
          className="quest-xp-pill"
          onClick={() => go('character')}
          aria-label={`Level ${level}, ${xp} XP. Open character sheet`}
        >
          <i aria-hidden="true" />
          Lv {level} · {xp.toLocaleString()} XP
        </button>
        <div className="qt-more qt-account" ref={accountMenu}>
          <button
            type="button"
            className="qt-avatar"
            aria-label="Account menu"
            aria-expanded={open === 'account'}
            aria-haspopup="menu"
            aria-current={account.some((m) => m.id === active) ? 'page' : undefined}
            onClick={() => setOpen(open === 'account' ? null : 'account')}
          >
            <LeaderBadge name={userName} />
          </button>
          {open === 'account' && (
            <div className="qt-menu" role="menu">
              <strong className="qt-menu-name">{userName}</strong>
              {account.map((item) => (
                <button key={item.id} type="button" role="menuitem" onClick={() => go(item.id)}>
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="qt-menu-out"
                onClick={() => {
                  setOpen(null);
                  onSignOut();
                }}
              >
                <LogOut size={15} aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
