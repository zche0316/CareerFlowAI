import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';

type Checkpoint = {
  checkpointId: string;
  step: number;
  at: string | null;
  source: string | null;
  next: string[];
};
type SaveData = {
  checkpoints: Checkpoint[];
  branchable: { analysis: boolean; shortlist: boolean };
  branchedFrom: { missionId: string; savePoint: string; at: string } | null;
  branches: {
    id: string;
    status: string;
    createdAt: string;
    savePoint: string;
    job: string | null;
  }[];
};

// What a checkpoint means for the person, keyed by the node it would run next.
const slotLabel: Record<string, { title: string; who: string }> = {
  career_coach: { title: 'Quest started', who: 'Orchestrator' },
  job_matching: { title: 'Analysis saved', who: 'Career Coach' },
  select_job: { title: 'Shortlist ready', who: 'Job Matcher' },
  resume_team: { title: 'Job chosen', who: 'you' },
  // Shown instead when the quest is paused at this stage.
  waiting: { title: 'Waiting for your call', who: 'paused' },
  interview_questions: { title: 'Resume approved', who: 'you' },
  conduct_interview: { title: 'Interview ready', who: 'Interview Coach' },
  interview_feedback: { title: 'Answers submitted', who: 'you' },
  end: { title: 'Quest complete', who: 'Interview Coach' },
};

const branchFor: Record<string, 'analysis' | 'shortlist'> = {
  job_matching: 'analysis',
  select_job: 'shortlist',
};

type Slot = Checkpoint & { key: string; checkpoints: number };

/** One slot per stage: the first checkpoint that planned each next node, plus the latest. */
function slotsFrom(checkpoints: Checkpoint[]): Slot[] {
  const slots: Slot[] = [];
  for (const c of checkpoints) {
    if (c.next[0] === '__start__') continue; // LangGraph's input checkpoint, before any agent
    const key = c.next[0] || (c.step >= 0 ? 'end' : '');
    if (!key) continue;
    const last = slots.at(-1);
    if (last && last.key === key) {
      last.checkpoints += 1;
      continue;
    }
    slots.push({ ...c, key, checkpoints: 1 });
  }
  return slots;
}

const when = (at: string | null) =>
  at
    ? new Date(at).toLocaleString([], {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '–';

export function QuestSavePoints({
  mission: m,
  request,
  onOpenMission,
}: {
  mission: any;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onOpenMission: (id: string) => void;
}) {
  const [data, setData] = useState<SaveData | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    request(`/missions/${m.id}/save-points`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message || 'Save points are unavailable.'));
    return () => {
      live = false;
    };
  }, [m.id, m.status]);

  if (error) return <p className="quest-note coral">{error}</p>;
  if (!data) return <p className="quest-fine dark">Loading save points…</p>;

  const slots = slotsFrom(data.checkpoints);
  const now = slots.length - 1;
  const paused = ['AWAITING_JOB', 'AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'AWAITING_INTERVIEW'].includes(m.status);
  const label = (s: Slot) =>
    slotLabel[s === slots[now] && paused ? 'waiting' : s.key] || { title: s.key, who: 'party' };
  const firstFork = slots.findIndex((s) => branchFor[s.key]);
  const selected = slots[pick ?? (firstFork >= 0 ? firstFork : now)];
  const point = selected ? branchFor[selected.key] : undefined;
  const canBranch = point ? data.branchable[point] : false;
  const branch = async () => {
    if (!point) return;
    setBusy(true);
    setError('');
    try {
      const made = await request(`/missions/${m.id}/branch`, 'POST', { from: point });
      onOpenMission(made.id);
    } catch (e: any) {
      setError(e.message || 'Branching failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quest-page sp">
      <div className="sp-summary">
        <span className="quest-chip outline">
          {data.checkpoints.length} checkpoints · {slots.length} save points
        </span>
        <span className="quest-chip outline">
          {data.branches.length} branch{data.branches.length === 1 ? '' : 'es'}
        </span>
        {data.branchedFrom && (
          <button
            type="button"
            className="quest-chip lilac sp-link"
            onClick={() => onOpenMission(data.branchedFrom!.missionId)}
          >
            Branched from quest {data.branchedFrom.missionId.slice(0, 8)} ·{' '}
            {data.branchedFrom.savePoint === 'shortlist' ? 'job choice' : 'analysis'}
          </button>
        )}
      </div>
      <div className="quest-row sp-main">
        <section className="quest-tile ink sp-runs" aria-labelledby="sp-runs">
          <div className="quest-tile-head">
            <h2 id="sp-runs">Your runs</h2>
            <span>Select a save to inspect it</span>
          </div>
          <span className="quest-chip lime">This quest</span>
          {slots.length ? (
            <ol className="sp-track">
              {slots.map((s, i) => (
                <li key={s.checkpointId}>
                  <button
                    type="button"
                    className={`sp-slot${selected === s ? ' sel' : ''}${i === now ? ' now' : ''}`}
                    aria-pressed={selected === s}
                    onClick={() => setPick(i)}
                  >
                    <span className="sp-num">
                      SAVE {i + 1}
                      {i === now ? ' · NOW' : ''}
                    </span>
                    <strong>{label(s).title}</strong>
                    <small>
                      {when(s.at)} · {label(s).who}
                    </small>
                    {branchFor[s.key] && <span className="sp-fork" aria-label="Can branch here" />}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="bl-empty">
              No checkpoints yet. The first one appears when the party starts.
            </p>
          )}
          {data.branches.length > 0 && (
            <div className="sp-branches">
              {data.branches.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  className="sp-branch"
                  onClick={() => onOpenMission(b.id)}
                >
                  <GitBranch size={16} />
                  Run {String.fromCharCode(66 + i)} · from{' '}
                  {b.savePoint === 'shortlist' ? 'job choice' : 'analysis'}
                  {b.job ? ` · ${b.job}` : ''} · {b.status.toLowerCase().replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )}
          <p className="sp-foot">
            Each save is a LangGraph checkpoint stored in PostgreSQL. Branching starts a new quest
            seeded with the results saved up to that point; agents that already finished skip, so
            nothing is regenerated.
          </p>
        </section>

        {selected && (
          <aside className="quest-tile sp-inspect" aria-labelledby="sp-inspect">
            <span className="quest-chip lilac">Save {slots.indexOf(selected) + 1}</span>
            <h2 id="sp-inspect">{label(selected).title}</h2>
            <span className="quest-sub dark">
              {when(selected.at)} · {selected.checkpoints} checkpoint
              {selected.checkpoints === 1 ? '' : 's'} at this stage
            </span>
            {point ? (
              <div className="sp-if">
                <span>IF YOU BRANCH FROM HERE</span>
                <p>
                  <b>=</b> Approved facts and approved resumes stay untouched.
                </p>
                <p>
                  <b>=</b> This quest stays exactly where it is.
                </p>
                <p>
                  <b>↻</b>{' '}
                  {point === 'shortlist'
                    ? 'You choose a job again from the same shortlist.'
                    : 'Job Matcher searches again with the same analysis.'}
                </p>
                <p>
                  <b>≈</b>{' '}
                  {point === 'shortlist'
                    ? 'No model calls until you choose. The new quest has its own 60-call budget.'
                    : 'Only matching reruns. The new quest has its own 60-call budget.'}
                </p>
              </div>
            ) : (
              <p className="quest-note">
                Branching is available from the analysis and job-choice saves. Later saves hold your
                approvals, which are never replayed.
              </p>
            )}
            <pre className="bl-span">
              {`checkpoint: ${selected.checkpointId.slice(0, 13)}…\nstep: ${selected.step}\nnext: ${selected.next.join(', ') || 'end'}\nsource: ${selected.source || '–'}`}
            </pre>
            {point && (
              <button
                type="button"
                className="quest-press sky"
                disabled={!canBranch || busy}
                onClick={() => void branch()}
              >
                <GitBranch size={18} />
                {busy ? 'Branching…' : 'Branch from this save'}
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
