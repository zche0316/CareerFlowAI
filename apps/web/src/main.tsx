import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Layers,
  FileCheck2,
  Activity,
  LogOut,
  Plus,
  X,
  Pause,
  RefreshCw,
  ShieldCheck,
  BriefcaseBusiness,
  MessageSquare,
  Clock3,
  BookOpen,
  Download,
  CheckCircle2,
  AlertCircle,
  Target,
} from 'lucide-react';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import './style.css';

// The session endpoint supplies this token; all JSON mutations share the same request wrapper.
let csrf = '';

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(data.error || 'Something went wrong.') as Error & {
      fields?: Record<string, string[]>;
    };
    e.fields = data.fields;
    throw e;
  }
  return data;
}

const nice = (s: string) => s.toLowerCase().replaceAll('_', ' ');

const date = (s: string) =>
  new Date(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

type Tab = 'missions' | 'profile' | 'approvals' | 'library' | 'activity';

// Own workspace navigation and refreshes here; the server remains the source of mission status.
function App() {
  const [session, setSession] = useState<any>(null),
    [ready, setReady] = useState(false),
    [workspace, setWorkspace] = useState<any>(null),
    [tab, setTab] = useState<Tab>('missions'),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [minScore, setMinScore] = useState(40),
    [goal, setGoal] = useState(
      'Find an entry-level data analyst role in Sydney and help me prepare a factual application.',
    ),
    [notice, setNotice] = useState('');

  const refresh = async () => {
    const w = await api('/workspace');
    setWorkspace(w);
    return w;
  };

  useEffect(() => {
    api('/session')
      .then((s) => {
        csrf = s.csrf || '';
        setSession(s);
        if (s.user) void refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!session?.user) return;

    // Observe background progress without tying execution to the lifetime of this page.
    const id = setInterval(() => {
      void refresh().catch(() => {});
    }, 1800);
    return () => clearInterval(id);
  }, [session?.user?.id]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (csrf) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mission = workspace?.missions.find((m: any) => m.id === selected);
  const approvals =
    workspace?.missions.filter((m: any) =>
      ['AWAITING_JOB', 'AWAITING_APPROVAL'].includes(m.status),
    ) || [];
  if (!ready) return <div className="loading">Opening your workspace…</div>;
  if (!session?.user)
    return (
      <Login
        session={session}
        error={error}
        onLogin={(s: any) => {
          csrf = s.csrf;
          setSession({ ...session, ...s });
          setError('');
          void refresh();
        }}
      />
    );
  const nav = [
    { id: 'missions', label: 'Career missions', icon: Compass },
    { id: 'profile', label: 'My career profile', icon: Layers },
    { id: 'approvals', label: 'Approval inbox', icon: FileCheck2 },
    { id: 'library', label: 'Document library', icon: BookOpen },
    { id: 'activity', label: 'Activity timeline', icon: Activity },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="CareerFlow home">
          <span className="brandmark">
            <Compass size={25} />
          </span>
          CareerFlow<span className="brand-ai">AI</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? 'nav active' : 'nav'}
              onClick={() => {
                setTab(n.id as Tab);
                setSelected(null);
                setError('');
              }}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === 'approvals' && approvals.length > 0 && (
                <span className="count">{approvals.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="tiny-label">ONE GOAL. A TEAM BEHIND YOU.</div>
          <p>
            Five specialist agents.
            <br />
            Your decisions, always.
          </p>
          <div className="agent-dots">
            <i>PB</i>
            <i>CC</i>
            <i>JM</i>
            <i>RT</i>
            <i>IC</i>
          </div>
        </div>
        <div className="account">
          <span className="avatar">
            {session.user.name
              .split(' ')
              .map((x: string) => x[0])
              .join('')
              .slice(0, 2)}
          </span>
          <div>
            <strong>{session.user.name}</strong>
            <small>Career workspace</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() =>
              void act(async () => {
                await api('/logout', 'POST', {});
                csrf = '';
                setSession({ ...session, user: null });
                setWorkspace(null);
              })
            }
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <span>{nav.find((n) => n.id === tab)?.label}</span>
          </div>
          <span className={`provider ${session.mode === 'fixture' ? 'fixture' : ''}`}>
            <i />
            {session.mode === 'fixture' ? 'Demo fixtures · no live AI' : 'Live AI enabled'}
          </span>
        </header>
        <main>
          {error && (
            <div role="alert" className="error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
                <X size={14} />
              </button>
            </div>
          )}
          {tab === 'profile' ? (
            <Profile
              profile={workspace?.profile}
              sample={workspace?.sampleProfile}
              busy={busy}
              onBuild={async (input) => api('/profiles/prepare', 'POST', input)}
              onDraft={async (input) => api('/profiles/drafts', 'POST', input)}
              onApprove={async (id) =>
                act(async () => {
                  await api(`/profiles/drafts/${id}/approve`, 'POST', { reviewed: true });
                  setNotice(
                    'Your reviewed profile is now approved. Previous documents remain available.',
                  );
                })
              }
              onDiscard={async (id) =>
                act(async () => {
                  await api(`/profiles/drafts/${id}`, 'DELETE');
                })
              }
            />
          ) : tab === 'missions' ? (
            <>
              {mission ? (
                <MissionDetail
                  mission={mission}
                  busy={busy}
                  onBack={() => setSelected(null)}
                  onAction={(kind, body) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/${kind}`, 'POST', body || {});
                    })
                  }
                  onSaveAnswer={(a) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/answers`, 'PUT', a);
                    })
                  }
                  onRefineAnalysis={(feedback) =>
                    act(async () => {
                      const refined = await api('/missions', 'POST', {
                        goal: mission.goal,
                        minScore: mission.data.minScore ?? 40,
                        analysisFeedback: feedback,
                        sourceMissionId: mission.id,
                      });
                      setSelected(refined.id);
                      setNotice('A refined career analysis is queued.');
                    })
                  }
                />
              ) : (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">BUILD YOUR NEXT CHAPTER</div>
                      <h1>A clearer path forward.</h1>
                      <p>Set your direction. Let your career team take the next steps.</p>
                    </div>
                    <button className="primary" onClick={() => setCreating(true)}>
                      <Plus size={17} />
                      New career mission
                    </button>
                  </div>
                  <section className="hero">
                    <div className="hero-copy">
                      <span className="tag light">YOUR CAREER, CONNECTED</span>
                      <h2>
                        One goal.
                        <br />
                        Five specialists on your side.
                      </h2>
                      <p>
                        From understanding your strengths to preparing for an interview, keep every
                        step connected to the facts that make you, you.
                      </p>
                      <button
                        className="hero-link"
                        onClick={() => (workspace?.profile ? setCreating(true) : setTab('profile'))}
                      >
                        {workspace?.profile
                          ? 'Start your next mission'
                          : 'Build your career profile'}
                        <ArrowUpRight size={18} />
                      </button>
                    </div>
                    <div className="hero-orbit" aria-hidden="true">
                      <div className="orbit-label orbit-a">
                        <Layers size={17} />
                        Your profile
                      </div>
                      <div className="orbit-label orbit-b">
                        <BriefcaseBusiness size={17} />
                        The right opportunity
                      </div>
                      <div className="orbit-label orbit-c">
                        <MessageSquare size={17} />
                        Your next conversation
                      </div>
                      <div className="orbit-center">
                        <Compass size={48} />
                        <span>YOUR DIRECTION</span>
                      </div>
                      <div className="orbit-ring" />
                    </div>
                  </section>
                  <div className="stats">
                    <Stat
                      label="Career missions"
                      value={workspace?.missions.length || 0}
                      sub="Every goal in one place"
                    />
                    <Stat
                      label="Waiting for you"
                      value={
                        workspace?.missions.filter((m: any) => m.status.startsWith('AWAITING'))
                          .length || 0
                      }
                      sub="Meaningful decisions only"
                    />
                    <Stat
                      label="Approved documents"
                      value={workspace?.resumes.length || 0}
                      sub="Grounded in your evidence"
                    />
                    <Stat
                      label="Career profile"
                      value={workspace?.profile ? 'v' + workspace.profile.version : 'Not set'}
                      sub={workspace?.profile ? 'Reviewed and approved' : 'Your first step forward'}
                    />
                  </div>
                  <section>
                    <div className="section-heading">
                      <h2>
                        Your missions <span>{workspace?.missions.length || 0}</span>
                      </h2>
                      <span className="muted">Progress continues while this page is closed</span>
                    </div>
                    {workspace?.missions.length ? (
                      <div className="mission-grid">
                        {workspace.missions.map((m: any) => (
                          <button
                            className="mission-card"
                            key={m.id}
                            onClick={() => setSelected(m.id)}
                          >
                            <div className="card-top">
                              <span className="mission-icon">
                                <Target size={20} />
                              </span>
                              <Status value={m.status} />
                            </div>
                            <h3>{m.goal}</h3>
                            <p>
                              {m.status === 'COMPLETE'
                                ? 'Your interview feedback is ready. Review your next steps.'
                                : m.status === 'AWAITING_JOB'
                                  ? 'Your ranked opportunities are ready. Choose a target role.'
                                  : m.status === 'AWAITING_APPROVAL'
                                    ? 'Your factual resume draft is ready for review.'
                                    : m.status === 'AWAITING_INTERVIEW'
                                      ? 'Your personalised interview practice is ready.'
                                      : m.status === 'FAILED'
                                        ? m.error
                                        : m.status === 'STALE'
                                          ? 'Your profile changed. Start a new mission using current evidence.'
                                          : 'Your career team is working through the next step.'}
                            </p>
                            <div className="card-footer">
                              <span>
                                {date(m.createdAt)} ·{' '}
                                {m.mode === 'fixture' ? 'Demo fixtures' : 'Live AI'}
                              </span>
                              <ArrowUpRight size={17} />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <Compass size={30} />
                        <h3>Your next opportunity starts with a mission.</h3>
                        <p>
                          {workspace?.profile
                            ? 'Choose a career goal and your team will help you move it forward.'
                            : 'Review and approve your career profile, then start a goal-led mission.'}
                        </p>
                        <button
                          className="secondary"
                          onClick={() =>
                            workspace?.profile ? setCreating(true) : setTab('profile')
                          }
                        >
                          {workspace?.profile ? 'Create your first mission' : 'Create your profile'}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="team">
                    <div className="section-heading">
                      <h2>Meet your career team</h2>
                      <span className="muted">Specialist roles. Shared, approved context.</span>
                    </div>
                    <div className="team-grid">
                      {workspace?.agents.map((a: any, i: number) => (
                        <div key={a.id}>
                          <span className="team-number">0{i + 1}</span>
                          <h3>{a.name}</h3>
                          <p>{a.purpose}</p>
                          <span className="tiny-label">{a.requirement}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          ) : tab === 'approvals' ? (
            <>
              <PageTitle
                eyebrow="YOUR DECISIONS, ALWAYS"
                title="Approval inbox"
                text="Review the important moments. Your agents will wait for your decision."
              />
              {approvals.length ? (
                approvals.map((m: any) => (
                  <button
                    className="approval-card"
                    key={m.id}
                    onClick={() => {
                      setTab('missions');
                      setSelected(m.id);
                    }}
                  >
                    <FileCheck2 size={24} />
                    <div>
                      <h3>
                        {m.status === 'AWAITING_JOB'
                          ? 'Choose a target opportunity'
                          : 'Review your resume draft'}
                      </h3>
                      <p>{m.goal}</p>
                    </div>
                    <ArrowRight size={20} />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <CheckCircle2 size={32} />
                  <h3>You’re all caught up.</h3>
                  <p>Important decisions will appear here when your team needs you.</p>
                </div>
              )}
            </>
          ) : tab === 'library' ? (
            <>
              <PageTitle
                eyebrow="YOUR APPROVED WORK"
                title="Document library"
                text="Approved versions stay available, even when you update your profile."
              />
              {workspace?.resumes.length ? (
                workspace.resumes.map((r: any) => (
                  <div className="document-card" key={r.id}>
                    <FileCheck2 size={28} />
                    <div>
                      <h3>{r.content.jobTitle}</h3>
                      <p>
                        Approved {date(r.approvedAt)} · Profile v{r.content.profileVersion} ·{' '}
                        {r.content.claims.length} evidence-linked claims
                      </p>
                    </div>
                    <a className="secondary" href={`/api/resumes/${r.id}/download`}>
                      <Download size={16} />
                      Download
                    </a>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <BookOpen size={30} />
                  <h3>A home for your approved documents.</h3>
                  <p>Once you review and approve a resume, it will be kept here.</p>
                </div>
              )}
            </>
          ) : (
            <>
              <PageTitle
                eyebrow="VISIBLE EVERY STEP OF THE WAY"
                title="Activity timeline"
                text="See completed actions, tool use and the decisions that moved your missions forward."
              />
              {workspace?.missions.flatMap((m: any) =>
                m.events.map((e: any, i: number) => (
                  <div key={m.id + i} className="timeline-event">
                    <span className="timeline-dot" />
                    <div>
                      <strong>{e.agent}</strong>
                      <span className="event-action">{nice(e.action)}</span>
                      <p>{e.detail}</p>
                      <small>{new Date(e.at).toLocaleString('en-AU')}</small>
                    </div>
                  </div>
                )),
              )}
              {!workspace?.missions.length && (
                <div className="empty-state">
                  <Activity size={30} />
                  <h3>Your story will unfold here.</h3>
                  <p>Start a mission to see your team in action.</p>
                </div>
              )}
            </>
          )}
        </main>
        <footer>
          CareerFlow AI <span>Built around your evidence. Guided by your decisions.</span>
        </footer>
      </div>
      {creating && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mission-title"
          >
            <button
              className="modal-close"
              aria-label="Close mission form"
              onClick={() => setCreating(false)}
            >
              <X />
            </button>
            <span className="eyebrow">GIVE YOUR TEAM A DIRECTION</span>
            <h2 id="mission-title">What’s your next career goal?</h2>
            <p>
              Your team will analyse your approved profile, find relevant opportunities and prepare
              your next steps.
            </p>
            <label>
              Career goal
              <textarea autoFocus value={goal} onChange={(e) => setGoal(e.target.value)} />
            </label>
            <label>
              Minimum job suitability: {minScore}/100
              <input
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
              />
            </label>
            <div className="info">
              <ShieldCheck size={18} />
              <span>
                You choose the target job and approve the exact resume before it is saved.
              </span>
            </div>
            {!workspace?.profile ? (
              <button
                className="primary full"
                onClick={() => {
                  setCreating(false);
                  setTab('profile');
                }}
              >
                Create an approved profile first
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="primary full"
                disabled={busy || goal.trim().length < 5}
                onClick={() =>
                  void act(async () => {
                    const m = await api('/missions', 'POST', { goal, minScore });
                    setCreating(false);
                    setSelected(m.id);
                  })
                }
              >
                {busy ? 'Starting…' : 'Start career mission'}
                <ArrowRight size={17} />
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Login({
  session,
  error,
  onLogin,
}: {
  session: any;
  error: string;
  onLogin: (s: any) => void;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [register, setRegister] = useState(false),
    [err, setErr] = useState(error),
    [busy, setBusy] = useState(false);
  const submit = async (path: string, body?: unknown) => {
    setBusy(true);
    setErr('');
    try {
      onLogin(await api('/auth/' + path, 'POST', body || {}));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <section className="login-brand">
        <div className="brand">
          <span className="brandmark">
            <Compass />
          </span>
          CareerFlow AI
        </div>
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            Big career goals.
            <br />A team to get
            <br />
            you there.
          </h1>
          <p>
            Five specialist agents, one connected workspace.
            <br />
            Built around your facts and your decisions.
          </p>
        </div>
        <small>A private workspace for your professional future.</small>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">WELCOME TO CAREERFLOW</span>
          <h2>{register ? 'Create your workspace' : 'Your direction starts here.'}</h2>
          <p>
            {register
              ? 'Keep your career context connected and under your control.'
              : 'Sign in to continue your career journey.'}
          </p>
          {err && (
            <div role="alert" className="error-banner">
              {err}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(register ? 'register' : 'login', {
                email,
                password,
                ...(register ? { name } : {}),
              });
            }}
          >
            {register && (
              <label>
                Your name
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                minLength={10}
                required
                autoComplete={register ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? 'Opening…' : register ? 'Create workspace' : 'Sign in'}
              <ArrowRight size={17} />
            </button>
          </form>
          <button className="text-button" onClick={() => setRegister(!register)}>
            {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
          {session?.demoEnabled && (
            <>
              <div className="divider">OR EXPLORE FIRST</div>
              <button
                className="secondary full"
                disabled={busy}
                onClick={() => void submit('demo')}
              >
                Open demo workspace
                <ArrowUpRight size={16} />
              </button>
              <p className="small muted">
                Shared fictional candidate and sample jobs. Demo fixture mode does not make live AI
                calls.
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {['RUNNING', 'QUEUED'].includes(value) && <span className="pulse" />}
      {nice(value)}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

const coachText = (item: any) =>
  typeof item === 'string' ? item : item?.text || item?.title || '';

function CoachEvidence({ item }: { item: any }) {
  if (!item || typeof item === 'string') return null;
  return (
    <small>
      Evidence: {item.evidenceIds?.join(', ') || 'Unavailable'}
      {item.reason ? ` · ${item.reason}` : ''}
    </small>
  );
}

// Keep editable input, prepared draft and explicit review confirmation as separate UI states.
function Profile({
  profile,
  sample,
  busy,
  onBuild,
  onDraft,
  onApprove,
  onDiscard,
}: {
  profile: any;
  sample: CareerProfile | undefined;
  busy: boolean;
  onBuild: (input: { notes: string; currentProfile: CareerProfile }) => Promise<{
    data: CareerProfile;
    followUpQuestions: string[];
    proposedChanges: { field: string; proposedValue: string; evidence: string }[];
    discardedFields: string[];
  }>;
  onDraft: (p: CareerProfile) => Promise<any>;
  onApprove: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}) {
  // Preserve raw comma-separated text while typing; parse it when preparing the draft.
  const [skillInput, setSkillInput] = useState(''),
    [interestInput, setInterestInput] = useState('');
  const [form, setForm] = useState<CareerProfile | null>(null),
    [draft, setDraft] = useState<any>(null),
    [reviewed, setReviewed] = useState(false),
    [preparing, setPreparing] = useState(false),
    [building, setBuilding] = useState(false),
    [builderNotes, setBuilderNotes] = useState(''),
    [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]),
    [proposedChanges, setProposedChanges] = useState<
      { field: string; proposedValue: string; evidence: string }[]
    >([]),
    [discardedFields, setDiscardedFields] = useState<string[]>([]),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string[]>>({});

  useEffect(() => {
    // Reset only when the approved version changes, not on each workspace poll.
    if (profile?.data) {
      setForm(profile.data);
      setSkillInput(profile.data.skills.join(', '));
      setInterestInput(profile.data.interests.join(', '));
    } else if (sample) {
      setForm({
        ...sample,
        name: '',
        goals: '',
        skills: [],
        interests: [],
        education: '',
        experience: '',
      });
      setSkillInput('');
      setInterestInput('');
    }
    setDraft(null);
    setReviewed(false);
    setFollowUpQuestions([]);
    setProposedChanges([]);
    setDiscardedFields([]);
  }, [profile?.id, Boolean(sample)]);
  if (!form) return <div className="loading">Loading your profile…</div>;

  const change = (key: keyof CareerProfile, value: any) => {
    setForm({ ...form, [key]: value });
    setDraft(null);
    setReviewed(false);
  };

  const input = (
    key: keyof CareerProfile,
    label: string,
    options: { type?: string; area?: boolean; placeholder?: string } = {},
  ) => (
    <label>
      {label}
      {options.area ? (
        <textarea
          value={String(form[key] ?? '')}
          placeholder={options.placeholder}
          onChange={(e) => change(key, e.target.value)}
        />
      ) : (
        <input
          type={options.type || 'text'}
          value={String(form[key] ?? '')}
          placeholder={options.placeholder}
          onChange={(e) =>
            change(
              key,
              options.type === 'number'
                ? e.target.value === ''
                  ? null
                  : Number(e.target.value)
                : e.target.value || (key === 'startDate' || key === 'endDate' ? null : ''),
            )
          }
        />
      )}{' '}
      {fields[key]?.map((s) => (
        <span className="field-error" key={s}>
          {s}
        </span>
      ))}
    </label>
  );

  async function prepare() {
    setPreparing(true);
    setError('');
    setFields({});
    try {
      setDraft(await onDraft(form!));
      setReviewed(false);
    } catch (e) {
      setError((e as Error).message);
      setFields((e as any).fields || {});
    } finally {
      setPreparing(false);
    }
  }

  async function buildWithAi() {
    setBuilding(true);
    setError('');
    setFields({});
    try {
      const result = await onBuild({ notes: builderNotes, currentProfile: form! });
      setForm(result.data);
      setSkillInput(result.data.skills.join(', '));
      setInterestInput(result.data.interests.join(', '));
      setFollowUpQuestions(result.followUpQuestions);
      setProposedChanges(result.proposedChanges);
      setDiscardedFields(result.discardedFields);
      setDraft(null);
      setReviewed(false);
    } catch (e) {
      // The current form remains intact so manual completion is always available.
      setError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="THE FOUNDATION OF EVERY RECOMMENDATION"
        title="Your career profile"
        text="Your confirmed facts give your agents a reliable place to start."
      />
      <div className="profile-layout">
        <section className="panel">
          <div className="section-heading">
            <h2>Career information</h2>
            {profile ? (
              <span className="tag">Approved v{profile.version}</span>
            ) : (
              <span className="tag">Not approved yet</span>
            )}
          </div>
          <p className="muted">
            Enter only information you can support. Use “none yet” for education or experience you
            do not have.
          </p>
          {error && (
            <div role="alert" className="error-banner">
              {error}
            </div>
          )}
          <div className="sharing">
            <h3>Profile Builder</h3>
            <p className="muted">
              Describe your background in your own words. Profile Builder can organise only the
              supplied information, identify missing details and propose follow-up questions. You
              still review, edit and approve every field.
            </p>
            <label>
              Notes for Profile Builder
              <textarea
                value={builderNotes}
                onChange={(e) => setBuilderNotes(e.target.value)}
                placeholder="For example: I studied information technology, know Python and SQL, want an entry-level data role in Sydney, and prefer hybrid work."
              />
            </label>
            <div className="form-actions">
              <button
                className="secondary"
                disabled={busy || building || builderNotes.trim().length < 10}
                onClick={() => void buildWithAi()}
              >
                {building ? 'Organising…' : 'Organise with Profile Builder'}
                <Compass size={15} />
              </button>
              <span className="small muted">
                AI suggestions never approve or save the profile automatically.
              </span>
            </div>
            {followUpQuestions.length > 0 && (
              <div className="info">
                <MessageSquare size={17} />
                <div>
                  <strong>Details to clarify</strong>
                  <ul>
                    {followUpQuestions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                  <p className="small muted">
                    Add these details to your notes, run Profile Builder again, or complete the
                    fields manually.
                  </p>
                </div>
              </div>
            )}
            {proposedChanges.length > 0 && (
              <details>
                <summary>Review Profile Builder proposed changes</summary>
                <ul>
                  {proposedChanges.map((change, index) => (
                    <li key={`${change.field}-${index}`}>
                      <strong>{nice(change.field)}</strong>: {change.proposedValue}
                      <small>Evidence: “{change.evidence}”</small>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {discardedFields.length > 0 && (
              <div className="info">
                <AlertCircle size={17} />
                <span>
                  Unsupported suggestions were discarded for: {discardedFields.map(nice).join(', ')}
                  . Your current values were left unchanged.
                </span>
              </div>
            )}
          </div>
          <div className="form-grid">
            {input('name', 'Full name')}
            {input('location', 'Preferred location', { placeholder: 'Optional' })}
            <label className="wide">
              Skills · comma separated
              <input
                value={skillInput}
                onChange={(e) => {
                  setSkillInput(e.target.value);
                  change(
                    'skills',
                    e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  );
                }}
              />
              {fields.skills?.map((s) => (
                <span className="field-error" key={s}>
                  {s}
                </span>
              ))}
            </label>
            <label className="wide">
              Career interests · comma separated
              <input
                value={interestInput}
                onChange={(e) => {
                  setInterestInput(e.target.value);
                  change(
                    'interests',
                    e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  );
                }}
              />
            </label>
            <div className="wide">{input('goals', 'Career goals', { area: true })}</div>
            <div className="wide">
              {input('education', 'Education or “none yet”', { area: true })}
            </div>
            <div className="wide">
              {input('experience', 'Experience and projects or “none yet”', { area: true })}
            </div>
            {input('experienceYears', 'Years of experience', { type: 'number' })}
            {input('employmentType', 'Employment preference', { placeholder: 'Optional' })}
            {input('workArrangement', 'Work arrangement', { placeholder: 'e.g. Hybrid' })}
            {input('companySize', 'Company size preference', { placeholder: 'Optional' })}
            {input('industry', 'Industry preference', { placeholder: 'e.g. Technology' })}
            {input('startDate', 'Experience start date (optional)', { type: 'date' })}
            {input('endDate', 'Experience end date (optional)', { type: 'date' })}
            <details className="wide">
              <summary>Optional salary preferences</summary>
              <div className="form-grid">
                {input('salaryMin', 'Minimum', { type: 'number' })}
                {input('salaryMax', 'Maximum', { type: 'number' })}
                {input('currency', 'Currency', { placeholder: 'e.g. AUD' })}
              </div>
            </details>
          </div>
          <div className="sharing">
            <h3>Authorised context sharing</h3>
            <p className="muted">
              Choose which specialists may use your approved career information. A complete mission
              needs all four.
            </p>
            {Object.entries(form.sharing).map(([key, value]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => change('sharing', { ...form.sharing, [key]: e.target.checked })}
                />
                {
                  (
                    {
                      coach: 'Career Coach',
                      matching: 'Job Matcher',
                      resume: 'Resume Tailor',
                      interview: 'Interview Coach',
                    } as any
                  )[key]
                }
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy || preparing} onClick={() => void prepare()}>
              {preparing ? 'Preparing…' : 'Review profile draft'}
              <ArrowRight size={16} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                setForm(structuredClone(sample!));
                setSkillInput(sample!.skills.join(', '));
                setInterestInput(sample!.interests.join(', '));
                setDraft(null);
                setReviewed(false);
              }}
            >
              Use fictional example
            </button>
          </div>
        </section>
        <aside>
          <div className="guidance-card">
            <ShieldCheck size={24} />
            <h3>
              Facts you approve.
              <br />
              Context you control.
            </h3>
            <p>
              Drafts are kept separate from your approved profile. Cancelling or a failed save
              leaves the previous version unchanged.
            </p>
            <hr />
            <h4>How approval works</h4>
            <ol>
              <li>Enter your information.</li>
              <li>Review the prepared draft.</li>
              <li>Explicitly approve and save.</li>
            </ol>
            <span className="small muted">
              Manual profile preparation is always available, including when AI is unavailable.
            </span>
          </div>
          {draft && (
            <section className="panel draft-preview">
              <span className="eyebrow">REVIEW BEFORE SAVING</span>
              <h3>{draft.data.name}</h3>
              <p>{draft.data.goals}</p>
              <div className="facts-preview">
                {draft.facts.map((f: any) => (
                  <div key={f.id}>
                    <span>{f.kind}</span>
                    <p>{f.text}</p>
                  </div>
                ))}
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed this exact draft and confirm the information.
              </label>
              <button
                className="primary full"
                disabled={!reviewed || busy}
                onClick={() => void onApprove(draft.id)}
              >
                <Check size={16} />
                Approve & save profile
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void onDiscard(draft.id).then(() => {
                    setDraft(null);
                    setReviewed(false);
                  })
                }
              >
                Discard draft
              </button>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

// Present persisted outputs and collect decisions; workflow transitions are validated by the API.
function MissionDetail({
  mission: m,
  busy,
  onBack,
  onAction,
  onSaveAnswer,
  onRefineAnalysis,
}: {
  mission: any;
  busy: boolean;
  onBack: () => void;
  onAction: (kind: string, body?: unknown) => Promise<void>;
  onSaveAnswer: (a: unknown) => Promise<void>;
  onRefineAnalysis: (feedback: string) => Promise<void>;
}) {
  const d = m.data,
    [revision, setRevision] = useState(''),
    [answer, setAnswer] = useState(''),
    [question, setQuestion] = useState(0),
    [analysisFeedback, setAnalysisFeedback] = useState(''),
    [confirm, setConfirm] = useState(false),
    [compareIds, setCompareIds] = useState<string[]>([]);
  const questions = d.questions || [],
    q = questions[question],
    responseCount = d.answers?.length || 0;

  useEffect(() => {
    setAnswer((d.answers || []).find((a: any) => a.questionId === q?.id)?.answer || '');
  }, [q?.id, JSON.stringify(d.answers)]);

  useEffect(() => {
    // A changed draft needs a fresh confirmation even if the previous version was reviewed.
    setConfirm(false);
  }, [d.resumeDraft?.hash]);

  useEffect(() => {
    setAnalysisFeedback('');
  }, [m.id]);

  const stages = [
    { label: 'Approved profile', done: true },
    { label: 'Career analysis', done: !!d.analysis },
    { label: 'Job selection', done: !!d.selectedJob },
    { label: 'Resume approval', done: !!d.approvedResumeId },
    { label: 'Interview feedback', done: !!d.feedback },
  ];
  return (
    <>
      <button className="back" onClick={onBack}>
        ← All missions
      </button>
      <div className="mission-heading">
        <div>
          <span className="eyebrow">
            CAREER MISSION · {m.mode === 'fixture' ? 'DISCLOSED DEMO FIXTURES' : 'LIVE AI'}
          </span>
          <h1>{m.goal}</h1>
          <p>
            Started {date(m.createdAt)} · Your approved context, connected across five specialists.
          </p>
        </div>
        <Status value={m.status} />
      </div>
      <div className="progress-track">
        {stages.map((s, i) => (
          <div className={s.done ? 'done' : ''} key={s.label}>
            <span>{s.done ? <Check size={14} /> : String(i + 1).padStart(2, '0')}</span>
            {s.label}
          </div>
        ))}
      </div>
      {m.error && (
        <div className="error-banner">
          <AlertCircle size={18} />
          <span>{m.error}</span>
        </div>
      )}
      <div className="mission-actions">
        {m.status === 'FAILED' && (
          <button className="secondary" disabled={busy} onClick={() => void onAction('retry')}>
            <RefreshCw size={15} />
            Retry failed step
          </button>
        )}
        {!['COMPLETE', 'CANCELLED', 'STALE', 'NO_MATCHES'].includes(m.status) && (
          <button className="text-button" disabled={busy} onClick={() => void onAction('cancel')}>
            <Pause size={15} />
            Cancel further work
          </button>
        )}
        <span className="muted small">
          {d.apiCalls || 0} / 12 model calls ·{' '}
          {((d.inputTokens || 0) + (d.outputTokens || 0)).toLocaleString()} tokens recorded
        </span>
      </div>
      {['RUNNING', 'QUEUED'].includes(m.status) && (
        <div role="status" className="working">
          <span className="pulse" />
          <div>
            <strong>Your career team is on it.</strong>
            <p>
              You can leave this page. Your mission will keep running while the server is available.
            </p>
          </div>
        </div>
      )}
      {d.analysis && (
        <section className="panel analysis">
          <div className="section-heading">
            <h2>
              <Compass size={20} />
              Your career direction
            </h2>
            <span className="tag">Career Coach</span>
          </div>
          <div className="analysis-grid">
            <div>
              <h3>Strengths to build on</h3>
              {d.analysis.strengths.map((s: any, i: number) => (
                <div className="strength" key={i}>
                  <CheckCircle2 size={16} />
                  <div>
                    {coachText(s)}
                    <CoachEvidence item={s} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3>Development opportunities</h3>
              <ul>
                {d.analysis.gaps.map((s: any) => (
                  <li key={coachText(s)}>
                    {coachText(s)}
                    <CoachEvidence item={s} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {d.analysisFeedback && (
            <div className="info">
              <RefreshCw size={17} />
              <span>
                <strong>Refinement request:</strong> {d.analysisFeedback}
              </span>
            </div>
          )}
          {d.analysis.directions?.length > 0 && (
            <div className="next-steps">
              <h3>Suitable career directions</h3>
              {d.analysis.directions.map((s: any, i: number) => (
                <p key={coachText(s)}>
                  <span>{i + 1}</span>
                  <div>
                    {coachText(s)}
                    <CoachEvidence item={s} />
                  </div>
                </p>
              ))}
            </div>
          )}
          <div className="next-steps">
            <h3>Suggested next steps</h3>
            {d.analysis.actions.map((s: any, i: number) => (
              <p key={coachText(s)}>
                <span>{i + 1}</span>
                <div>
                  {coachText(s)}
                  <CoachEvidence item={s} />
                </div>
              </p>
            ))}
          </div>
          <details className="approval-controls">
            <summary>Refine this career analysis</summary>
            <label>
              What should the Career Coach revisit?
              <textarea
                value={analysisFeedback}
                onChange={(e) => setAnalysisFeedback(e.target.value)}
                placeholder="For example: focus more on leadership evidence or explain why a direction fits."
              />
            </label>
            <button
              className="secondary"
              disabled={busy || analysisFeedback.trim().length < 3}
              onClick={() => void onRefineAnalysis(analysisFeedback.trim())}
            >
              <RefreshCw size={15} />
              Start refined mission
            </button>
          </details>
        </section>
      )}
      {m.status === 'NO_MATCHES' && (
        <div className="empty-state">
          <BriefcaseBusiness size={30} />
          <h3>No suitable opportunities found.</h3>
          <p>
            Lower the minimum suitability or broaden your preferences, then start another mission.
            Your approved profile remains unchanged.
          </p>
          <button className="secondary" onClick={onBack}>
            Back to missions
          </button>
        </div>
      )}
      {d.matches?.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>
              {d.selectedJob
                ? 'Your selected opportunity'
                : 'Opportunities that fit your direction'}
            </h2>
            <span className="muted">Disclosed fictional jobs · heuristic scores</span>
          </div>
          <div className="jobs-grid">
            {(d.selectedJob ? [d.selectedJob] : d.matches).map((r: any) => (
              <article className="job-card" key={r.job.id}>
                <div className="job-card-top">
                  <div className="company-letter">{r.job.company[0]}</div>
                  <div className="score">
                    {r.score}
                    <small>/ 100 fit</small>
                  </div>
                </div>
                <span className="small muted">{r.job.company}</span>
                <h3>{r.job.title}</h3>
                <p className="small muted">
                  {r.job.location} · {r.job.employmentType}
                </p>
                <div className="pills">
                  {r.matches.slice(0, 4).map((s: string) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                <p>{r.explanation}</p>
                <details>
                  <summary>Evidence, gaps & source</summary>
                  <p>
                    <strong>Gaps:</strong> {r.gaps.join('; ') || 'No explicit gaps identified.'}
                  </p>
                  <p>{r.job.description}</p>
                  <p>
                    Source: {r.job.source.name} v{r.job.source.version}. Not a live vacancy.
                  </p>
                  <p>
                    45% skills · 15% experience · 10% education · 15% preferences · 15% TF-IDF
                    overlap.
                  </p>
                  <p>Scores indicate heuristic suitability, not hiring probabilities.</p>
                </details>
                {m.status === 'AWAITING_JOB' && (
                  <>
                    <button
                      className="secondary full"
                      disabled={busy}
                      onClick={() => void onAction('decisions', { kind: 'job', jobId: r.job.id })}
                    >
                      Select this opportunity
                      <ArrowRight size={15} />
                    </button>
                    <label className="checkbox small">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(r.job.id)}
                        disabled={!compareIds.includes(r.job.id) && compareIds.length >= 4}
                        onChange={(e) =>
                          setCompareIds(
                            e.target.checked
                              ? [...compareIds, r.job.id]
                              : compareIds.filter((id) => id !== r.job.id),
                          )
                        }
                      />
                      Compare this job
                    </label>
                  </>
                )}
              </article>
            ))}
          </div>
          {compareIds.length >= 2 && (
            <div className="panel comparison">
              <h3>Compare selected opportunities</h3>
              <p className="muted">
                Salary and growth information below is fictional or unavailable; it is not a market
                estimate.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Attribute</th>
                      {d.matches
                        .filter((r: any) => compareIds.includes(r.job.id))
                        .map((r: any) => (
                          <th key={r.job.id}>{r.job.title}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['location', 'salary', 'skills', 'growth', 'score'].map((field) => (
                      <tr key={field}>
                        <th>{field}</th>
                        {d.matches
                          .filter((r: any) => compareIds.includes(r.job.id))
                          .map((r: any) => (
                            <td key={r.job.id}>
                              {field === 'salary'
                                ? r.job.salary
                                  ? `${r.job.salary.currency} ${r.job.salary.min.toLocaleString()}–${r.job.salary.max.toLocaleString()} / year (fictional)`
                                  : 'Not provided'
                                : field === 'skills'
                                  ? r.requirements.required.join(', ') || 'Not provided'
                                  : field === 'score'
                                    ? r.score
                                    : (r.job[field] ?? 'Not provided')}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
      {d.resumeDraft && (
        <section className="panel resume">
          <div className="section-heading">
            <h2>
              <FileCheck2 size={20} />
              Your evidence-grounded resume
            </h2>
            <span className="tag">
              {d.approvedResumeId ? 'Approved & saved' : 'Review required'}
            </span>
          </div>
          <p className="muted">
            Proposed selection and ordering for {d.resumeDraft.jobTitle}. Candidate claims are
            retained verbatim from approved profile v{d.resumeDraft.profileVersion}.
          </p>
          <div className="resume-header">
            <h3>{d.resumeDraft.name}</h3>
            <p>Application target: {d.resumeDraft.jobTitle}</p>
          </div>
          {d.resumeDraft.claims.map((c: any) => (
            <div className="resume-claim" key={c.factId}>
              <span className="claim-type">{c.kind}</span>
              <p>{c.text}</p>
              <details>
                <summary>
                  <ShieldCheck size={13} />
                  Evidence passport · {c.factId}
                </summary>
                <p>
                  Source: {c.source}. Profile v{d.resumeDraft.profileVersion}.
                </p>
                <p>Selection reason: {c.reason}</p>
                <p>This claim matches the approved source text exactly.</p>
              </details>
            </div>
          ))}
          <div className="approval-controls">
            <details>
              <summary>Review proposed changes</summary>
              <div className="info">
                <ShieldCheck size={17} />
                <span>
                  Candidate facts are not rewritten. This resume proposes selecting and ordering
                  only the evidence supported by your approved profile.
                </span>
              </div>
              <h4>Included, in proposed order</h4>
              <ol>
                {d.resumeDraft.claims.map((c: any) => (
                  <li key={c.factId}>
                    {c.kind}: {c.text}
                  </li>
                ))}
              </ol>
              <h4>Omitted for this target role</h4>
              {d.resumeDraft.omittedFacts?.length ? (
                <ul>
                  {d.resumeDraft.omittedFacts.map((f: any) => (
                    <li key={f.id}>
                      {f.kind}: {f.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">No eligible approved facts were omitted.</p>
              )}
            </details>
          </div>
          {m.status === 'AWAITING_APPROVAL' && (
            <div className="approval-controls">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I reviewed the selected claims and approve this exact resume draft.
              </label>
              <button
                className="primary"
                disabled={!confirm || busy}
                onClick={() =>
                  void onAction('decisions', {
                    kind: 'resume',
                    decision: 'approve',
                    draftHash: d.resumeDraft.hash,
                  })
                }
              >
                <Check size={16} />
                Approve & save resume
              </button>
              <details>
                <summary>Request a revision instead</summary>
                <label>
                  Emphasis or ordering feedback
                  <textarea
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                    placeholder="Which supported experience should receive more emphasis?"
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy || !revision.trim()}
                  onClick={() =>
                    void onAction('decisions', {
                      kind: 'resume',
                      decision: 'revise',
                      draftHash: d.resumeDraft.hash,
                      feedback: revision,
                    })
                  }
                >
                  Request revision · {d.revisions || 0}/2 used
                </button>
              </details>
            </div>
          )}
          {d.approvedResumeId && (
            <a className="secondary" href={`/api/resumes/${d.approvedResumeId}/download`}>
              <Download size={16} />
              Download approved resume
            </a>
          )}
        </section>
      )}
      {questions.length > 0 && (
        <section className="panel interview">
          <div className="section-heading">
            <h2>
              <MessageSquare size={20} />
              Prepare for the conversation
            </h2>
            <span className="tag">Interview Coach</span>
          </div>
          <p className="muted">
            Role-specific practice for {d.selectedJob?.job.title}. Your answers stay separate from
            approved candidate facts.
          </p>
          {m.status === 'AWAITING_INTERVIEW' ? (
            <>
              <div className="question-tabs">
                {questions.map((item: any, i: number) => (
                  <button
                    className={i === question ? 'selected' : ''}
                    key={item.id}
                    onClick={() => setQuestion(i)}
                  >
                    Question {i + 1}
                    {d.answers?.some((a: any) => a.questionId === item.id) && <Check size={13} />}
                  </button>
                ))}
              </div>
              <span className="eyebrow">{q?.focus}</span>
              <h3>{q?.question}</h3>
              <label>
                Your response
                <textarea
                  rows={6}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Describe the context, your action and the result. Use only your real experience."
                />
              </label>
              <div className="form-actions">
                <button
                  className="secondary"
                  disabled={busy || !answer.trim()}
                  onClick={() => void onSaveAnswer({ questionId: q.id, answer })}
                >
                  Save response
                  <Check size={15} />
                </button>
                <span className="small muted">
                  {responseCount} of {questions.length} responses saved
                </span>
              </div>
              <button
                className="primary"
                disabled={busy || !responseCount}
                onClick={() =>
                  void onAction('decisions', {
                    kind: 'interview',
                    endedEarly: responseCount < questions.length,
                  })
                }
              >
                {responseCount < questions.length
                  ? 'Finish early & get feedback'
                  : 'Complete interview & get feedback'}
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <p>
              {responseCount} {responseCount === 1 ? 'response' : 'responses'} retained.{' '}
              {d.endedEarly ? 'You finished early; feedback reflects the available answers.' : ''}
            </p>
          )}
          {d.feedback && (
            <div className="feedback-grid">
              {[
                ['Strengths', d.feedback.strengths],
                ['Areas to improve', d.feedback.improvements],
                ['Next practice', d.feedback.nextSteps],
              ].map(([label, items]: any) => (
                <div key={label}>
                  <h3>{label}</h3>
                  <ul>
                    {items.map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Activity size={20} />
            Mission activity
          </h2>
          <span className="small muted">Actions and outcomes, not hidden reasoning</span>
        </div>
        {m.events.map((e: any, i: number) => (
          <div className="timeline-event" key={i}>
            <span className="timeline-dot" />
            <div>
              <strong>{e.agent}</strong>
              <span className="event-action">{nice(e.action)}</span>
              <p>{e.detail}</p>
              <small>{new Date(e.at).toLocaleTimeString('en-AU')}</small>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
