import { WorkspaceHome, nextMissionStep } from './workspace-home.js';
import { FlowNavigation } from './flow-navigation.js';
import { ResumePreview } from './resume-preview.js';
import { pendingResumeChanges } from '../../../packages/contracts/src/resume-review.js';
import { CompanyAvatar, SourceIcon } from './company-avatar.js';
import { MissionProfile } from './mission-profile.js';
import { JobFit } from './job-fit.js';
import { suggestJobSearch } from '../../../packages/contracts/src/job-search.js';
import { ProfileRecords } from './profile-records.js';
import { ProfileImport } from './profile-import.js';
import { ResumeAgent } from './resume-agent.js';
import { ProfileConversation } from './profile-conversation.js';
import { CareerMemoryPanel } from './career-memory.js';
import { DocumentWorkspace } from './document-workspace.js';
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
  Download,
  CheckCircle2,
  AlertCircle,
  Target,
  House,
  Search,
  FileText,
  UserRound,
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
  'missions' | 'profile' | 'approved-profile' | 'approvals' | 'library' | 'activity' | 'tools';

const readWorkspaceRoute = () => {
  const query = new URLSearchParams(window.location.search);
  const validTabs = [
    'missions',
    'profile',
    'approved-profile',
    'approvals',
    'library',
    'activity',
    'tools',
  ];
  const value = query.get('view') || 'missions';
  const step = query.has('step') ? Number(query.get('step')) : null;
  return {
    tab: (validTabs.includes(value) ? value : 'missions') as Tab,
    selected: query.get('mission'),
    phase: step !== null && Number.isInteger(step) && step >= 0 && step <= 7 ? step : null,
  };
};
// Own workspace navigation and refreshes here; the server remains the source of mission status.
function App() {
  const [session, setSession] = useState<any>(null),
    [ready, setReady] = useState(false),
    [workspace, setWorkspace] = useState<any>(null),
    [tab, setTab] = useState<Tab>(() => readWorkspaceRoute().tab),
    [phase, setPhase] = useState<number | null>(() => readWorkspaceRoute().phase),
    [selected, setSelected] = useState<string | null>(() => readWorkspaceRoute().selected),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [minScore, setMinScore] = useState(40),
    [jobSearch, setJobSearch] = useState(defaultJobSearch),
    [goal, setGoal] = useState(''),
    [notice, setNotice] = useState(''),
    [profileSection, setProfileSection] = useState<'profile' | 'memory'>('profile'),
    [showAllActivity, setShowAllActivity] = useState(false),
    [memoryVisited, setMemoryVisited] = useState(false),
    [agentPrompt, setAgentPrompt] = useState<{ id: string; text: string; label: string } | null>(
      null,
    );

  useEffect(() => {
    const restore = () => {
      const route = readWorkspaceRoute();
      setTab(route.tab);
      setPhase(route.phase);
      setSelected(route.selected);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (!ready || !session?.user) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', tab);
    if (selected) url.searchParams.set('mission', selected);
    else url.searchParams.delete('mission');
    if (phase !== null) url.searchParams.set('step', String(phase));
    else url.searchParams.delete('step');
    if (url.search !== window.location.search) window.history.pushState(null, '', url);
  }, [ready, session?.user?.id, tab, phase, selected]);
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
  useEffect(() => {
    if (
      !busy &&
      tab === 'missions' &&
      mission &&
      phase !== null &&
      phase > 0 &&
      phase < 5 &&
      phase > nextMissionStep(mission)
    ) {
      setPhase(nextMissionStep(mission));
      setNotice('Continue from the next available step in this application journey.');
    }
  }, [tab, mission?.id, mission?.status, phase, busy]);
  useEffect(() => {
    if (tab === 'profile' && workspace?.profile) {
      setTab('approved-profile');
      setSelected(null);
      setPhase(null);
    }
  }, [tab, workspace?.profile?.id]);
  const selectJourneyStep = (i: number) => {
    const active = mission || workspace?.missions[0];
    if (i > 0 && active && i > nextMissionStep(active)) {
      setNotice(
        'Complete the current step before continuing. Earlier steps remain available to review.',
      );
      return;
    }
    setPhase(i);
    setError('');
    if (i === 0 && !mission) setTab('profile');
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

  const observedMission = useRef<{ id: string; status: string } | null>(null);
  const automaticHandoff = useRef<{ id: string; phase: number | null } | null>(null);
  useEffect(() => {
    if (!mission) return;
    const previous = observedMission.current;
    const working = ['RUNNING', 'QUEUED'].includes(mission.status);
    if (
      working &&
      (!previous || previous.id !== mission.id || !['RUNNING', 'QUEUED'].includes(previous.status))
    )
      automaticHandoff.current = { id: mission.id, phase };
    else if (working && automaticHandoff.current?.phase !== phase) automaticHandoff.current = null;
    observedMission.current = { id: mission.id, status: mission.status };
    if (
      tab !== 'missions' ||
      !previous ||
      previous.id !== mission.id ||
      !['RUNNING', 'QUEUED'].includes(previous.status) ||
      ['RUNNING', 'QUEUED'].includes(mission.status)
    )
      return;
    const next = nextMissionStep(mission);
    const handoff = automaticHandoff.current;
    automaticHandoff.current = null;
    if (
      handoff &&
      handoff.id === mission.id &&
      handoff.phase === phase &&
      phase !== null &&
      phase < next &&
      phase >= next - 1
    ) {
      setPhase(next);
      setNotice(
        mission.status === 'AWAITING_JOB'
          ? 'Your matches are ready. Review the gaps and choose a job.'
          : mission.status === 'AWAITING_APPROVAL'
            ? 'Your resume is ready. Review the changes before saving.'
            : mission.status === 'AWAITING_INTERVIEW'
              ? 'Your interview is ready. Practise your first answer.'
              : 'Your results are ready.',
      );
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [mission?.id, mission?.status, phase, tab]);

  const approvals =
    workspace?.missions.filter((m: any) =>
      ['AWAITING_JOB', 'AWAITING_APPROVAL'].includes(m.status),
    ) || [];
  useEffect(() => {
    if (!creating || !workspace?.profile?.data) return;
    const profile = workspace.profile.data;
    const suggestions = suggestJobSearch(profile);
    setGoal((value) => (value.trim() ? value : profile.goals));
    setJobSearch((value) => ({
      ...value,
      keyword: value.keyword || suggestions.keyword,
      location: value.location || suggestions.location,
    }));
  }, [creating, workspace?.profile?.id]);
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
  const renderProfile = (mode: 'build' | 'edit') => (
    <Profile
      mode={mode}
      initialPrompt={mode === 'edit' ? agentPrompt : null}
      key={mode}
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
          setNotice('Your reviewed profile is now approved. Previous documents remain available.');
          if (mode === 'build') {
            setSelected(null);
            setPhase(null);
            setTab('missions');
            setCreating(true);
          }
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
  );
  const nav = [
    { id: 'missions', label: 'Overview', icon: House },
    { id: 'profile', label: 'Build profile', icon: MessageSquare },
    { id: 'jobs', label: 'Find jobs', icon: Search },
    { id: 'library', label: 'My documents', icon: FileText },
    { id: 'approved-profile', label: 'My profile', icon: UserRound },
    { id: 'approvals', label: 'Approval inbox', icon: FileCheck2 },
    { id: 'applications', label: 'Applications', icon: BriefcaseBusiness },
    { id: 'activity', label: 'Activity timeline', icon: Activity },
    { id: 'tools', label: 'Optional tools', icon: Target },
  ];
  return (
    <div className="shell agent-app">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
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
            .filter(
              (n) =>
                !['approvals', 'applications', 'activity', 'tools'].includes(n.id) &&
                !(n.id === 'profile' && workspace?.profile),
            )
            .map((n) => (
              <button
                key={n.id}
                aria-current={tab === n.id || (n.id === 'jobs' && phase === 2) ? 'page' : undefined}
                className={
                  n.id === 'jobs'
                    ? tab === 'missions' && phase === 2
                      ? 'nav active'
                      : 'nav'
                    : tab === n.id && !(n.id === 'missions' && (phase !== null || selected))
                      ? 'nav active'
                      : 'nav'
                }
                onClick={() => {
                  if (n.id === 'jobs') {
                    if (!workspace?.profile) {
                      setTab('profile');
                      setSelected(null);
                      setPhase(0);
                      return;
                    }
                    const candidate = mission || workspace?.missions[0];
                    const active =
                      candidate &&
                      [
                        'QUEUED',
                        'RUNNING',
                        'AWAITING_JOB',
                        'AWAITING_APPROVAL',
                        'AWAITING_INTERVIEW',
                      ].includes(candidate.status)
                        ? candidate
                        : null;
                    if (active) {
                      setSelected(active.id);
                      setTab('missions');
                      setPhase(active.data?.matches?.length ? 2 : nextMissionStep(active));
                    } else {
                      setCreating(true);
                    }
                    setError('');
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
                aria-label="My profile"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  setTab('approved-profile');
                  setPhase(null);
                  setSelected(null);
                }}
              >
                My profile
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
                : tab === 'missions' && mission?.status === 'COMPLETE'
                  ? 'Journey results'
                  : tab === 'approved-profile'
                    ? 'My profile'
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
        <main id="main-content" tabIndex={-1}>
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
              current={
                tab === 'profile'
                  ? 0
                  : phase === null && mission?.status === 'COMPLETE'
                    ? -1
                    : (phase ?? 0)
              }
              onSelect={selectJourneyStep}
            />
          )}
          {tab === 'approved-profile' ? (
            <div className="approved-profile-page" aria-label="Approved profile">
              <nav className="workspace-tabs" aria-label="Profile sections">
                <button
                  aria-pressed={profileSection === 'profile'}
                  onClick={() => setProfileSection('profile')}
                >
                  Profile
                </button>
                <button
                  aria-pressed={profileSection === 'memory'}
                  onClick={() => {
                    setMemoryVisited(true);
                    setProfileSection('memory');
                  }}
                >
                  Stories &amp; notes
                </button>
              </nav>
              <div hidden={profileSection !== 'profile'}>{renderProfile('edit')}</div>
              <div hidden={profileSection !== 'memory'}>
                {memoryVisited && (
                  <section id="career-memory-library" aria-label="Career memory">
                    <CareerMemoryPanel
                      api={api}
                      incoming={null}
                      profileVersion={workspace?.profile?.version || 0}
                      onDiscuss={(memory) => {
                        setAgentPrompt({
                          id: crypto.randomUUID(),
                          label: memory.title,
                          text: `Help me use this confirmed story in my profile. Suggest changes for review.\n${memory.title}\n${memory.text.slice(0, 3300)}`,
                        });
                        setProfileSection('profile');
                      }}
                    />
                  </section>
                )}
              </div>
            </div>
          ) : tab === 'tools' ? (
            <OptionalTools missions={workspace?.missions || []} request={api} onRefresh={refresh} />
          ) : tab === 'profile' ? (
            renderProfile('build')
          ) : tab === 'missions' ? (
            <>
              {mission ? (
                <MissionDetail
                  key={mission.id}
                  mission={mission}
                  phase={phase}
                  onNavigate={setPhase}
                  onNewSearch={() => {
                    setGoal(mission.goal);
                    setMinScore(mission.data.minScore ?? 40);
                    setJobSearch({
                      ...defaultJobSearch,
                      ...mission.data.jobSearch,
                      listing: { ...defaultJobSearch.listing, ...mission.data.jobSearch?.listing },
                    });
                    setCreating(true);
                  }}
                  busy={busy}
                  onBack={() => {
                    setSelected(null);
                    setPhase(null);
                  }}
                  onAction={(kind, body) =>
                    act(async () => {
                      await api(`/missions/${mission.id}/${kind}`, 'POST', body || {});
                      if (kind === 'job-link')
                        setNotice('Job read. Review the listing and choose it as your target.');
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
                    onSearch={(nextGoal) => {
                      if (nextGoal) setGoal(nextGoal);
                      setCreating(true);
                    }}
                    onLibrary={() => {
                      setTab('library');
                      setPhase(null);
                    }}
                    onOpen={(m, targetPhase) => {
                      setSelected(m.id);
                      setPhase(
                        targetPhase ?? (m.status === 'COMPLETE' ? null : nextMissionStep(m)),
                      );
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
              <DocumentWorkspace resumes={workspace?.resumes || []} api={api} onSaved={refresh} />
            </>
          ) : (
            <>
              <PageTitle
                eyebrow="VISIBLE EVERY STEP OF THE WAY"
                title="Activity timeline"
                text="See completed actions, tool use and the decisions that moved your missions forward."
              />
              {workspace?.missions
                .flatMap((m: any) =>
                  m.events
                    .slice(-12)
                    .reverse()
                    .map((e: any, i: number) => (
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
                )
                .slice(0, showAllActivity ? undefined : 24)}
              {!!workspace?.missions.length && (
                <button
                  className="text-button"
                  onClick={() => setShowAllActivity(!showAllActivity)}
                >
                  {showAllActivity ? 'Show recent activity' : 'Show more activity'}
                </button>
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
              if (event.key === 'Tab') {
                const controls = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary',
                  ),
                ).filter((e) => e.getClientRects().length);
                const first = controls[0],
                  last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                }
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
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
              your next steps. All four specialists use this approved profile automatically.
            </p>
            <label>
              Career goal
              <textarea
                aria-label="Career goal"
                autoFocus
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <JobSearchFields
              value={jobSearch}
              onChange={setJobSearch}
              adzunaConfigured={session?.recruitment?.adzunaConfigured}
              tavilyConfigured={session?.recruitment?.tavilyConfigured}
              tavilyAccessMode={session?.recruitment?.tavilyAccessMode}
            />
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
                    setTab('missions');
                    setSelected(m.id);
                    setPhase(1);
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
    <details className="coach-evidence">
      <summary>Why this fits</summary>
      <small>
        {item.reason || 'Based on your approved profile.'} · Evidence:{' '}
        {item.evidenceIds?.join(', ') || 'Unavailable'}
      </small>
    </details>
  );
}

// Keep editable input, prepared draft and explicit review confirmation as separate UI states.
function Profile({
  mode = 'build',
  initialPrompt,
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
  mode?: 'build' | 'edit';
  initialPrompt?: { id: string; text: string; label: string } | null;
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
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(null);
  const [approvalMotion, setApprovalMotion] = useState(false);
  const profileSurface = useRef<HTMLElement | null>(null);
  const approvedVersion = useRef<number | null>(profile?.version ?? null);
  useEffect(() => {
    if (!sample) return;
    const nextVersion = profile?.version || 0;
    if (approvedVersion.current === null) {
      approvedVersion.current = nextVersion;
      return;
    }
    if (nextVersion > approvedVersion.current) {
      setApprovalMotion(true);
      profileSurface.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      const timer = setTimeout(() => setApprovalMotion(false), 1800);
      approvedVersion.current = nextVersion;
      return () => clearTimeout(timer);
    }
    approvedVersion.current = nextVersion;
  }, [profile?.version, Boolean(sample)]);
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
  const conversationPane = (
    <section
      id="profile-conversation"
      className="panel profile-chat-main"
      role={mode === 'edit' ? 'complementary' : 'region'}
      aria-label={
        mode === 'build' ? 'Profile building conversation' : 'Profile conversation sidebar'
      }
    >
      <ProfileConversation
        mode={mode}
        initialPrompt={initialPrompt}
        previewTarget={previewTarget}
        previewData={draft?.data || form}
        approved={!!profile && JSON.stringify(form) === JSON.stringify(profile.data)}
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
  );
  return (
    <>
      <div className="page-heading profile-workbench-title">
        <div>
          <h1>{mode === 'build' ? 'Build your profile' : 'My profile'}</h1>
          <p>
            {mode === 'build'
              ? 'Tell your story. Your agent will build the profile with you.'
              : 'Ask your agent to refine your profile. You decide what to keep.'}
          </p>
        </div>
        <a className="secondary profile-conversation-jump" href="#profile-conversation">
          Open conversation <MessageSquare size={16} />
        </a>
      </div>
      <fieldset
        disabled={busy || committing}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div className={`chat-profile-layout profile-workbench profile-mode-${mode}`}>
          {mode === 'build' && conversationPane}
          <div className={`profile-draft-side ${approvalMotion ? 'profile-just-approved' : ''}`}>
            <section ref={profileSurface} className="panel profile-editor-surface">
              <div className="section-heading">
                <h2>Your profile</h2>
                <span className="tag">
                  {profile
                    ? JSON.stringify(form) === JSON.stringify(profile.data)
                      ? `Approved v${profile.version}`
                      : `Unsaved changes · based on v${profile.version}`
                    : 'Not approved yet'}
                </span>
              </div>
              <p className="profile-editor-caption">
                {mode === 'build'
                  ? 'Your conversation, organised into a profile.'
                  : 'Review changes before saving a new version.'}
              </p>
              {approvalMotion && (
                <div className="profile-approved-notice" role="status">
                  <CheckCircle2 size={20} />
                  Profile approved and saved
                </div>
              )}
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              <div ref={setPreviewTarget} />
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
                  {input('startDate', 'Experience start date (optional)', { type: 'date' })}
                  {input('endDate', 'Experience end date (optional)', { type: 'date' })}
                  <details className="wide">
                    <summary>Job preferences</summary>
                    <p className="small muted">
                      Used for coaching and job matching. Not included as resume claims.
                    </p>
                    <div className="form-grid">
                      {input('employmentType', 'Employment preference', {
                        placeholder: 'Optional',
                      })}
                      {input('workArrangement', 'Work arrangement', { placeholder: 'e.g. Hybrid' })}
                      {input('companySize', 'Company size preference', { placeholder: 'Optional' })}
                      {input('industry', 'Industry preference', { placeholder: 'e.g. Technology' })}
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
                </div>
              </details>
              <p className="small muted">
                Your career team uses approved profile facts when you start a mission. Profile
                changes and resume versions still require your approval.
              </p>
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
          </div>
          {mode === 'edit' && conversationPane}
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
    [answer, setAnswer] = useState(''),
    [jobURL, setJobURL] = useState(''),
    [question, setQuestion] = useState(0),
    [analysisFeedback, setAnalysisFeedback] = useState(''),
    [confirm, setConfirm] = useState(false),
    [compareIds, setCompareIds] = useState<string[]>([]),
    [offerSalary, setOfferSalary] = useState(''),
    [targetSalary, setTargetSalary] = useState(''),
    [currency, setCurrency] = useState('AUD'),
    [negotiationMessage, setNegotiationMessage] = useState(''),
    [viewJobId, setViewJobId] = useState('');
  const questions = d.questions || [],
    q = questions[question],
    responseCount = d.answers?.length || 0,
    budgetExhausted = (d.apiCalls || 0) >= 12,
    isWorking = ['RUNNING', 'QUEUED'].includes(m.status);

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

  const completed = m.status === 'COMPLETE';
  if (completed && (phase === null || phase > 4))
    return (
      <section aria-label="Completed journey results">
        <button className="back" onClick={onBack}>
          ← All missions
        </button>
        <div className="page-heading">
          <div>
            <span className="eyebrow">JOURNEY COMPLETE · 5 OF 5</span>
            <h1>Your journey results</h1>
            <p>{m.goal}</p>
          </div>
          <button className="primary" onClick={onNewSearch}>
            Start a new journey <ArrowRight size={16} />
          </button>
        </div>
        <p>
          This journey is saved. Review its five steps above. New work uses your latest approved
          profile and keeps these results unchanged.
        </p>
        <section className="panel" aria-label="Saved application results">
          <h2>{d.selectedJob?.job.title || 'Your application'}</h2>
          <p>{d.selectedJob?.job.company}</p>
          {d.approvedResumeId && <ResumeDownloads id={d.approvedResumeId} />}
          <button className="text-button" onClick={() => onNavigate(3)}>
            View approved resume
          </button>
          <button className="text-button" onClick={() => onNavigate(4)}>
            Review interview answers
          </button>
        </section>
        {d.feedback && (
          <section className="panel" aria-label="Saved interview feedback">
            <h2>Interview feedback</h2>
            {(['strengths', 'improvements', 'nextSteps'] as const).map((key) => (
              <div key={key}>
                <h3>
                  {key === 'nextSteps'
                    ? 'Next practice'
                    : key === 'improvements'
                      ? 'Areas to improve'
                      : 'Strengths'}
                </h3>
                <ul>
                  {(d.feedback[key] || []).map((item: string, i: number) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </section>
    );
  return (
    <>
      <button className="back" onClick={onBack}>
        ← All missions
      </button>
      {completed && (
        <div className="info" role="note">
          <span>Saved journey · Read-only history</span>
          <button className="text-button" onClick={() => onNavigate(null)}>
            Back to results
          </button>
          <button className="secondary" onClick={onNewSearch}>
            Start a new journey
          </button>
        </div>
      )}
      <div className="mission-heading">
        <div>
          <span className="eyebrow">
            {phase !== null
              ? phase < 5
                ? `STEP ${String(phase + 1).padStart(2, '0')} OF 05`
                : 'OPTIONAL CAREER TOOL'
              : `CAREER MISSION · ${m.mode === 'fixture' ? 'DEMO' : 'LIVE'}`}
          </span>
          <h1>
            {phase === 0
              ? 'Your profile for this journey'
              : phase === null
                ? m.goal
                : stagePresentation[phase]?.title || phaseNames[phase]}
          </h1>
          <p>
            {phase === 0
              ? 'Review the approved profile snapshot attached to this application.'
              : phase === null
                ? `Started ${date(m.createdAt)} · Your approved context, saved with this mission.`
                : stagePresentation[phase]?.description || m.goal}
          </p>
        </div>
        <Status value={m.status} />
      </div>
      <div className="mission-context-strip" aria-label="Agent context">
        <span>
          <UserRound size={14} />
          Profile snapshot for this journey
        </span>
        {d.selectedJob && (
          <span>
            <BriefcaseBusiness size={14} />
            {d.selectedJob.job.title}
          </span>
        )}
        {d.approvedResumeId && (
          <span>
            <FileCheck2 size={14} />
            Approved resume
          </span>
        )}
        <strong>
          {m.status === 'AWAITING_JOB'
            ? 'Your decision · Choose a target'
            : m.status === 'AWAITING_APPROVAL'
              ? 'Your decision · Approve the resume'
              : m.status === 'AWAITING_INTERVIEW'
                ? 'Your turn · Practise an answer'
                : ['RUNNING', 'QUEUED'].includes(m.status)
                  ? 'Agent working'
                  : nice(m.status)}
        </strong>
      </div>
      {phase === 0 && (
        <MissionProfile
          missionId={m.id}
          api={api}
          onContinue={() => onNavigate(completed ? null : nextMissionStep(m))}
          completed={completed}
        />
      )}
      {phase === 2 && ['AWAITING_JOB', 'NO_MATCHES'].includes(m.status) && !d.selectedJob && (
        <section className="panel" aria-label="Read a job link">
          <h2>Have a job in mind?</h2>
          <div className="form-actions">
            <label style={{ flex: 1 }}>
              Job listing URL
              <input
                type="url"
                value={jobURL}
                onChange={(e) => setJobURL(e.target.value)}
                placeholder="Paste a job listing link…"
              />
            </label>
            <button
              className="secondary"
              disabled={busy || !jobURL.trim()}
              onClick={async () => {
                await onAction('job-link', { url: jobURL.trim() });
                setViewJobId('');
              }}
            >
              {busy ? 'Reading job listing…' : 'Read job'}
            </button>
          </div>
          <p className="small muted">
            We’ll read the public listing. Review the job and its gaps before choosing it.
          </p>
        </section>
      )}
      {phase === 2 && !completed && (
        <button className="primary" onClick={onNewSearch}>
          Search Australian jobs
        </button>
      )}
      {m.error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>
            {budgetExhausted && m.status === 'FAILED'
              ? 'This mission has reached its AI usage limit. Start a new mission to continue. Your saved results are still available.'
              : m.error}
          </span>
        </div>
      )}
      <div className="mission-actions">
        {m.status === 'FAILED' && budgetExhausted && (
          <button className="primary" disabled={busy} onClick={onNewSearch}>
            Start a new mission
            <ArrowRight size={15} />
          </button>
        )}
        {m.status === 'FAILED' && !budgetExhausted && (
          <button className="secondary" disabled={busy} onClick={() => void onAction('retry')}>
            <RefreshCw size={15} />
            Retry failed step
          </button>
        )}
        {!['COMPLETE', 'CANCELLED', 'STALE', 'NO_MATCHES', 'FAILED'].includes(m.status) && (
          <button className="text-button" disabled={busy} onClick={() => void onAction('cancel')}>
            <Pause size={15} />
            Cancel further work
          </button>
        )}
        <details className="run-details">
          <summary>AI usage</summary>
          <span className="muted small">
            {d.apiCalls || 0} / 12 model calls ·{' '}
            {((d.inputTokens || 0) + (d.outputTokens || 0)).toLocaleString()} tokens recorded
          </span>
        </details>
      </div>
      {isWorking && (
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
            <ol className="agent-stage-progress" aria-label="Agent progress">
              {(d.selectedJob
                ? [
                    { label: 'Target job selected', done: true },
                    {
                      label: d.approvedResumeId ? 'Resume approved' : 'Preparing your resume',
                      done: !!d.approvedResumeId,
                    },
                    {
                      label: d.approvedResumeId
                        ? 'Preparing interview questions'
                        : 'Your review and approval',
                      done: false,
                    },
                  ]
                : [
                    { label: 'Reviewing your profile', done: !!d.analysis },
                    { label: 'Finding matching jobs', done: !!d.matches?.length },
                    { label: 'Your choice of target job', done: false },
                  ]
              ).map((stage, index, stages) => (
                <li
                  key={stage.label}
                  className={
                    stage.done
                      ? 'done'
                      : index === stages.findIndex((item) => !item.done)
                        ? 'current'
                        : ''
                  }
                >
                  <span aria-hidden="true">{stage.done ? '✓' : index + 1}</span>
                  {stage.label}
                </li>
              ))}
            </ol>
            <p>
              Your agent continues in the background. We’ll open the next step when it is ready.
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
            <h2>{isWorking ? 'Preparing this step' : 'Before you start'}</h2>
            <p>
              {phase === 3
                ? d.selectedJob
                  ? `Target: ${d.selectedJob.job.title}. ${isWorking ? 'Your resume is being prepared.' : 'Your resume is not ready yet. Continue after resolving the mission status above.'}`
                  : 'Target: Select a target in Job matching first.'
                : phase === 4
                  ? d.approvedResumeId
                    ? isWorking
                      ? 'Your approved resume is saved. Interview questions are being prepared.'
                      : 'Your approved resume is saved. Continue after resolving the mission status above.'
                    : 'Approve your evidence-based resume before starting interview practice.'
                  : phase === 7
                    ? 'Select a real target job and approve your resume before preparing an application.'
                    : isWorking
                      ? 'Your career team is preparing this step. Results are saved with this mission.'
                      : 'This step has no results yet. Check the mission status above to continue.'}
            </p>
            {(phase === 3 || phase === 7) && (
              <>
                <button className="secondary" onClick={() => onNavigate(2)}>
                  Go to 03 Job matching
                </button>
                <details className="stage-evidence-help">
                  <summary>How profile evidence is used</summary>
                  <p className="muted">
                    Your resume uses approved profile facts. To add or correct a fact, update and
                    approve your profile first.
                  </p>
                </details>
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
        <section className="panel analysis agent-output-layout">
          <div className="analysis-output">
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
                  <div className="coach-next-step" key={coachText(s)}>
                    <span>{i + 1}</span>
                    <div>
                      {coachText(s)}
                      <CoachEvidence item={s} />
                    </div>
                  </div>
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
          </div>
          {!completed && (
            <aside className="agent-decision-pane">
              <h3>Career Coach</h3>
              <p className="agent-context-caption">Using your approved profile</p>
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
                Run revised analysis
              </button>
              <p className="small muted">Starts a new analysis; this result stays saved.</p>
              <button className="text-button" onClick={() => onNavigate(2)}>
                Explore matched jobs <ArrowRight size={14} />
              </button>
            </aside>
          )}
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
            {!d.selectedJob && (
              <nav className="job-choice-list" aria-label="Matched jobs">
                {d.matches.map((r: any) => (
                  <button
                    key={r.job.id}
                    aria-pressed={(viewJobId || d.matches[0]?.job.id) === r.job.id}
                    onClick={() => setViewJobId(r.job.id)}
                  >
                    <span className="job-choice-identity">
                      <CompanyAvatar job={r.job} small />
                      <strong>{r.job.title}</strong>
                    </span>
                    <span>
                      {r.job.company} · {r.score}/100
                    </span>
                  </button>
                ))}
              </nav>
            )}
            <div className="jobs-grid">
              {(d.selectedJob
                ? [d.selectedJob]
                : [d.matches.find((r: any) => r.job.id === viewJobId) || d.matches[0]]
              ).map((r: any) => (
                <article className="job-card" key={r.job.id}>
                  <div className="job-card-top">
                    <CompanyAvatar job={r.job} />
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
                  <span className="small muted job-choice-identity">
                    <SourceIcon job={r.job} />
                    {r.job.company}
                  </span>
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
                  {r.gaps?.length > 0 && (
                    <div className="job-gap-notice" role="note">
                      <strong>Before you choose: evidence gaps</strong>
                      <ul>
                        {r.gaps.slice(0, 4).map((gap: string) => (
                          <li key={gap}>{gap}</li>
                        ))}
                      </ul>
                      <p>
                        You can pursue this role, but your resume will only use experience you have
                        confirmed.
                      </p>
                    </div>
                  )}
                  {!completed && <JobSourceActions job={r.job} missionId={m.id} request={api} />}
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
            <div
              className="prototype-resume-paper resume-draft-preview"
              key={d.resumeDraft.hash}
              aria-busy={busy}
            >
              <ResumePreview
                content={d.resumeDraft}
                changes={
                  d.approvedResumeId ? [] : pendingResumeChanges(d.resumeDraft, d.resumeChanges)
                }
                busy={busy}
                onRestore={
                  m.status === 'AWAITING_APPROVAL'
                    ? (factId) =>
                        onAction('resume-agent/restore', { draftHash: d.resumeDraft.hash, factId })
                    : undefined
                }
              />
            </div>
            <aside className="prototype-resume-controls">
              <p className="agent-context-caption">Target · {d.resumeDraft.jobTitle}</p>
              <JobFit missionId={m.id} api={api} compact />
              {d.selectedJob?.gaps?.length > 0 && (
                <div className="job-gap-notice" role="note">
                  <strong>Gaps to keep in mind</strong>
                  <ul>
                    {d.selectedJob.gaps.slice(0, 4).map((gap: string) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                  <p>Tailoring improves relevance; it does not add missing qualifications.</p>
                </div>
              )}
              <div className="section-heading">
                <h2>{completed ? 'Saved resume' : 'Edit with your agent'}</h2>
                <span className="tag">
                  {d.approvedResumeId ? 'Approved & saved' : 'Review required'}
                </span>
              </div>
              {m.status === 'AWAITING_APPROVAL' && (
                <ResumeAgent
                  draft={d.resumeDraft}
                  messages={d.resumeChat || []}
                  busy={busy}
                  onEdit={(message) =>
                    onAction('resume-agent', { draftHash: d.resumeDraft.hash, message })
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
                    I reviewed this resume and am ready to save it.
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
      {!completed && d.approvedResumeId && (phase === null || phase === 3) && (
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
            {completed && (
              <section aria-label="Saved interview answers">
                <h3>Your saved answers</h3>
                {(d.answers || []).map((a: any, i: number) => (
                  <article key={a.questionId || i}>
                    <h4>
                      {questions.find((q: any) => q.id === a.questionId)?.question ||
                        `Question ${i + 1}`}
                    </h4>
                    <p>{a.answer}</p>
                  </article>
                ))}
              </section>
            )}
            {d.feedback && phase === 4 && (
              <button className="secondary" onClick={() => onNavigate(null)}>
                Back to journey results
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
      {!completed && (phase === null || phase === 4) && d.feedback && (
        <details className="panel feedback-memory-action">
          <summary>Keep a learning note</summary>
          <p>Save this feedback for later. It stays separate from your approved profile.</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void onAction('feedback-memory', { saveAsDraft: true })}
          >
            Save interview feedback as draft learning memory
          </button>
        </details>
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
      {!completed && (phase === null || phase === 5) && d.feedback && d.selectedJob && (
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
