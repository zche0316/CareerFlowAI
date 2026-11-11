import type { ReactNode } from 'react';
import { ArrowRight, Check, Flag } from 'lucide-react';
import { MISSION_MODEL_CALL_LIMIT } from '../../../../packages/contracts/src/mission-limits.js';
import { nextMissionStep } from '../mission-step.js';
import { AgentAvatar, LeaderBadge, type AgentId } from './characters.js';
import { XP_PER_LEVEL, XP_RULES, progressFrom, skillBoard } from './progress.js';
import { prettyTerm } from './character-sheet.js';

// Maps the agent names written into mission events onto party members.
const eventAgent: Record<string, AgentId> = {
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

const route = ['Profile', 'Analysis', 'Shortlist', 'Review', 'Practice', 'Apply'];

const heroCopy: Record<string, { title: string; text: string; cta: string }> = {
  AWAITING_JOB: {
    title: 'Pick the job your party should chase.',
    text: 'Job Matcher ranked the roles against your approved evidence. Nothing moves until you choose.',
    cta: 'Choose a job',
  },
  AWAITING_APPROVAL: {
    title: 'Your party built a draft. Your call.',
    text: 'The resume team finished and the Critic has had its say. It only moves on when you approve it.',
    cta: 'Review the draft',
  },
  AWAITING_INTERVIEW: {
    title: 'Time to face the interview panel.',
    text: 'Your approved resume is saved. Practise the questions your target role is likely to ask.',
    cta: 'Start practice',
  },
  RUNNING: {
    title: 'Your party is working on it.',
    text: 'You can leave this page; work continues on the server and waits for you at the next decision.',
    cta: 'Watch the quest',
  },
  FAILED: {
    title: 'Your last quest stopped.',
    text: 'A step failed. Your saved work is intact; open the quest to retry or keep its results.',
    cta: 'Review and retry',
  },
  COMPLETE: {
    title: 'Quest complete. Ready for the next one?',
    text: 'Your feedback and approved documents are saved. Start a new quest with what you learned.',
    cta: 'Start a new quest',
  },
};

// Calendar week (Mon–Sun) days with at least one action the user took.
function activeDays(workspace: any) {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const days = new Set<number>();
  const mark = (at?: string) => {
    if (!at) return;
    const d = new Date(at);
    if (d >= monday) days.add((d.getDay() + 6) % 7);
  };
  mark(workspace?.profile?.approvedAt);
  for (const m of workspace?.missions || []) {
    mark(m.createdAt);
    for (const e of m.events || []) if (e.agent === 'Job Seeker') mark(e.at);
  }
  return { days, today: (now.getDay() + 6) % 7 };
}

export function QuestHome({
  workspace,
  userName,
  onOpenMission,
  onNewQuest,
  onBuildProfile,
  onNavigate,
  coach,
}: {
  workspace: any;
  coach?: ReactNode;
  userName: string;
  onOpenMission: (id: string, step: number | null) => void;
  onNewQuest: () => void;
  onBuildProfile: () => void;
  onNavigate: (id: 'character' | 'party' | 'jobs' | 'quests') => void;
}) {
  // Until the workspace loads, render nothing that would claim the profile is missing.
  if (!workspace) return <p className="quest-fine dark">Loading your quests…</p>;
  const missions: any[] = workspace?.missions || [];
  const active = missions[0];
  const hasProfile = Boolean(workspace?.profile);
  const progress = progressFrom(workspace);
  const step = active ? nextMissionStep(active) : hasProfile ? 1 : 0;
  // Route: 0 Profile, 1 Analysis, 2 Shortlist, 3 Review, 4 Practice, 5 Apply.
  const routeIndex = !hasProfile ? 0 : !active ? 1 : active.status === 'COMPLETE' ? 5 : step;
  const status = active ? (['QUEUED', 'RUNNING'].includes(active.status) ? 'RUNNING' : active.status) : '';
  const copy = !hasProfile
    ? {
        title: 'Create your character first.',
        text: 'Tell Coach about your study, work and projects. You approve every fact before your party can use it.',
        cta: 'Build my profile',
      }
    : heroCopy[status] || {
        title: 'Start your first quest.',
        text: 'Set a goal and your party will analyse your profile, find matching roles and wait for your decisions.',
        cta: 'Start a quest',
      };
  // A quest stopped by its model-call budget cannot be retried; its saved results stay readable.
  const budgetSpent =
    status === 'FAILED' && (active?.data?.apiCalls || 0) >= MISSION_MODEL_CALL_LIMIT;
  const cta = budgetSpent ? 'Review saved results' : copy.cta;
  const heroAction = () => {
    if (!hasProfile) return onBuildProfile();
    if (!active || active.status === 'COMPLETE' || ['CANCELLED', 'STALE'].includes(active.status))
      return onNewQuest();
    onOpenMission(active.id, step);
  };

  const waiting = missions.filter((m) =>
    ['AWAITING_JOB', 'AWAITING_APPROVAL', 'AWAITING_INTERVIEW'].includes(m.status),
  );
  const locked = skillBoard(workspace).filter((t) => t.status === 'locked');
  const quests = [
    ...waiting.map((m) => ({
      key: m.id,
      title:
        m.status === 'AWAITING_JOB'
          ? 'Choose a target job'
          : m.status === 'AWAITING_APPROVAL'
            ? `Review the ${m.data?.selectedJob?.job?.title || 'resume'} draft`
            : `Practise for ${m.data?.selectedJob?.job?.title || 'your interview'}`,
      text:
        m.status === 'AWAITING_APPROVAL'
          ? 'Approve it, or send it back to one teammate.'
          : m.status === 'AWAITING_JOB'
            ? `${m.data?.matches?.length || 0} ranked roles are waiting.`
            : 'Answers are practice, never facts.',
      xp: m.status === 'AWAITING_APPROVAL' ? XP_RULES.approvedResume : m.status === 'AWAITING_INTERVIEW' ? XP_RULES.practiceAnswer : null,
      go: () => onOpenMission(m.id, nextMissionStep(m)),
    })),
    ...locked.slice(0, 1).map((t) => ({
      key: 'skill' + t.term,
      title: `Unlock ${prettyTerm(t.term)}`,
      text: `Asked by ${t.askedBy} of ${t.jobs} ranked jobs; no approved evidence yet.`,
      xp: null,
      go: () => onNavigate('character'),
    })),
  ].slice(0, 4);

  const feed = (active?.events || [])
    .filter((e: any) => eventAgent[e.agent] && !['context', 'tool'].includes(e.action))
    .slice(-3)
    .reverse();
  const { days, today } = activeDays(workspace);
  const lesson = missions.find((m) => m.data?.feedback?.improvements?.length);
  const roles: any[] = (missions.find((m) => m.data?.matches?.length)?.data?.matches || []).slice(0, 3);

  return (
    <div className="quest-page qh">
      <div className="quest-row">
        <section className="quest-tile ink qh-hero" aria-labelledby="qh-title">
          <div className="qh-ring" aria-hidden="true" />
          <span className="quest-chip dark">
            {active ? `Main quest · ${active.data?.selectedJob?.job?.title || 'Job search'}` : 'Main quest'}
          </span>
          <h1 id="qh-title" className="qh-title">
            {copy.title}
          </h1>
          <p className="qh-text">{copy.text}</p>
          <ol className="qh-route" aria-label="Quest route">
            {route.map((label, i) => (
              <li key={label} className={i < routeIndex ? 'done' : i === routeIndex ? 'now' : ''}>
                <span className="qh-dot" aria-hidden="true">
                  {i < routeIndex ? <Check size={14} strokeWidth={3.2} /> : i === route.length - 1 ? <Flag size={14} /> : i + 1}
                </span>
                <span className="qh-label">
                  {label}
                  {i === routeIndex && <span className="sr-only"> (current)</span>}
                </span>
              </li>
            ))}
          </ol>
          <div className="qh-cta">
            <button type="button" className="quest-press lime" onClick={heroAction}>
              {cta}
              <ArrowRight size={18} strokeWidth={2.6} />
            </button>
            {status === 'AWAITING_APPROVAL' && <span>+{XP_RULES.approvedResume} XP on approval</span>}
          </div>
        </section>

        <section className="quest-tile violet qh-level" aria-labelledby="qh-level">
          <div className="quest-tile-head">
            <h2 id="qh-level">Level {progress.level}</h2>
            <button type="button" className="quest-chip qh-link" onClick={() => onNavigate('character')}>
              Character sheet
            </button>
          </div>
          <div className="qh-level-body">
            <div
              className="qh-ring-meter"
              role="img"
              aria-label={`${progress.intoLevel} of ${XP_PER_LEVEL} XP`}
              style={{ ['--p' as string]: `${(100 * progress.intoLevel) / XP_PER_LEVEL}%` }}
            >
              <div>
                <b>{progress.intoLevel}</b>
                <span>/ {XP_PER_LEVEL.toLocaleString()}</span>
              </div>
            </div>
            <p>{XP_PER_LEVEL - progress.intoLevel} XP to level {progress.level + 1}. XP only comes from things you approve or practise.</p>
          </div>
          <ul className="qh-sources">
            {progress.sources
              .filter((s) => s.xp > 0)
              .map((s) => (
                <li key={s.label}>
                  <span>{s.label}</span>
                  <b>+{s.xp}</b>
                </li>
              ))}
          </ul>
        </section>
      </div>

      {coach}

      <div className="quest-row">
        <section className="quest-tile qh-quests" aria-labelledby="qh-quests">
          <div className="quest-tile-head">
            <h2 id="qh-quests">Today’s quests</h2>
            <span>{quests.length ? `${quests.length} open` : 'All clear'}</span>
          </div>
          {quests.length ? (
            <ul className="qh-list">
              {quests.map((q) => (
                <li key={q.key}>
                  <button type="button" className="qh-quest" onClick={q.go}>
                    <span className="qh-bullet" aria-hidden="true" />
                    <span className="qh-quest-text">
                      <strong>{q.title}</strong>
                      <span>{q.text}</span>
                    </span>
                    {q.xp ? <span className="quest-chip lime">+{q.xp}</span> : <ArrowRight size={18} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="qh-empty">Nothing needs you right now. Your party will ask when it does.</p>
          )}
        </section>

        <section className="quest-tile coral qh-party" aria-labelledby="qh-party">
          <div className="quest-tile-head">
            <h2 id="qh-party">Your party</h2>
            <button type="button" className="quest-chip qh-link" onClick={() => onNavigate('party')}>
              Meet them
            </button>
          </div>
          {feed.length ? (
            <ul className="qh-feed">
              {feed.map((e: any, i: number) => (
                <li key={e.at + i}>
                  <AgentAvatar agent={eventAgent[e.agent]} size={44} />
                  <p className={i === 0 && active?.status?.startsWith('AWAITING') ? 'dark' : ''}>
                    <strong>{e.agent}</strong> {e.detail.length > 110 ? e.detail.slice(0, 107) + '…' : e.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="qh-feed-empty">
              <div>
                {(['scout', 'coach', 'critic'] as const).map((id) => (
                  <AgentAvatar key={id} agent={id} size={44} label={false} />
                ))}
              </div>
              <p>Your party is ready. Start a quest and they’ll report here.</p>
            </div>
          )}
        </section>

        <section className="quest-tile lime qh-momentum" aria-labelledby="qh-mom">
          <h2 id="qh-mom">Momentum</h2>
          <div className="qh-big">
            <b>{days.size}</b>
            <span>active day{days.size === 1 ? '' : 's'} this week</span>
          </div>
          <div className="qh-week" role="img" aria-label={`Active on ${days.size} of 7 days this week`}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className={days.has(i) ? 'on' : i > today ? 'future' : ''}>
                {d}
              </span>
            ))}
          </div>
          <p>Weekly, not daily. Rest days never reset your progress.</p>
        </section>
      </div>

      <div className="quest-row">
        <section className="quest-tile qh-lesson" aria-labelledby="qh-lesson">
          <div className="qh-loot" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D4F55B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16v13H4z" />
              <path d="M4 7l3-4h10l3 4M12 11v5M9.5 13.5h5" />
            </svg>
          </div>
          <div>
            <h2 id="qh-lesson">{lesson ? 'Lesson card' : 'Lesson cards'}</h2>
            <p>
              {lesson
                ? `From your ${lesson.data?.selectedJob?.job?.title || ''} practice: “${lesson.data.feedback.improvements[0]}”`
                : 'Practice feedback and rejections become lesson cards here. They count toward XP; they never become profile facts.'}
            </p>
          </div>
        </section>

        <section className="quest-tile qh-roles" aria-labelledby="qh-roles">
          <div className="quest-tile-head">
            <h2 id="qh-roles">Fresh roles</h2>
            <button type="button" className="quest-chip qh-link" onClick={() => onNavigate('jobs')}>
              All jobs
            </button>
          </div>
          {roles.length ? (
            <div className="qh-role-grid">
              {roles.map((r) => (
                <button key={r.job.id} type="button" className="qh-role" onClick={() => onOpenMission(missions.find((m) => m.data?.matches?.includes(r))?.id || active.id, 2)}>
                  <span className="qh-score">
                    {Math.round(r.score)}
                    <small> match</small>
                  </span>
                  <strong>{r.job.title}</strong>
                  <span>
                    {[r.job.company, r.job.location].filter(Boolean).join(' · ')}
                  </span>
                  <span className="quest-chip">
                    {r.job.source?.liveVacancy ? r.job.source?.provider || 'Live source' : 'Fictional demo job'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="qh-empty">Ranked roles from your quests appear here.</p>
          )}
        </section>
      </div>
      <p className="qh-sign">
        <LeaderBadge name={userName} size={22} /> You lead the party. Agents suggest, you decide.
      </p>
    </div>
  );
}
