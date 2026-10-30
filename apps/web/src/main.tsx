import { WorkspaceHome, nextMissionStep } from './workspace-home.js';
import { FlowNavigation } from './flow-navigation.js';
import { ResumePreview } from './resume-preview.js';
import { resumeReadiness } from '../../../packages/contracts/src/resume-layout.js';
import { JobFit } from './job-fit.js';
import { suggestJobSearch } from '../../../packages/contracts/src/job-search.js';
import { ProfileRecords } from './profile-records.js';
import { ProfileImport } from './profile-import.js';
import { ResumeSelection } from './resume-selection.js';
import { ProfileSummary } from './profile-summary.js';
import { ProfileConversation } from './profile-conversation.js';
import { CareerMemoryPanel } from './career-memory.js';
import { WordingStudio } from './resume-wording.js';
import { recordKeys } from '../../../packages/contracts/src/profile-records.js';
import { OptionalTools } from './tools.js';
import {
  JobSearchFields,
  defaultJobSearch,
  ApplicationPanel,
  JobSourceActions,
} from './recruitment.js';
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
  House,
  Search,
  FileText,
  UserRound,
  Database,
} from 'lucide-react';
import { blankProfile, type CareerProfile } from '../../../packages/contracts/src/index.js';
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
    // Log only the HTTP status; request bodies and career data stay out of the console.
    console.error('CareerFlow request failed', { status: r.status });
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

const phaseNames = [
  'Profile',
  'Career analysis',
  'Job matching',
  'Resume tailoring',
  'Interview practice',
  'Activity',
  'Optional tools',
  'Real jobs & applications',
];
const stagePresentation = [
  { title: 'Build your profile', description: 'Start with a conversation. No resume required.' },
  {
    title: 'Explore your direction',
    description: 'Understand your strengths and where they can take you.',
  },
  {
    title: 'Find the right opportunity',
    description: 'Explore roles that match your career direction.',
  },
  {
    title: 'Prepare your resume',
    description: 'Bring the most relevant parts of your profile together.',
  },
  {
    title: 'Get ready for the conversation',
    description: 'Practise role-specific questions at your own pace.',
  },
];
type Tab =
  | 'missions'
  | 'profile'
  | 'approved-profile'
  | 'memory'
  | 'approvals'
  | 'library'
  | 'activity'
  | 'tools';

// Own workspace navigation and refreshes here; the server remains the source of mission status.
function App() {
  const [session, setSession] = useState<any>(null),
    [ready, setReady] = useState(false),
    [workspace, setWorkspace] = useState<any>(null),
    [tab, setTab] = useState<Tab>('missions'),
    [phase, setPhase] = useState<number | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [minScore, setMinScore] = useState(40),
    [jobSearch, setJobSearch] = useState(defaultJobSearch),
    [goal, setGoal] = useState(
      'Find suitable technology roles across Australia and prepare a factual application.',
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
        if (s.recruitment?.defaults)
          setJobSearch({ ...defaultJobSearch, ...s.recruitment.defaults });
        if (s.user)
          void refresh().then((w) => {
            if (!w.profile) setTab('profile');
          });
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

  const interviewHandoff = useRef<string | null>(null);
  const mission = workspace?.missions.find((m: any) => m.id === selected);
  const selectJourneyStep = (i: number) => {
    setPhase(i);
    setError('');
    if (i === 0) setTab('profile');
    else {
      setTab('missions');
      const latest = mission || workspace?.missions[0];
      setSelected(latest?.id || null);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  };
  useEffect(() => {
    if (interviewHandoff.current !== mission?.id || mission?.status !== 'AWAITING_INTERVIEW')
      return;
    interviewHandoff.current = null;
    setNotice('Your resume is saved. Your interview questions are ready.');
    document.getElementById('interview-practice')?.scrollIntoView({ block: 'start' });
  }, [mission?.id, mission?.status]);

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
          void refresh().then((w) => {
            if (!w.profile) setTab('profile');
          });
        }}
      />
    );
  const nav = [
    { id: 'missions', label: 'Overview', icon: House },
    { id: 'profile', label: 'Career chat', icon: MessageSquare },
    { id: 'jobs', label: 'Find jobs', icon: Search },
    { id: 'library', label: 'My documents', icon: FileText },
    { id: 'approved-profile', label: 'My profile', icon: UserRound },
    { id: 'memory', label: 'Career memory', icon: Database },
    { id: 'approvals', label: 'Approval inbox', icon: FileCheck2 },
    { id: 'applications', label: 'Applications', icon: BriefcaseBusiness },
    { id: 'activity', label: 'Activity timeline', icon: Activity },
    { id: 'tools', label: 'Optional tools', icon: Target },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="CareerFlow home">
          <span className="brandmark" aria-hidden="true">
            <img src="/careerflow-logo.svg" alt="" />
          </span>
          CareerFlow
        </a>
        <div className="workspace-label">Workspace</div>
        <nav aria-label="Main navigation">
          {nav
            .filter((n) => !['approvals', 'applications', 'activity', 'tools'].includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={
                  n.id === 'jobs'
                    ? tab === 'missions' && phase === 2
                      ? 'nav active'
                      : 'nav'
                    : tab === n.id && !(n.id === 'missions' && phase !== null)
                      ? 'nav active'
                      : 'nav'
                }
                onClick={() => {
                  if (n.id === 'jobs') {
                    selectJourneyStep(2);
                    return;
                  }
                  if (n.id === 'applications') {
                    setTab('missions');
                    setPhase(7);
                    setSelected(
                      workspace?.missions.find((m: any) => m.data?.approvedResumeId)?.id ||
                        workspace?.missions[0]?.id ||
                        null,
                    );
                    setError('');
                    return;
                  }
                  setTab(n.id as Tab);
                  setSelected(null);
                  setPhase(null);
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
          <details className="sidebar-more">
            <summary>More</summary>
            {nav
              .filter((n) => ['approvals', 'applications', 'activity', 'tools'].includes(n.id))
              .map((n) => (
                <button
                  key={n.id}
                  className={tab === n.id ? 'nav active' : 'nav'}
                  onClick={() => {
                    if (n.id === 'applications') {
                      setTab('missions');
                      setPhase(7);
                      setSelected(
                        workspace?.missions.find((m: any) => m.data?.approvedResumeId)?.id ||
                          workspace?.missions[0]?.id ||
                          null,
                      );
                    } else {
                      setTab(n.id as Tab);
                      setSelected(null);
                      setPhase(null);
                    }
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
          </details>
        </nav>
        <div className="sidebar-journey-label">Your journey</div>
        <FlowNavigation
          vertical
          current={tab === 'profile' ? 0 : phase !== null && phase <= 4 ? phase : -1}
          onSelect={selectJourneyStep}
        />
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
          <details className="account-menu">
            <summary aria-label="Account menu">
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
            </summary>
            <div className="account-menu-items">
              <button
                aria-label="Approved profile"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setTab('approved-profile');
                  setPhase(null);
                  setSelected(null);
                }}
              >
                Approved profile
              </button>
              <button
                aria-label="Career memory"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setTab('memory');
                  setPhase(null);
                  setSelected(null);
                }}
              >
                Career memory
              </button>
            </div>
          </details>
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
            <span>
              {phase !== null
                ? phaseNames[phase]
                : tab === 'approved-profile'
                  ? 'Approved profile'
                  : tab === 'memory'
                    ? 'Career memory'
                    : nav.find((n) => n.id === tab)?.label}
            </span>
          </div>
          <details className="provider-details">
            <summary>Service status</summary>
            <span className={`provider ${session.mode === 'fixture' ? 'fixture' : ''}`}>
              <i />
              {session.mode === 'fixture' ? 'Demo mode' : 'Live AI enabled'}
            </span>
          </details>
        </header>
        <main>
          {error && (
            <div role="alert" className="error-banner global-error-toast">
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
          {(tab === 'profile' || (tab === 'missions' && (selected || phase !== null))) && (
            <FlowNavigation
              current={tab === 'profile' ? 0 : (phase ?? 0)}
              onSelect={selectJourneyStep}
            />
          )}
          {tab === 'approved-profile' ? (
            <div className="approved-profile-page" aria-label="Approved profile">
              <PageTitle
                eyebrow="YOUR CAREER PROFILE"
                title="My profile"
                text="Your experience, skills and education in one place."
              />
              {workspace?.profile ? (
                <div className="approved-profile-layout">
                  <div className="approved-profile-main">
                    <section className="panel approved-profile-header">
                      <div className="approved-profile-avatar">
                        {String(workspace.profile.data.name || 'Y')
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div>
                        <h2>{workspace.profile.data.name || 'Your profile'}</h2>
                        <p>{workspace.profile.data.location || 'Add your location'}</p>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => {
                          setTab('profile');
                          setPhase(null);
                        }}
                      >
                        Edit profile
                      </button>
                    </section>
                    <section className="panel">
                      <ProfileSummary
                        data={workspace.profile.data}
                        showName={false}
                        showSkills={false}
                      />
                    </section>
                  </div>
                  <aside className="approved-profile-aside">
                    <section className="panel">
                      <h2>Skills</h2>
                      <div className="prototype-skill-list">
                        {(workspace.profile.data.skills || []).map((skill: string) => (
                          <span key={skill}>{skill}</span>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <h2>Career memory</h2>
                      <p>Your stories and supporting details.</p>
                      <button className="secondary" onClick={() => setTab('memory')}>
                        View memories <ArrowRight size={15} />
                      </button>
                    </section>
                  </aside>
                </div>
              ) : (
                <section className="panel">
                  <p>No approved profile yet.</p>
                  <button className="primary" onClick={() => setTab('profile')}>
                    Build your profile
                  </button>
                </section>
              )}
            </div>
          ) : tab === 'memory' ? (
            <section className="panel" aria-label="Career memory">
              <CareerMemoryPanel
                api={api}
                incoming={null}
                profileVersion={workspace?.profile?.version || 0}
              />
            </section>
          ) : tab === 'tools' ? (
            <OptionalTools missions={workspace?.missions || []} request={api} onRefresh={refresh} />
          ) : tab === 'profile' ? (
            <Profile
              profile={workspace?.profile}
              userName={session.user.name}
              sample={workspace?.sampleProfile}
              onMission={() => {
                setPhase(null);
                setTab('missions');
                setCreating(true);
              }}
              onLibrary={() => setTab('library')}
              busy={busy}
              onDraft={async (input) => api('/profiles/drafts', 'POST', input)}
              onApprove={async (id) =>
                act(async () => {
                  await api(`/profiles/drafts/${id}/approve`, 'POST', { reviewed: true });
                  setNotice(
                    'Your reviewed profile is now approved. Previous documents remain available.',
                  );
                })
              }
              onDiscard={async (id) => {
                let discarded = false;
                await act(async () => {
                  await api(`/profiles/drafts/${id}`, 'DELETE');
                  discarded = true;
                });
                return discarded;
              }}
            />
          ) : tab === 'missions' ? (
            <>
              {mission ? (
                <MissionDetail
                  mission={mission}
                  phase={phase}
                  onNavigate={setPhase}
                  onNewSearch={() => setCreating(true)}
                  busy={busy}
                  onBack={() => {
                    setSelected(null);
                    setPhase(null);
                  }}
                  onAction={(kind, body) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/${kind}`, 'POST', body || {});
                      if (kind === 'decisions' && (body as any)?.kind === 'job') {
                        setPhase(3);
                        setNotice('Job selected. Preparing your resume…');
                      }
                      if (
                        kind === 'decisions' &&
                        (body as any)?.kind === 'resume' &&
                        (body as any)?.decision === 'approve'
                      ) {
                        interviewHandoff.current = mission.id;
                        setPhase(4);
                        setNotice('Resume approved. Preparing your interview questions…');
                      }
                    })
                  }
                  onSaveAnswer={(a) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/answers`, 'PUT', a);
                    })
                  }
                  onNegotiation={(input) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/negotiation`, 'POST', input);
                    })
                  }
                  onNegotiationDecision={(decision) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/negotiation/decision`, 'PUT', {
                        decision,
                      });
                    })
                  }
                  onRefineAnalysis={(feedback) =>
                    act(async () => {
                      const refined = await api('/missions', 'POST', {
                        goal: mission.goal,
                        minScore: mission.data.minScore ?? 40,
                        analysisFeedback: feedback,
                        sourceMissionId: mission.id,
                        jobSearch: mission.data.jobSearch,
                      });
                      setSelected(refined.id);
                      setNotice('A refined career analysis is queued.');
                    })
                  }
                />
              ) : phase !== null ? (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR NEXT STEP, WITH EVIDENCE</span>
                      <h1>{phaseNames[phase]}</h1>
                    </div>
                  </div>
                  <section className="panel">
                    <h2>{phaseNames[phase]} Agent</h2>
                    <p>
                      Start a career mission with an approved profile. Your agents share the same
                      reviewed evidence and selected target job.
                    </p>
                    <button className="primary" onClick={() => setCreating(true)}>
                      Start career mission
                    </button>
                  </section>
                </>
              ) : (
                <>
                  <WorkspaceHome
                    workspace={workspace}
                    onProfile={() => {
                      setTab('profile');
                      setPhase(0);
                    }}
                    onSearch={() => setCreating(true)}
                    onLibrary={() => {
                      setTab('library');
                      setPhase(null);
                    }}
                    onOpen={(m, targetPhase) => {
                      setSelected(m.id);
                      setPhase(targetPhase ?? nextMissionStep(m));
                    }}
                  />
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
                      setPhase(nextMissionStep(m));
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
              <WordingStudio api={api} resumes={workspace?.resumes || []} onSaved={refresh} />
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
                      Download TXT
                    </a>
                    <ResumeDownloads id={r.id} />
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
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) setCreating(false);
            }}
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
            <JobSearchFields
              value={jobSearch}
              onChange={setJobSearch}
              adzunaConfigured={session?.recruitment?.adzunaConfigured}
              tavilyConfigured={session?.recruitment?.tavilyConfigured}
              tavilyAccessMode={session?.recruitment?.tavilyAccessMode}
            />
            {workspace?.profile?.data && (
              <button
                className="secondary"
                onClick={() =>
                  setJobSearch({
                    ...jobSearch,
                    ...suggestJobSearch(workspace.profile.data),
                    region: '',
                  })
                }
              >
                Use approved profile search suggestions
              </button>
            )}
            <p className="small muted">
              Search sends only keywords and selected location to the recruitment API, not your
              name, contact details or full resume. You can edit the suggested terms before
              searching.
            </p>
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
                disabled={
                  busy ||
                  goal.trim().length < 5 ||
                  (jobSearch.provider === 'adzuna' && !session?.recruitment?.adzunaConfigured) ||
                  (jobSearch.provider === 'tavily' && !session?.recruitment?.tavilyConfigured)
                }
                onClick={() =>
                  void act(async () => {
                    const m = await api('/missions', 'POST', {
                      goal,
                      minScore,
                      jobSearch: {
                        ...jobSearch,
                        listing: jobSearch.provider === 'manual' ? jobSearch.listing : undefined,
                      },
                    });
                    setCreating(false);
                    setSelected(m.id);
                    setPhase(2);
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
                Shared fictional candidate. Job sources are selected separately. Demo AI mode does
                not make live AI calls.
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
  userName,
  sample,
  busy,
  onDraft,
  onApprove,
  onDiscard,
  onMission,
  onLibrary,
}: {
  profile: any;
  onMission: () => void;
  onLibrary: () => void;
  userName: string;
  sample: CareerProfile | undefined;
  busy: boolean;
  onDraft: (p: CareerProfile) => Promise<any>;
  onApprove: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<boolean>;
}) {
  // Preserve raw comma-separated text while typing; parse it when preparing the draft.
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);
  const [skillInput, setSkillInput] = useState(''),
    [interestInput, setInterestInput] = useState('');
  const [form, setForm] = useState<CareerProfile | null>(null),
    [draft, setDraft] = useState<any>(null),
    [reviewed, setReviewed] = useState(false),
    [preparing, setPreparing] = useState(false),
    [committing, setCommitting] = useState(false),
    [error, setError] = useState(''),
    [fields, setFields] = useState<Record<string, string[]>>({});
  const revision = useRef(0),
    activeRequest = useRef<number | null>(null),
    mounted = useRef(true);

  // Inputs can still be edited while AI is running; its result belongs only to
  // the exact input/version which started it, never to a later working copy.
  const invalidateDraft = () => {
    revision.current += 1;
    setDraft(null);
    setReviewed(false);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
      activeRequest.current = null;
    };
  }, []);

  useEffect(() => {
    // Reset only when the approved version changes, not on each workspace poll.
    if (!profile?.data && !sample) return;
    if (profile?.data) {
      setForm(profile.data);
      setSkillInput(profile.data.skills.join(', '));
      setInterestInput(profile.data.interests.join(', '));
    } else {
      setForm(structuredClone(blankProfile));
      setSkillInput('');
      setInterestInput('');
    }
    invalidateDraft();
    activeRequest.current = null;
    setPreparing(false);
    setError('');
    setFields({});
  }, [profile?.id, Boolean(sample)]);
  if (!form) return <div className="loading">Loading your profile…</div>;

  const change = (key: keyof CareerProfile, value: any) => {
    setForm((current) => ({ ...current!, [key]: value }));
    invalidateDraft();
    setFields((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
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
          aria-label={label}
          aria-invalid={Boolean(fields[key]?.length)}
          aria-describedby={
            fields[key]?.length
              ? fields[key].map((_, index) => `profile-${key}-error-${index}`).join(' ')
              : undefined
          }
          value={String(form[key] ?? '')}
          placeholder={options.placeholder}
          onChange={(e) => change(key, e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          aria-invalid={Boolean(fields[key]?.length)}
          aria-describedby={
            fields[key]?.length
              ? fields[key].map((_, index) => `profile-${key}-error-${index}`).join(' ')
              : undefined
          }
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
      {fields[key]?.map((s, index) => (
        <span className="field-error" id={`profile-${key}-error-${index}`} key={s}>
          {s}
        </span>
      ))}
    </label>
  );

  async function prepare() {
    if (activeRequest.current !== null || busy || committing || hasPendingSuggestions) return;
    const token = ++revision.current;
    activeRequest.current = token;
    setPreparing(true);
    setReviewed(false);
    setError('');
    setFields({});
    try {
      const result = await onDraft(form!);
      if (!mounted.current || revision.current !== token) return;
      setDraft(result);
      setReviewed(false);
    } catch (e) {
      if (!mounted.current || revision.current !== token) return;
      setError((e as Error).message);
      setFields((e as any).fields || {});
    } finally {
      if (mounted.current && activeRequest.current === token) {
        activeRequest.current = null;
        setPreparing(false);
      }
    }
  }

  async function approve() {
    if (!draft || !reviewed || activeRequest.current !== null || busy || committing) return;
    setCommitting(true);
    try {
      await onApprove(draft.id);
    } finally {
      if (mounted.current) setCommitting(false);
    }
  }

  async function discard() {
    if (!draft || activeRequest.current !== null || busy || committing) return;
    setCommitting(true);
    try {
      const discarded = await onDiscard(draft.id);
      if (!mounted.current) return;
      if (discarded) {
        invalidateDraft();
        setError('');
      } else {
        setError('The draft could not be discarded. It is still available; try again.');
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setCommitting(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="STEP 01 · PROFILE BUILDING"
        title="Build your profile"
        text="Start with a conversation. No resume required."
      />
      <fieldset
        disabled={busy || committing}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className="chat-profile-layout">
          <section className="panel profile-chat-main">
            <h2>Tell us your story</h2>
            <p className="muted">
              Let’s start with what you’ve done and what you enjoy. You can review your details
              before saving.
            </p>
            {error && (
              <div role="alert" className="error-banner">
                {error}
              </div>
            )}
            <ProfileConversation
              onReview={() => void prepare()}
              onPendingChange={setHasPendingSuggestions}
              profileVersion={profile?.version || 0}
              form={form}
              api={api}
              onChange={(key, value) => {
                change(key, value);
                if (key === 'skills') setSkillInput(value.join(', '));
                if (key === 'interests') setInterestInput(value.join(', '));
              }}
            />
          </section>
          <aside className="profile-draft-side">
            <section className="panel">
              <div className="section-heading">
                <h2>Your profile so far</h2>
                <span className="tag">
                  {profile
                    ? JSON.stringify(form) === JSON.stringify(profile.data)
                      ? `Approved v${profile.version}`
                      : `Unsaved changes · based on v${profile.version}`
                    : 'Not approved yet'}
                </span>
              </div>
              <ProfileSummary data={draft?.data || form} />
              <details className="manual-profile-editor">
                <summary>Edit profile details manually</summary>
                <details className="optional-import">
                  <summary>Already have career material? Optional resume import</summary>
                  <ProfileImport
                    api={api}
                    disabled={busy || committing || preparing}
                    onApply={(records) => {
                      setForm((current) => ({
                        ...current!,
                        ...Object.fromEntries(
                          recordKeys.map((key) => [
                            key,
                            [
                              ...(current?.[key] || []),
                              ...records
                                .filter(
                                  (r) =>
                                    r.section === key &&
                                    !current?.[key]?.some((x) => x.id === r.id),
                                )
                                .map(({ section, ...r }) => r),
                            ],
                          ]),
                        ),
                      }));
                      invalidateDraft();
                    }}
                  />
                </details>
                <div className="form-grid">
                  {input('name', 'Full name')}
                  {input('location', 'Preferred location', { placeholder: 'Optional' })}
                  <label>
                    Career stage
                    <select
                      value={form.careerStage || ''}
                      onChange={(e) => change('careerStage', e.target.value || undefined)}
                    >
                      <option value="">Not specified</option>
                      {['student', 'graduate', 'early-career', 'experienced', 'career-change'].map(
                        (v) => (
                          <option key={v} value={v}>
                            {nice(v)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
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
                  {!form.educations?.length && (
                    <div className="wide">
                      {input('education', 'Education or “none yet”', { area: true })}
                    </div>
                  )}
                  {!form.workExperiences?.length && !form.projects?.length && (
                    <div className="wide">
                      {input('experience', 'Experience and projects or “none yet”', { area: true })}
                    </div>
                  )}
                  <ProfileRecords form={form} onChange={change} errors={fields} />
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
              </details>
              <div className="sharing">
                <h3>Authorised context sharing</h3>
                <p className="muted">
                  Missions use approved profile facts only. Conversation transcripts, source
                  quotations and separate career memories are not sent. Review and add memory facts
                  to your profile before using them in a mission.
                </p>
                <p className="muted">
                  Choose which specialists may use your approved career information. A complete
                  mission needs all four.
                </p>
                {Object.entries(form.sharing).map(([key, value]) => (
                  <label className="checkbox" key={key}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) =>
                        change('sharing', { ...form.sharing, [key]: e.target.checked })
                      }
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
                <button
                  className="primary"
                  disabled={busy || committing || preparing || hasPendingSuggestions}
                  onClick={() => void prepare()}
                >
                  {preparing ? 'Preparing…' : 'Review profile draft'}
                  <ArrowRight size={16} />
                </button>
              </div>
              {profile && (
                <button
                  className="primary"
                  disabled={JSON.stringify(form) !== JSON.stringify(profile.data)}
                  onClick={onMission}
                >
                  Find jobs using this approved profile
                </button>
              )}
              <details>
                <summary>Demo test data</summary>
                <p>Replaces the current unsaved draft with fictional sample information.</p>
                <button
                  className="text-button"
                  disabled={!sample}
                  onClick={() => {
                    setForm(structuredClone(sample!));
                    setSkillInput(sample!.skills.join(', '));
                    setInterestInput(sample!.interests.join(', '));
                    invalidateDraft();
                  }}
                >
                  Use fictional example
                </button>
              </details>
            </section>
            {draft && (
              <section className="panel draft-preview">
                <span className="eyebrow">REVIEW BEFORE SAVING</span>
                <h3>Confirm this exact profile draft</h3>
                <p>The grouped details above are the snapshot you are approving.</p>
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
                  disabled={!reviewed || busy || committing || preparing}
                  onClick={() => void approve()}
                >
                  <Check size={16} />
                  Approve & save profile
                </button>
                <button
                  className="text-button"
                  disabled={busy || committing || preparing}
                  onClick={() => void discard()}
                >
                  Discard draft
                </button>
              </section>
            )}
          </aside>
        </div>
      </fieldset>
    </>
  );
}

// Present persisted outputs and collect decisions; workflow transitions are validated by the API.
function MissionDetail({
  mission: m,
  phase,
  onNavigate,
  onNewSearch,
  busy,
  onBack,
  onAction,
  onSaveAnswer,
  onNegotiation,
  onNegotiationDecision,
  onRefineAnalysis,
}: {
  mission: any;
  phase: number | null;
  onNavigate: (phase: number | null) => void;
  onNewSearch: () => void;
  busy: boolean;
  onBack: () => void;
  onAction: (kind: string, body?: unknown) => Promise<void>;
  onSaveAnswer: (a: unknown) => Promise<void>;
  onNegotiation: (input: unknown) => Promise<void>;
  onNegotiationDecision: (decision: 'accept' | 'decline') => Promise<void>;
  onRefineAnalysis: (feedback: string) => Promise<void>;
}) {
  const d = m.data,
    [revision, setRevision] = useState(''),
    [answer, setAnswer] = useState(''),
    [question, setQuestion] = useState(0),
    [analysisFeedback, setAnalysisFeedback] = useState(''),
    [confirm, setConfirm] = useState(false),
    [selectionDirty, setSelectionDirty] = useState(false),
    [compareIds, setCompareIds] = useState<string[]>([]),
    [offerSalary, setOfferSalary] = useState(''),
    [targetSalary, setTargetSalary] = useState(''),
    [currency, setCurrency] = useState('AUD'),
    [negotiationMessage, setNegotiationMessage] = useState('');
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

  useEffect(() => {
    const salary = d.selectedJob?.job.salary;
    setOfferSalary(salary ? String(salary.min) : '');
    setTargetSalary(salary ? String(salary.max) : '');
    setCurrency(salary?.currency || 'AUD');
    setNegotiationMessage('');
  }, [m.id, d.selectedJob?.job.id]);

  return (
    <>
      <button className="back" onClick={onBack}>
        ← All missions
      </button>
      <div className="mission-heading">
        <div>
          <span className="eyebrow">
            {phase !== null && phase < 5
              ? `STEP ${phase + 1} OF 5`
              : `CAREER MISSION · ${m.mode === 'fixture' ? 'DEMO' : 'LIVE'}`}
          </span>
          <h1>{phase === null ? m.goal : stagePresentation[phase]?.title || phaseNames[phase]}</h1>
          <p>
            {phase === null
              ? `Started ${date(m.createdAt)} · Your approved context, connected across five specialists.`
              : stagePresentation[phase]?.description || m.goal}
          </p>
        </div>
        <Status value={m.status} />
      </div>
      {phase === 2 && (
        <button className="primary" onClick={onNewSearch}>
          Search Australian jobs
        </button>
      )}
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
        <details className="run-details">
          <summary>Run details</summary>
          <span className="muted small">
            {d.apiCalls || 0} / 12 model calls ·{' '}
            {((d.inputTokens || 0) + (d.outputTokens || 0)).toLocaleString()} tokens recorded
          </span>
        </details>
      </div>
      {['RUNNING', 'QUEUED'].includes(m.status) && (
        <div role="status" className="working">
          <span className="pulse" />
          <div>
            <strong>
              {phase === 2
                ? 'Finding and matching jobs…'
                : phase === 3
                  ? 'Preparing your resume…'
                  : phase === 4
                    ? 'Preparing your interview…'
                    : 'Preparing your next step…'}
            </strong>
            <p>
              You can leave this page. Your mission will keep running while the server is available.
            </p>
          </div>
        </div>
      )}
      {phase !== null &&
        ((phase === 1 && !d.analysis) ||
          (phase === 2 && !d.matches?.length && m.status !== 'NO_MATCHES') ||
          (phase === 3 && !d.resumeDraft) ||
          (phase === 4 && !questions.length) ||
          (phase === 7 && (!d.selectedJob?.job?.applicationUrl || !d.approvedResumeId))) && (
          <section className="panel stage-prerequisite">
            <h2>
              {phaseNames[phase]}
              {phase === 7 ? '' : ' Agent'}
            </h2>
            <p>
              {phase === 3
                ? d.selectedJob
                  ? `Target: ${d.selectedJob.job.title}. Your evidence-based draft is being prepared.`
                  : 'Target: Select a target in Job matching first.'
                : phase === 4
                  ? d.approvedResumeId
                    ? 'Your approved resume is saved. Interview questions are being prepared.'
                    : 'Approve your evidence-based resume before starting interview practice.'
                  : phase === 7
                    ? 'Select a real target job and approve your resume before preparing an application.'
                    : 'Your career team is preparing this step. Results are saved with this mission.'}
            </p>
            {(phase === 3 || phase === 7) && (
              <>
                <button className="secondary" onClick={() => onNavigate(2)}>
                  Go to 03 Job matching
                </button>
                <button className="primary" disabled>
                  {d.selectedJob
                    ? 'Preparing evidence-based draft…'
                    : 'Generate evidence-based draft'}
                </button>
                <p className="muted">
                  Only approved evidence can be selected, reordered or removed. Update and approve
                  your profile before changing factual claims.
                </p>
              </>
            )}
            {phase === 4 && (
              <button className="secondary" onClick={() => onNavigate(3)}>
                Go to 04 Resume tailoring
              </button>
            )}
          </section>
        )}
      <div id="career-analysis" />
      {(phase === null || phase === 1) && d.analysis && (
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
      <div className={phase === 2 ? 'prototype-job-layout' : undefined}>
        {(phase === null || phase === 2) && d.jobRetrieval && (
          <details className="panel job-coverage">
            <summary>Search sources and coverage</summary>
            <p>
              {d.jobRetrieval.count} source jobs before suitability filtering ·{' '}
              {d.jobRetrieval.geography?.countryName || d.jobSearch?.country?.toUpperCase()} ·{' '}
              {d.jobRetrieval.geography?.region || 'All regions'}
            </p>
            <div>
              {d.jobRetrieval.discovery && (
                <p>
                  Tavily: {d.jobRetrieval.discovery.discovered} indexed links ·{' '}
                  {d.jobRetrieval.discovery.verified} officially verified · {d.jobRetrieval.count}{' '}
                  location matches · {d.jobRetrieval.discovery.credits ?? 'Unknown'} search credits
                </p>
              )}
              {d.jobRetrieval.duplicateCount > 0 && (
                <p>{d.jobRetrieval.duplicateCount} duplicate source records removed.</p>
              )}
              {d.jobRetrieval.sourceTotal !== null && d.jobRetrieval.sourceTotal !== undefined && (
                <p>
                  Provider total: {d.jobRetrieval.sourceTotal}. This run uses a limited result page.
                </p>
              )}
              {d.jobRetrieval.sources?.map((source: any) => (
                <p
                  key={`${source.provider || ''}-${source.board}-${source.listingId || source.status}`}
                >
                  {source.company || source.board} · {source.status}
                  {source.count !== undefined
                    ? ` · ${source.count} matching location/keyword filters`
                    : ''}
                </p>
              ))}
              {d.jobRetrieval.limitations?.map((text: string) => (
                <p className="small muted" key={text}>
                  {text}
                </p>
              ))}
            </div>
          </details>
        )}
        {(phase === null || phase === 2) && m.status === 'NO_MATCHES' && (
          <div className="empty-state">
            <BriefcaseBusiness size={30} />
            <h3>No suitable opportunities found.</h3>
            <p>
              Lower the minimum suitability or broaden your preferences, then start another mission.
              Your approved profile remains unchanged.
            </p>
            <button className="primary" onClick={onNewSearch}>
              Adjust search criteria
            </button>
          </div>
        )}
        {(phase === null || phase === 2) && d.matches?.length > 0 && (
          <section id="job-matching">
            <div className="section-heading">
              <h2>
                {d.selectedJob
                  ? 'Your selected opportunity'
                  : 'Opportunities that fit your direction'}
              </h2>
              <span className="muted">
                {d.jobRetrieval?.source === 'fixtures'
                  ? 'Sample jobs'
                  : d.jobRetrieval?.source === 'manual'
                    ? 'User-pasted listing · unverified'
                    : 'Live source snapshots'}{' '}
                · heuristic scores
              </span>
            </div>
            <div className="jobs-grid">
              {(d.selectedJob ? [d.selectedJob] : d.matches).map((r: any) => (
                <article className="job-card" key={r.job.id}>
                  <div className="job-card-top">
                    <div className="company-letter">{r.job.company[0]}</div>
                    <div
                      className="score"
                      role="img"
                      aria-label={`Estimated match score ${r.score} out of 100`}
                      style={
                        {
                          '--score': `${Math.max(0, Math.min(100, Number(r.score) || 0))}%`,
                        } as React.CSSProperties
                      }
                    >
                      <span>{r.score}</span>
                      <small>/ 100</small>
                    </div>
                  </div>
                  <span className="small muted">{r.job.company}</span>
                  <h3>{r.job.title}</h3>
                  <p className="small muted">
                    {r.job.location} · {r.job.employmentType}
                  </p>
                  <p className="small muted">
                    Salary:{' '}
                    {r.job.salary
                      ? `${r.job.salary.currency} ${r.job.salary.min?.toLocaleString() ?? '?'}–${r.job.salary.max?.toLocaleString() ?? '?'} / year · ${r.job.salary.basis || 'source supplied'}`
                      : 'Unknown — not supplied by source'}
                  </p>
                  <div className="pills">
                    {r.matches.slice(0, 4).map((s: string) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  <p>{r.explanation}</p>
                  <JobSourceActions job={r.job} missionId={m.id} request={api} />
                  <details>
                    <summary>Evidence, gaps & source</summary>
                    <p>
                      <strong>Gaps:</strong> {r.gaps.join('; ') || 'No explicit gaps identified.'}
                    </p>
                    <p>{r.job.description}</p>
                    <ul>
                      {r.limitations?.map((limit: string) => (
                        <li key={limit}>{limit}</li>
                      ))}
                    </ul>
                    {r.job.applicationUrl && (
                      <a href={r.job.applicationUrl} target="_blank" rel="noopener noreferrer">
                        View source listing ↗
                      </a>
                    )}
                    <p>
                      Source: {r.job.source.name} · {r.job.source.version}.{' '}
                      {r.job.source.liveVacancy
                        ? 'Retrieved vacancy; availability may change.'
                        : r.job.source.externalListing
                          ? 'User-pasted listing; availability unverified.'
                          : 'Fictional sample vacancy.'}
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
                  Salary and growth reflect supplied source data. Missing information is not
                  inferred.
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
                                    ? `${r.job.salary.currency} ${r.job.salary.min?.toLocaleString() ?? '?'}–${r.job.salary.max?.toLocaleString() ?? '?'} / year (${r.job.source.liveVacancy ? 'source supplied' : 'fictional'})`
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
        {d.selectedJob && (phase === null || phase === 2) && (
          <JobFit key={m.id} missionId={m.id} api={api} />
        )}
      </div>
      <div id="real-applications" />
      {(phase === null || phase === 7) &&
        d.selectedJob?.job?.applicationUrl &&
        d.approvedResumeId && (
          <ApplicationPanel
            mission={m}
            request={api}
            onRecord={(body) => onAction('applications', body)}
          />
        )}
      {(phase === null || phase === 3) && d.resumeDraft && (
        <section id="resume-tailoring" className="panel resume">
          <div className="prototype-resume-layout">
            <div className="prototype-resume-paper">
              <ResumePreview content={d.resumeDraft} />
            </div>
            <aside className="prototype-resume-controls">
              <span className="eyebrow">{d.resumeDraft.jobTitle}</span>
              <div className="section-heading">
                <h2>Your evidence-grounded resume</h2>
                <span className="tag">
                  {d.approvedResumeId ? 'Approved & saved' : 'Review required'}
                </span>
              </div>
              <p className="muted">
                Review your selected experience and make the wording your own.
              </p>
              {d.resumeDraft.excludedSuggestions > 0 && (
                <p role="status" className="small">
                  Some suggested items could not be linked to approved profile facts and were left
                  out. Review the selection before approving.
                </p>
              )}
              <details className="resume-checks">
                <summary>
                  Check your resume · {resumeReadiness(d.resumeDraft).length} suggestions
                </summary>
                <p>
                  These checks use the saved draft. Confirm the employer's application fields and
                  review the exported file before applying.
                </p>
                {resumeReadiness(d.resumeDraft).length ? (
                  <ul>
                    {resumeReadiness(d.resumeDraft).map((issue) => (
                      <li key={issue.key}>{issue.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No missing details identified by these checks.</p>
                )}
                {selectionDirty && <p>Save your content selection to update these checks.</p>}
              </details>
              <details>
                <summary>Sources and selection reasons</summary>
                {d.resumeDraft.claims.map((c: any) => (
                  <div key={c.factId}>
                    <p>{c.text}</p>
                    <p className="small muted">
                      {c.factId} · {c.reason} · Profile v{d.resumeDraft.profileVersion}
                    </p>
                  </div>
                ))}
              </details>
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
                <ResumeSelection
                  draft={d.resumeDraft}
                  busy={busy}
                  onDirty={setSelectionDirty}
                  onSave={(ids) =>
                    onAction('resume-selection', {
                      draftHash: d.resumeDraft.hash,
                      orderedFactIds: ids,
                    })
                  }
                />
              )}
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
                    disabled={!confirm || busy || selectionDirty}
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
              {d.approvedResumeId && <ResumeDownloads id={d.approvedResumeId} />}
              {d.approvedResumeId && (
                <a className="secondary" href={`/api/resumes/${d.approvedResumeId}/download`}>
                  <Download size={16} />
                  Download approved resume
                </a>
              )}
            </aside>
          </div>
        </section>
      )}
      {d.approvedResumeId && (phase === null || phase === 3) && (
        <button className="primary" onClick={() => onNavigate(4)}>
          Continue to interview practice
        </button>
      )}
      <div id="interview-practice" />
      {phase === 4 &&
        d.approvedResumeId &&
        !questions.length &&
        ['QUEUED', 'RUNNING'].includes(m.status) && (
          <section className="panel" role="status">
            <h2>Preparing your interview questions</h2>
            <p>
              Your approved resume is saved. Your interview coach is preparing role-specific
              questions.
            </p>
          </section>
        )}

      {(phase === null || phase === 4) && questions.length > 0 && (
        <div className="prototype-interview-layout">
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
            {d.feedback && phase === 4 && (
              <button className="secondary" onClick={() => onNavigate(null)}>
                View full mission & optional practice
              </button>
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
          <aside className="panel interview-guidance">
            <h2>A little help</h2>
            <p>Try structuring your answer around the situation, your action and the outcome.</p>
            <ol>
              <li>Set the scene: what was the challenge?</li>
              <li>Explain what you personally did.</li>
              <li>Share the result or what you learned.</li>
            </ol>
          </aside>
        </div>
      )}
      {(phase === null || phase === 4) && d.feedback && (
        <section className="panel">
          <h3>Use feedback to strengthen your career evidence</h3>
          <p>
            Save feedback as a draft learning note. Add or correct real experience in My career
            profile; practice answers never become qualifications automatically.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void onAction('feedback-memory', { saveAsDraft: true })}
          >
            Save interview feedback as draft learning memory
          </button>
        </section>
      )}
      {d.evidenceRetrieval && (phase === null || phase === 2) && (
        <details className="panel">
          <summary>Evidence retrieval details</summary>
          <p>{d.evidenceRetrieval.notice}</p>
          <p>
            Retrieval: {d.evidenceRetrieval.strategy}. Only approved profile fact IDs can become
            application claims.
          </p>
          {d.evidenceRetrieval.hits.map((h: any) => (
            <details key={h.id}>
              <summary>{h.id}</summary>
              <p>{h.text}</p>
            </details>
          ))}
        </details>
      )}
      {(phase === null || phase === 5) && d.feedback && d.selectedJob && (
        <section className="panel negotiation">
          <div className="section-heading">
            <h2>
              <MessageSquare size={20} />
              Salary negotiation practice
            </h2>
            <span className="tag">Optional · Interview Coach</span>
          </div>
          <p className="muted">
            Practise one fictional negotiation for {d.selectedJob.job.title}. The coach simulates a
            recruiter reply and gives feedback; you record the final practice decision. No real
            offer is accepted or changed.
          </p>
          {d.negotiationRun?.status === 'FAILED' && (
            <div className="error-banner">
              <AlertCircle size={18} />
              <span>{d.negotiationRun.error}</span>
            </div>
          )}
          {d.negotiation && (
            <div className="negotiation-result">
              <h3>Simulated recruiter reply</h3>
              <p>{d.negotiation.recruiterReply}</p>
              <div className="feedback-grid">
                {[
                  ['Negotiation strengths', d.negotiation.feedback.strengths],
                  ['Improvement areas', d.negotiation.feedback.improvements],
                  ['Next steps', d.negotiation.feedback.nextSteps],
                ].map(([label, items]: any) => (
                  <div key={label}>
                    <h3>{label}</h3>
                    <ul>
                      {items.map((item: string) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {d.negotiation.status === 'REVIEW' ? (
                <div className="form-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void onNegotiationDecision('accept')}
                  >
                    Record my choice: accept
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void onNegotiationDecision('decline')}
                  >
                    Record my choice: decline
                  </button>
                </div>
              ) : (
                <p>
                  Practice decision recorded:{' '}
                  <strong>{d.negotiation.userDecision === 'accept' ? 'accept' : 'decline'}</strong>.
                </p>
              )}
            </div>
          )}
          {(!d.negotiation || d.negotiation.status === 'REVIEW') && (
            <details open={!d.negotiation}>
              <summary>
                {d.negotiation ? 'Try another response' : 'Start negotiation practice'}
              </summary>
              <div className="form-grid">
                <label>
                  Practice offer salary
                  <input
                    type="number"
                    min="1"
                    value={offerSalary}
                    onChange={(event) => setOfferSalary(event.target.value)}
                  />
                </label>
                <label>
                  Your target salary
                  <input
                    type="number"
                    min="1"
                    value={targetSalary}
                    onChange={(event) => setTargetSalary(event.target.value)}
                  />
                </label>
                <label>
                  Currency
                  <input
                    value={currency}
                    maxLength={3}
                    onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  />
                </label>
              </div>
              <label>
                Your negotiation response
                <textarea
                  rows={5}
                  value={negotiationMessage}
                  onChange={(event) => setNegotiationMessage(event.target.value)}
                  placeholder="Explain the value you can bring, state your request and keep the decision yours."
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  d.negotiationRun?.status === 'RUNNING' ||
                  !Number.isFinite(Number(offerSalary)) ||
                  !Number.isFinite(Number(targetSalary)) ||
                  currency.trim().length !== 3 ||
                  negotiationMessage.trim().length < 10
                }
                onClick={() =>
                  void onNegotiation({
                    offerSalary: Number(offerSalary),
                    targetSalary: Number(targetSalary),
                    currency,
                    candidateMessage: negotiationMessage,
                  })
                }
              >
                {d.negotiationRun?.status === 'RUNNING'
                  ? 'Simulating negotiation…'
                  : 'Practice salary negotiation'}
                <ArrowRight size={16} />
              </button>
            </details>
          )}
        </section>
      )}
      {phase === null && (
        <details className="panel mission-activity">
          <summary>Activity and agent details</summary>
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
        </details>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

function ResumeDownloads({ id }: { id: string }) {
  return (
    <span className="form-actions">
      <a className="secondary" href={`/api/resumes/${id}/download?format=docx`}>
        Download DOCX
      </a>
      <a className="secondary" href={`/api/resumes/${id}/download?format=pdf`}>
        Download PDF
      </a>
    </span>
  );
}
