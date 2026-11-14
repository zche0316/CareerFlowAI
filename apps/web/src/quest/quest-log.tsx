import { ArrowRight, Check, Plus } from 'lucide-react';
import { MISSION_MODEL_CALL_LIMIT } from '../../../../packages/contracts/src/mission-limits.js';
import { nextMissionStep } from '../mission-step.js';
import { AgentAvatar, type AgentId } from './characters.js';
import { XP_RULES } from './progress.js';
import { reachedPhase, runRoute, stepState } from './run-route.js';
import { AddRole, QuestApplications } from './applications.js';

const waitingStatus = [
  'AWAITING_JOB',
  'AWAITING_EVIDENCE',
  'AWAITING_APPROVAL',
  'AWAITING_INTERVIEW',
];
const workingStatus = ['QUEUED', 'RUNNING'];

/** The party member whose turn it is, so each quest card shows who holds the ball. */
function holder(m: any): AgentId | 'you' {
  if (waitingStatus.includes(m.status)) return 'you';
  const step = nextMissionStep(m);
  if (step <= 1) return 'coach';
  if (step === 2) return 'matcher';
  if (step === 3) return 'rewriter';
  return 'interviewer';
}

export function questTitle(m: any) {
  const job = m.data?.selectedJob?.job;
  if (job) return job.title;
  const role = m.data?.jobSearch?.keyword || m.goal.split(/[.!?\n]/)[0];
  return role.length > 64 ? role.slice(0, 61) + '…' : role;
}

const nextText: Record<string, { text: string; cta: string; xp?: number }> = {
  AWAITING_JOB: { text: 'Ranked roles are waiting for your pick.', cta: 'Choose a job' },
  AWAITING_EVIDENCE: {
    text: 'The Gap Analyzer has one question about required skills.',
    cta: 'Answer the question',
  },
  AWAITING_APPROVAL: {
    text: 'A Critic-reviewed draft is waiting for your call.',
    cta: 'Review the draft',
    xp: XP_RULES.approvedResume,
  },
  AWAITING_INTERVIEW: {
    text: 'Your interview panel is ready.',
    cta: 'Start practice',
    xp: XP_RULES.practiceAnswer,
  },
  QUEUED: { text: 'Queued. Your party starts shortly.', cta: 'Watch' },
  RUNNING: { text: 'Your party is working. It will stop at the next decision.', cta: 'Watch' },
  COMPLETE: { text: 'Quest complete. Documents and feedback are saved.', cta: 'Open results' },
  FAILED: { text: 'A step failed. Your saved work is intact.', cta: 'Review and retry' },
  NO_MATCHES: { text: 'No roles passed your threshold.', cta: 'Review the search' },
  STALE: { text: 'Your profile changed after this quest started.', cta: 'View history' },
  CANCELLED: { text: 'Cancelled. History is kept read-only.', cta: 'View history' },
};

function QuestCard({ m, onOpen }: { m: any; onOpen: (m: any, phase: number | null) => void }) {
  const d = m.data || {};
  const route = runRoute(m);
  const who = holder(m);
  const copy = nextText[m.status] || { text: m.status, cta: 'Open' };
  const cta =
    m.status === 'FAILED' && (d.apiCalls || 0) >= MISSION_MODEL_CALL_LIMIT
      ? 'Review saved results'
      : copy.cta;
  const rounds = d.resumeTeam?.critiques?.length || 0;
  const job = d.selectedJob?.job;
  const waiting = waitingStatus.includes(m.status);
  return (
    <li className={`ql-card${waiting ? ' waiting' : ''}`}>
      <div className="ql-card-top">
        {who === 'you' ? (
          <span className="ql-you" aria-hidden="true">
            You
          </span>
        ) : (
          <AgentAvatar agent={who} size={44} label={false} />
        )}
        <div className="ql-card-title">
          <h3>{questTitle(m)}</h3>
          <span>
            {[job?.company, job?.location].filter(Boolean).join(' · ') ||
              `Started ${new Date(m.createdAt).toLocaleDateString()}`}
          </span>
        </div>
        {copy.xp && waiting && <span className="quest-chip lime">+{copy.xp} XP</span>}
      </div>
      <ol className="ql-route" aria-label="Run progress">
        {route.map((step) => {
          const { state } = stepState(m, step);
          return (
            <li key={step.label} className={state === 'todo' ? '' : state} title={step.label}>
              <span className="sr-only">
                {step.label}
                {state === 'done' ? ' (done)' : state === 'now' ? ' (current)' : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ql-next">{copy.text}</p>
      <div className="ql-card-foot">
        <span className="ql-meta">
          {d.apiCalls || 0}/{MISSION_MODEL_CALL_LIMIT} mana
          {rounds > 0 && ` · ${rounds} Critic round${rounds === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className={`quest-press${waiting ? ' lime' : ''} ql-go`}
          onClick={() => onOpen(m, m.status === 'COMPLETE' ? null : nextMissionStep(m))}
        >
          {cta}
          <ArrowRight size={16} strokeWidth={2.6} />
        </button>
      </div>
    </li>
  );
}

/**
 * Quests page: the roles the user is pursuing (one quest per role, kept across runs), then the
 * party's runs grouped by who has to act next.
 */
export function QuestLog({
  workspace,
  busy = false,
  onOpen,
  onNewQuest,
  onBuildProfile,
  onTailor,
  onStatus,
  onPractice,
  onRemove,
  onAdd,
  onRecheck,
}: {
  onRecheck?: () => void;
  workspace: any;
  busy?: boolean;
  onPractice?: (applicationId: string) => void;
  onRemove?: (applicationId: string) => void;
  onAdd?: (body: unknown) => Promise<boolean>;
  onOpen: (m: any, phase: number | null) => void;
  onNewQuest: () => void;
  onBuildProfile: () => void;
  onTailor: (applicationId: string) => void;
  onStatus: (applicationId: string, status: string) => void;
}) {
  const applications: any[] = workspace?.applications || [];
  const missions: any[] = workspace?.missions || [];
  const groups = [
    {
      id: 'waiting',
      title: 'Runs waiting on you',
      sub: 'Nothing moves until you decide.',
      items: missions.filter((m) => waitingStatus.includes(m.status)),
    },
    {
      id: 'working',
      title: 'Party at work',
      sub: 'Running on the server. You can leave this page.',
      items: missions.filter((m) => workingStatus.includes(m.status)),
    },
    {
      id: 'ended',
      title: 'Run history',
      sub: 'Read-only. New runs use your latest approved profile.',
      items: missions.filter(
        (m) => !waitingStatus.includes(m.status) && !workingStatus.includes(m.status),
      ),
    },
  ];
  const applied = applications.filter((a) =>
    ['applied', 'interview', 'offer'].includes(a.stage),
  ).length;
  const openRun = (id: string) => {
    const m = missions.find((x) => x.id === id);
    if (m) onOpen(m, m.status === 'COMPLETE' ? null : nextMissionStep(m));
  };
  return (
    <div className="quest-page ql">
      <div className="ql-head">
        <div>
          <span className="quest-sub dark">
            {applications.length} role{applications.length === 1 ? '' : 's'} · {applied} applied
          </span>
          <h1 className="quest-display">Quest log</h1>
          <p>
            Each quest is one role you are pursuing. It keeps every tailored resume and practice run
            for that role, so you can come back after your profile grows.
          </p>
        </div>
        <button
          type="button"
          className="quest-press lime"
          onClick={workspace?.profile ? onNewQuest : onBuildProfile}
        >
          <Plus size={18} strokeWidth={2.8} />
          {workspace?.profile ? 'Find roles' : 'Build my profile first'}
        </button>
      </div>
      {workspace?.profile && onAdd && <AddRole busy={busy} onAdd={onAdd} />}
      {workspace?.profile && (
        <QuestApplications
          applications={applications}
          busy={busy}
          onOpenRun={openRun}
          onTailor={onTailor}
          onStatus={onStatus}
          onPractice={onPractice}
          onRemove={onRemove}
          onRecheck={onRecheck}
        />
      )}
      {missions.length > 0 && (
        <div className="qa-runs-head">
          <h2 className="quest-display">Party runs</h2>
          <p>Searches, resume teams and interview practice, newest first.</p>
        </div>
      )}
      {missions.length === 0 && !workspace?.profile ? (
        <section className="quest-tile ql-empty">
          <div className="ql-empty-party" aria-hidden="true">
            {(['scout', 'coach', 'matcher', 'critic'] as const).map((id) => (
              <AgentAvatar key={id} agent={id} size={52} label={false} />
            ))}
          </div>
          <h2>No quests yet</h2>
          <p>
            Start one with a goal such as “graduate data analyst in Sydney”. Your party will analyse
            your approved profile, rank real roles and wait for your decisions.
          </p>
        </section>
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.id} className={`ql-group ${g.id}`} aria-labelledby={`ql-${g.id}`}>
              <div className="ql-group-head">
                <h2 id={`ql-${g.id}`}>
                  {g.title} <span className="ql-count">{g.items.length}</span>
                </h2>
                <span>{g.sub}</span>
              </div>
              <ul className="ql-grid">
                {g.items.map((m) => (
                  <QuestCard key={m.id} m={m} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}

const statusChip: Record<string, { label: string; tone: string }> = {
  AWAITING_JOB: { label: 'Your call', tone: 'coral' },
  AWAITING_EVIDENCE: { label: 'Your answer', tone: 'coral' },
  AWAITING_APPROVAL: { label: 'Your call', tone: 'coral' },
  AWAITING_INTERVIEW: { label: 'Your turn', tone: 'coral' },
  QUEUED: { label: 'Queued', tone: 'lilac' },
  RUNNING: { label: 'Party at work', tone: 'lilac' },
  COMPLETE: { label: 'Complete', tone: 'lime' },
};

const headline = (m: any, phase: number | null) => {
  if (phase === 0) return 'Profile used for this quest';
  if (phase === 1)
    return m.data?.analysis ? 'Career analysis' : 'Reading your profile…';
  if (phase === 2)
    return m.status === 'AWAITING_JOB'
      ? 'Pick a role.'
      : m.data?.selectedJob
        ? 'Role chosen.'
        : 'Ranking roles…';
  if (phase === 3)
    return m.status === 'AWAITING_EVIDENCE'
      ? 'One question before the draft.'
      : m.status === 'AWAITING_APPROVAL'
      ? 'Review your resume.'
      : m.data?.approvedResumeId
        ? 'Resume approved and saved.'
        : 'Tailoring your resume…';
  if (phase === 4)
    return m.status === 'COMPLETE' ? 'Interview feedback' : 'Interview practice';
  if (phase === 7) return 'Apply';
  if (phase === 8) return 'Battle log';
  if (phase === 9) return 'Save points';
  return questTitle(m);
};

/** Mission header: where this quest stands, plus a clickable five-step route. */
export function QuestMissionHeader({
  mission: m,
  phase,
  onBack,
  onSelect,
}: {
  mission: any;
  phase: number | null;
  onBack: () => void;
  onSelect: (step: number) => void;
}) {
  const reached = reachedPhase(m);
  const chip = statusChip[m.status] || {
    label: m.status.toLowerCase().replace(/_/g, ' '),
    tone: '',
  };
  const job = m.data?.selectedJob?.job;
  const xp =
    m.status === 'AWAITING_APPROVAL' && phase === 3
      ? XP_RULES.approvedResume
      : m.status === 'AWAITING_INTERVIEW' && phase === 4
        ? XP_RULES.practiceAnswer
        : null;
  return (
    <header className="qm-head">
      <div className="qm-top">
        <button type="button" className="qm-back" onClick={onBack}>
          ← Quest log
        </button>
        <span className="qm-crumb">
          Main quest ·{' '}
          {job ? `${job.title}${job.company ? ` at ${job.company}` : ''}` : questTitle(m)}
        </span>
        <span className="qm-tools">
          {phase !== null && phase >= 8 ? (
            <button type="button" className="qm-log on" onClick={() => onSelect(reached)}>
              Back to the quest
            </button>
          ) : null}
          {phase !== 8 && (
            <button type="button" className="qm-log" onClick={() => onSelect(8)}>
              Battle log · {(m.events || []).length} events
            </button>
          )}
          {phase !== 9 && (
            <button type="button" className="qm-log" onClick={() => onSelect(9)}>
              Save points
            </button>
          )}
        </span>
      </div>
      <div className="qm-title-row">
        <h1 className="quest-display qm-title">{headline(m, phase)}</h1>
        <div className="qm-chips">
          <span className={`quest-chip ${chip.tone}`}>{chip.label}</span>
          {m.mode === 'fixture' && <span className="quest-chip outline">Demo data</span>}
          {xp && (
            <span className="quest-chip lime">
              +{xp} XP on {phase === 3 ? 'approval' : 'each answer'}
            </span>
          )}
        </div>
      </div>
      <ol className="qm-route" aria-label="Quest route">
        {runRoute(m).map((step, i) => {
          const { state, open } = stepState(m, step);
          return (
            <li key={step.label}>
              <button
                type="button"
                className={`qm-step ${state}${phase === step.phase ? ' viewing' : ''}`}
                aria-current={phase === step.phase ? 'step' : undefined}
                disabled={!open}
                onClick={() => onSelect(step.phase)}
              >
                <span className="qm-dot" aria-hidden="true">
                  {state === 'done' ? <Check size={14} strokeWidth={3.2} /> : i + 1}
                </span>
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
