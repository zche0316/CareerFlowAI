import { MISSION_MODEL_CALL_LIMIT } from '../../../packages/contracts/src/mission-limits.js';
import { nextMissionStep } from './mission-step.js';
import { ResumePreview } from './resume-preview.js';
import { pendingResumeChanges } from '../../../packages/contracts/src/resume-review.js';
import { JobFit } from './job-fit.js';
import { suggestJobSearch } from '../../../packages/contracts/src/job-search.js';
import { PartyDecision, PartyTrack } from './quest/party-review.js';
import { QuestLog, QuestMissionHeader } from './quest/quest-log.js';
import { QuestJobTable } from './quest/job-board.js';
import { RoleCard } from './quest/role-card.js';
import { progressFrom } from './quest/progress.js';
import { QuestTopBar, type QuestNavId } from './quest/top-bar.js';
import { QuestHome } from './quest/home.js';
import { adviceItem, CoachPage, QuestCoach } from './quest/coach.js';
import { runPhase, runRoute } from './quest/run-route.js';
import { reloadEstimates, RunEstimate } from './quest/run-estimate.js';
import { EvidenceQuestion } from './quest/evidence-question.js';
import { ReadAloud } from './quest/voice.js';
import { SignIn } from './quest/sign-in.js';
import { boardStage, stageCopy } from './quest/applications.js';
import './quest/fonts.js';
import { recordKeys } from '../../../packages/contracts/src/profile-records.js';
import {
  JobSearchFields,
  defaultJobSearch,
  ApplicationPanel,
  JobSourceActions,
} from './recruitment.js';
import React, { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  Check,
  Compass,
  FileCheck2,
  Activity,
  X,
  Pause,
  RefreshCw,
  ShieldCheck,
  BriefcaseBusiness,
  MessageSquare,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { blankProfile, type CareerProfile } from '../../../packages/contracts/src/index.js';
import './style.css';
import './quest/quest.css';

// Pages that only open on demand load in their own chunk (CFS-129), so the first page needs less
// code. Each keeps its props type and shows a short loading line while its chunk arrives.
function lazyPage<M extends Record<string, any>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
) {
  const Page = lazy(() => load().then((m) => ({ default: m[name] })));
  return (props: React.ComponentProps<M[K]>) => (
    <Suspense fallback={<p className="quest-fine dark">Loading…</p>}>
      <Page {...props} />
    </Suspense>
  );
}
const ProfileImport = lazyPage(() => import('./profile-import.js'), 'ProfileImport');
const QuestBattleLog = lazyPage(() => import('./quest/battle-log.js'), 'QuestBattleLog');
const QuestSavePoints = lazyPage(() => import('./quest/save-points.js'), 'QuestSavePoints');
const QuestBossBattle = lazyPage(() => import('./quest/boss-battle.js'), 'QuestBossBattle');
const QuestWorld = lazyPage(() => import('./quest/world.js'), 'QuestWorld');
const QuestSeason = lazyPage(() => import('./quest/season.js'), 'QuestSeason');
const QuestScout = lazyPage(() => import('./quest/scout.js'), 'QuestScout');
const PartyRoster = lazyPage(() => import('./quest/roster.js'), 'PartyRoster');
const ProfileConversation = lazyPage(() => import('./profile-conversation.js'), 'ProfileConversation');
const CareerMemoryPanel = lazyPage(() => import('./career-memory.js'), 'CareerMemoryPanel');
const DocumentWorkspace = lazyPage(() => import('./document-workspace.js'), 'DocumentWorkspace');
const CharacterSheet = lazyPage(() => import('./quest/character-sheet.js'), 'CharacterSheet');
const ProfileRecords = lazyPage(() => import('./profile-records.js'), 'ProfileRecords');
const ResumeManualEdit = lazyPage(() => import('./resume-manual-edit.js'), 'ResumeManualEdit');
const ResumeAgent = lazyPage(() => import('./resume-agent.js'), 'ResumeAgent');

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
  'Follow-up',
  'Real jobs & applications',
];
type Tab =
  | 'missions'
  | 'profile'
  | 'approved-profile'
  | 'approvals'
  | 'library'
  | 'activity'
  | 'character'
  | 'home'
  | 'world'
  | 'season'
  | 'coach'
  | 'scout'
  | 'party';

const realmCodes = ['au', 'nz', 'gb', 'us', 'ca', 'sg', 'de', 'fr'];
const savedRealm = () => {
  try {
    const v = localStorage.getItem('cf-realm');
    return v && realmCodes.includes(v) ? v : null;
  } catch {
    return null;
  }
};

const readWorkspaceRoute = () => {
  const query = new URLSearchParams(window.location.search);
  const validTabs = [
    'missions',
    'profile',
    'approved-profile',
    'approvals',
    'library',
    'activity',
    'character',
    'home',
    'party',
    'world',
    'season',
    'scout',
    'coach',
  ];
  const fallback = 'home';
  const value = query.get('view') || fallback;
  const step = query.has('step') ? Number(query.get('step')) : null;
  return {
    tab: (validTabs.includes(value) ? value : fallback) as Tab,
    selected: query.get('mission'),
    phase: step !== null && Number.isInteger(step) && step >= 0 && step <= 9 ? step : null,
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
    [directions, setDirections] = useState<{ text: string; reason: string }[]>([]),
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

  // Coach directions for this profile version, offered as goals when the Find roles form opens.
  useEffect(() => {
    if (!creating || !session?.user) return;
    api('/coach')
      .then((c) =>
        setDirections(
          Array.isArray(c?.analysis?.directions) ? c.analysis.directions.map(adviceItem) : [],
        ),
      )
      .catch(() => setDirections([]));
  }, [creating]);

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
          setJobSearch({
            ...defaultJobSearch,
            ...s.recruitment.defaults,
            // The realm chosen on the World map is a per-viewer default for new quests.
            ...(savedRealm() ? { country: savedRealm() } : {}),
          });
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
  useEffect(() => {
    if (interviewHandoff.current !== mission?.id || mission?.status !== 'AWAITING_INTERVIEW')
      return;
    interviewHandoff.current = null;
    setNotice('Your resume is saved. Your interview questions are ready.');
    document.getElementById('interview-practice')?.scrollIntoView({ block: 'start' });
  }, [mission?.id, mission?.status]);

  // A finished run replaces the step notice, so "questions are ready" never sits above a
  // completed practice.
  const noticeRun = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    const previous = noticeRun.current;
    noticeRun.current = mission ? { id: mission.id, status: mission.status } : null;
    if (!mission || !previous || previous.id !== mission.id) return;
    if (previous.status !== mission.status && mission.status === 'COMPLETE')
      setNotice(
        mission.data?.feedback
          ? 'Practice finished. Your feedback and next steps are below.'
          : 'This run is finished. Your next steps are below.',
      );
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
          : mission.status === 'AWAITING_EVIDENCE'
            ? 'Your resume team has a question about skills the role requires.'
            : mission.status === 'AWAITING_APPROVAL'
            ? 'Your resume is ready. Review the changes before saving.'
            : mission.status === 'AWAITING_INTERVIEW'
              ? 'Your interview is ready. Practise your first answer.'
              : 'Your results are ready.',
      );
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else if (mission.status === 'AWAITING_EVIDENCE' && phase === next) {
      // The question appears on the Review step the user is already on; replace "Preparing…".
      setNotice('Your resume team has a question about skills the role requires.');
    }
  }, [mission?.id, mission?.status, phase, tab]);

  // A finished run adds cost history, so start buttons show the updated estimate (CFS-124).
  const finishedRuns = (workspace?.missions || []).filter((m: any) => m.status === 'COMPLETE').length;
  useEffect(() => {
    if (finishedRuns) reloadEstimates();
  }, [finishedRuns]);

  const approvals =
    workspace?.missions.filter((m: any) =>
      ['AWAITING_JOB', 'AWAITING_EVIDENCE', 'AWAITING_APPROVAL'].includes(m.status),
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
  const progress = progressFrom(workspace);
  // Top-bar navigation: each id maps to a workspace tab, mission phase and selection.
  const questNavActive: QuestNavId | null =
    tab === 'missions'
      ? phase === 2
        ? 'jobs'
        : phase === 7
          ? 'applications'
          : 'quests'
      : tab === 'profile'
        ? 'approved-profile'
        : (tab as QuestNavId);
  const goQuest = (id: QuestNavId) => {
    setError('');
    if (id === 'jobs') {
      if (!workspace?.profile) {
        setTab('profile');
        setSelected(null);
        setPhase(0);
        return;
      }
      const candidate = mission || workspace?.missions[0];
      const live =
        candidate &&
        [
          'QUEUED',
          'RUNNING',
          'AWAITING_JOB',
          'AWAITING_EVIDENCE',
          'AWAITING_APPROVAL',
          'AWAITING_INTERVIEW',
        ].includes(candidate.status);
      if (live) {
        setSelected(candidate.id);
        setTab('missions');
        setPhase(candidate.data?.matches?.length ? 2 : nextMissionStep(candidate));
      } else setCreating(true);
      return;
    }
    if (id === 'applications') {
      setTab('missions');
      setPhase(7);
      setSelected(
        workspace?.missions.find((m: any) => m.data?.approvedResumeId)?.id ||
          workspace?.missions[0]?.id ||
          null,
      );
      return;
    }
    setTab(id === 'quests' ? 'missions' : (id as Tab));
    setSelected(null);
    setPhase(null);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };
  const renderProfile = (mode: 'build' | 'edit') => (
    <Profile
      mode={mode}
      initialPrompt={mode === 'edit' ? agentPrompt : null}
      key={mode}
      profile={workspace?.profile}
      userName={session.user.name}
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
  return (
    <div className="shell agent-app quest">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      {
        <QuestTopBar
          active={questNavActive}
          userName={session.user.name}
          level={progress.level}
          xp={progress.xp}
          waiting={approvals.length}
          fixture={session.mode === 'fixture'}
          onNavigate={goQuest}
          onSignOut={() =>
            void act(async () => {
              await api('/logout', 'POST', {});
              csrf = '';
              setSession({ ...session, user: null });
              setWorkspace(null);
            })
          }
        />
      }
      <div className="content">
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
          ) : tab === 'home' ? (
            <QuestHome
              workspace={workspace}
              coach={
                workspace?.profile && (
                  <QuestCoach
                    request={api}
                    boardKey={(workspace?.applications || [])
                      .map((a: any) => a.id + a.stage)
                      .join()}
                    onFind={() => setCreating(true)}
                    onTailor={(applicationId) =>
                      void act(async () => {
                        const run = await api(`/applications/${applicationId}/runs`, 'POST');
                        setSelected(run.id);
                        setTab('missions');
                        setPhase(3);
                        setNotice('Your resume team is tailoring a resume for this role…');
                      })
                    }
                    onQuests={() => goQuest('quests')}
                    onProfile={() => goQuest('approved-profile')}
                    onOpen={() => goQuest('coach')}
                  />
                )
              }
              userName={session.user.name}
              onOpenMission={(id, step) => {
                setSelected(id);
                setTab('missions');
                setPhase(step);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
              onNewQuest={() => goQuest('jobs')}
              onBuildProfile={() => setTab('profile')}
              onNavigate={goQuest}
            />
          ) : tab === 'world' ? (
            <QuestWorld
              workspace={workspace}
              request={api}
              realm={jobSearch.country}
              onTravel={(country) => {
                setJobSearch((j: any) => ({ ...j, country, region: '', location: '' }));
                try {
                  localStorage.setItem('cf-realm', country);
                } catch {}
                setNotice('Realm changed. Your next quest searches there.');
              }}
              onNewQuest={() => (workspace?.profile ? setCreating(true) : setTab('profile'))}
              onSeason={() => goQuest('season')}
            />
          ) : tab === 'coach' ? (
            <CoachPage
              request={api}
              onProfile={() => goQuest('approved-profile')}
            />
          ) : tab === 'season' ? (
            <QuestSeason
              workspace={workspace}
              realm={jobSearch.country}
              onNavigate={goQuest}
              onOpenMission={(id, step) => {
                setSelected(id);
                setTab('missions');
                setPhase(step);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
            />
          ) : tab === 'scout' ? (
            <QuestScout
              hasProfile={Boolean(workspace?.profile)}
              request={api}
              onBuildProfile={() => setTab('profile')}
              onChanged={() => void refresh()}
              onOpenMission={(id, step) => {
                setSelected(id);
                setTab('missions');
                setPhase(step);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
            />
          ) : tab === 'party' ? (
            <PartyRoster workspace={workspace} userName={session.user.name} />
          ) : tab === 'character' ? (
            <CharacterSheet
              workspace={workspace}
              request={api}
              onProfileChanged={() => void refresh()}
              userName={session.user.name}
              onBuildProfile={() => setTab('profile')}
              onOpenMission={(id) => {
                setSelected(id);
                setTab('missions');
                setPhase(1);
              }}
            />
          ) : tab === 'profile' ? (
            renderProfile('build')
          ) : tab === 'missions' ? (
            <>
              {mission ? (
                <MissionDetail
                  userName={session.user.name}
                  board={workspace?.applications}
                  onOpenMission={(id) =>
                    void act(async () => {
                      const latest = (await refresh()).missions.find((x: any) => x.id === id);
                      setSelected(id);
                      setPhase(
                        latest && latest.status !== 'COMPLETE' ? nextMissionStep(latest) : null,
                      );
                      window.scrollTo({ top: 0, behavior: 'auto' });
                    })
                  }
                  key={mission.id}
                  mission={mission}
                  phase={phase}
                  onNavigate={setPhase}
                  onPractise={(applicationId) =>
                    void act(async () => {
                      const run = await api(`/applications/${applicationId}/practice`, 'POST');
                      setSelected(run.id);
                      setPhase(4);
                      setNotice('Your interview panel is preparing questions for this role…');
                    })
                  }
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
                      if (kind === 'saved-roles')
                        setNotice(
                          'Saved to your quests. Tailor a resume for it from the Quest log.',
                        );
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
                      Find roles with your approved profile. Your party shares the same reviewed
                      evidence and the role you choose.
                    </p>
                    <button className="primary" onClick={() => setCreating(true)}>
                      Find roles
                    </button>
                  </section>
                </>
              ) : (
                <QuestLog
                  workspace={workspace}
                  busy={busy}
                  onTailor={(applicationId) =>
                    void act(async () => {
                      const run = await api(`/applications/${applicationId}/runs`, 'POST');
                      setSelected(run.id);
                      setPhase(3);
                      setNotice('Your resume team is tailoring a resume for this role…');
                    })
                  }
                  onStatus={(applicationId, status) =>
                    void act(async () => {
                      await api(`/applications/${applicationId}`, 'PATCH', { status });
                    })
                  }
                  onPractice={(applicationId) =>
                    void act(async () => {
                      const run = await api(`/applications/${applicationId}/practice`, 'POST');
                      setSelected(run.id);
                      setPhase(4);
                      setNotice('Your interview panel is preparing questions for this role…');
                    })
                  }
                  onRemove={(applicationId) =>
                    void act(async () => {
                      await api(`/applications/${applicationId}`, 'DELETE');
                      setNotice('Role removed from your quests.');
                    })
                  }
                  onRecheck={() =>
                    void act(async () => {
                      const r = await api('/applications/recheck', 'POST');
                      setNotice(
                        r.checked
                          ? `Checked ${r.checked} listing${r.checked === 1 ? '' : 's'}: ${r.closed} closed, ${r.flagged} applied role${r.flagged === 1 ? '' : 's'} flagged.`
                          : 'Every listing was checked in the last day.',
                      );
                    })
                  }
                  onAdd={async (body) => {
                    let ok = false;
                    await act(async () => {
                      await api('/applications', 'POST', body);
                      ok = true;
                      setNotice('Role added to your quests. Tailor a resume when you are ready.');
                    });
                    return ok;
                  }}
                  onOpen={(m, targetPhase) => {
                    setSelected(m.id);
                    setPhase(targetPhase);
                    window.scrollTo({ top: 0, behavior: 'auto' });
                  }}
                  onNewQuest={() => setCreating(true)}
                  onBuildProfile={() => {
                    setTab('profile');
                    setPhase(0);
                  }}
                />
              )}
            </>
          ) : tab === 'approvals' ? (
            <>
              <PageTitle
                eyebrow="YOUR DECISIONS, ALWAYS"
                title="Approval inbox"
                text="Review the important moments. Your agents will wait for your decision."
              />
              {workspace?.missions[0]?.status === 'COMPLETE' && approvals.length > 0 && (
                <div className="inbox-context" role="note">
                  <p>
                    Your latest journey is complete. The decisions below belong to earlier journeys.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setTab('missions');
                      setSelected(workspace.missions[0].id);
                      setPhase(null);
                    }}
                  >
                    View latest journey results <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {approvals.length ? (
                approvals.map((m: any) => (
                  <article className="approval-card" key={m.id}>
                    <FileCheck2 size={24} />
                    <div className="approval-details">
                      <span className="muted">
                        {m.id === workspace?.missions[0]?.id ? 'Latest journey' : 'Earlier journey'}{' '}
                        · Started {date(m.createdAt)}
                      </span>
                      <h3>{m.data?.selectedJob?.job?.title || m.goal}</h3>
                      {m.data?.selectedJob?.job?.company && <p>{m.data.selectedJob.job.company}</p>}
                      <strong>
                        {m.status === 'AWAITING_JOB'
                          ? 'Choose a target opportunity'
                          : m.status === 'AWAITING_EVIDENCE'
                            ? 'Answer the evidence question'
                            : 'Review your resume draft'}
                      </strong>
                      <div className="approval-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const current = await refresh();
                              const latest = current.missions.find((item: any) => item.id === m.id);
                              if (!latest) return;
                              setTab('missions');
                              setSelected(latest.id);
                              setPhase(
                                latest.status === 'COMPLETE' ? null : nextMissionStep(latest),
                              );
                              setNotice(
                                latest.status === 'COMPLETE'
                                  ? 'This journey is complete. Showing its saved results.'
                                  : `Opened journey: ${latest.goal}`,
                              );
                            })
                          }
                        >
                          Open journey <ArrowRight size={16} />
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api(`/missions/${m.id}/cancel`, 'POST', {});
                              setNotice('Journey cancelled. Its saved history is still available.');
                            })
                          }
                        >
                          Cancel this journey
                        </button>
                      </div>
                    </div>
                  </article>
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
                text="See completed actions, tool use and the decisions that moved your runs forward."
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
                  <p>Find roles to see your party in action.</p>
                </div>
              )}
            </>
          )}
        </main>
        <footer>
          CareerFlow AI{' '}
          <span>Technical roles across regions, matched to evidence you approve.</span>
        </footer>
      </div>
      {creating && (
        <div className="modal-backdrop">
          <section
            className="modal quest-form"
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
              aria-label="Close Find roles form"
              onClick={() => setCreating(false)}
            >
              <X />
            </button>
            <span className="eyebrow">SEND THE PARTY OUT</span>
            <h2 id="mission-title">What’s your next career goal?</h2>
            <p>
              The Coach reads your approved profile and the Job Matcher ranks roles against it. You
              choose one to tailor a resume for, and can save others to your quests for later.
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
            {directions.length > 0 && (
              <div className="coach-directions">
                <span className="small muted">The Coach suggests:</span>
                {directions.slice(0, 3).map((d) => (
                  <button
                    key={d.text}
                    type="button"
                    className="text-button"
                    title={d.reason}
                    onClick={() => setGoal(d.text)}
                  >
                    Use as goal: {d.text.length > 90 ? d.text.slice(0, 87) + '…' : d.text}
                  </button>
                ))}
              </div>
            )}
            <JobSearchFields
              value={jobSearch}
              onChange={setJobSearch}
              adzunaConfigured={session?.recruitment?.adzunaConfigured}
              tavilyConfigured={session?.recruitment?.tavilyConfigured}
              tavilyAccessMode={session?.recruitment?.tavilyAccessMode}
              internalFixtures={session?.mode === 'fixture'}
            />
            <label>
              Minimum match: {minScore}/100
              <small className="muted">Roles scoring below this stay off the shortlist.</small>
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
                You choose the role and approve the exact resume before it is saved.{' '}
                {session?.mode === 'fixture'
                  ? 'Rehearsal mode: demo answers, no model cost.'
                  : `Each run has a ${MISSION_MODEL_CALL_LIMIT}-call budget.`}{' '}
                {session?.mode !== 'fixture' && <RunEstimate kind="search" className="" />}
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
                {busy ? 'Sending…' : 'Send the party out'}
                <ArrowRight size={17} />
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Login({ error, onLogin }: { session: any; error: string; onLogin: (s: any) => void }) {
  return (
    <SignIn
      error={error}
      onSubmit={async (path, body) => onLogin(await api('/auth/' + path, 'POST', body))}
    />
  );
}

function PageTitle({ title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
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
  busy,
  onDraft,
  onApprove,
  onDiscard,
  onMission,
}: {
  mode?: 'build' | 'edit';
  initialPrompt?: { id: string; text: string; label: string } | null;
  profile: any;
  onMission: () => void;
  onLibrary: () => void;
  userName: string;
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
  }, [profile?.version]);
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
  }, [profile?.id]);
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
              <details className="optional-import" open={!profile}>
                <summary>Start from your resume</summary>
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
              <div ref={setPreviewTarget} />
              <details className="manual-profile-editor">
                <summary>Edit profile details manually</summary>
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
                Your party uses approved profile facts in every run. Profile changes and resume
                versions still require your approval.
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
  board,
  phase,
  onNavigate,
  onNewSearch,
  onPractise,
  busy,
  onBack,
  onAction,
  onSaveAnswer,
  onRefineAnalysis,
  onOpenMission,
  userName = 'You',
}: {
  userName?: string;
  board?: any[];
  onOpenMission: (id: string) => void;
  mission: any;
  phase: number | null;
  onNavigate: (phase: number | null) => void;
  onNewSearch: () => void;
  /** Start interview practice for this run's role without waiting for the resume (CFS-134). */
  onPractise?: (applicationId: string) => void;
  busy: boolean;
  onBack: () => void;
  onAction: (kind: string, body?: unknown) => Promise<void>;
  onSaveAnswer: (a: unknown) => Promise<void>;
  onRefineAnalysis: (feedback: string) => Promise<void>;
}) {
  // Profile and advice are workspace pages now; old links to those steps open the first run step.
  phase = runPhase(m, phase);
  const d = m.data,
    [answer, setAnswer] = useState(''),
    [jobURL, setJobURL] = useState(''),
    [question, setQuestion] = useState(0),
    [analysisFeedback, setAnalysisFeedback] = useState(''),
    [manualDirty, setManualDirty] = useState(false),
    [confirm, setConfirm] = useState(false),
    [compareIds, setCompareIds] = useState<string[]>([]),
    [viewJobId, setViewJobId] = useState('');
  const questions = d.questions || [],
    q = questions[question],
    responseCount = d.answers?.length || 0,
    budgetExhausted = (d.apiCalls || 0) >= MISSION_MODEL_CALL_LIMIT,
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

  const completed = m.status === 'COMPLETE';
  if (completed && (phase === null || (phase > 4 && phase !== 8 && phase !== 9)))
    return (
      <section aria-label="Completed journey results">
        <QuestMissionHeader mission={m} phase={phase} onBack={onBack} onSelect={onNavigate} />
        <div className="page-heading">
          <div>
            <span className="eyebrow">QUEST COMPLETE</span>
            <h2>{d.approvedResumeId ? 'Ready to apply' : 'Practice finished'}</h2>
          </div>
          <button className="secondary" onClick={onBack}>
            Open quest log <ArrowRight size={16} />
          </button>
        </div>
        <section className="panel" aria-label="What to do next">
          <h2>What to do next</h2>
          <ol className="next-steps">
            {d.approvedResumeId && (
              <li>
                <strong>Download your tailored resume.</strong>
                <ResumeDownloads id={d.approvedResumeId} />
                <button className="text-button" onClick={() => onNavigate(3)}>
                  View approved resume
                </button>
              </li>
            )}
            {d.selectedJob?.job.url && (
              <li>
                <strong>Apply on the employer’s site.</strong> CareerFlow never applies for you.{' '}
                <a href={d.selectedJob.job.url} target="_blank" rel="noreferrer">
                  Open the listing
                </a>
              </li>
            )}
            <li>
              <strong>Mark it applied in your quest log</strong> once you have sent it.
            </li>
            {m.applicationId && onPractise && (
              <li>
                <strong>Practise again</strong> with new questions for this role.{' '}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => onPractise(m.applicationId)}
                >
                  Start a practice run
                </button>
              </li>
            )}
            {responseCount > 0 && (
              <li>
                <button className="text-button" onClick={() => onNavigate(4)}>
                  Review your interview answers
                </button>
              </li>
            )}
          </ol>
          <small className="muted">This run is saved as it was.</small>
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
      {<QuestMissionHeader mission={m} phase={phase} onBack={onBack} onSelect={onNavigate} />}
      {completed && (
        <div className="info" role="note">
          <span>Finished run · saved as it was</span>
          <button className="text-button" onClick={() => onNavigate(null)}>
            What to do next
          </button>
          <button className="secondary" onClick={onBack}>
            Open quest log
          </button>
        </div>
      )}
      {phase === 8 && <QuestBattleLog mission={m} userName={userName} request={api} />}
      {phase === 9 && <QuestSavePoints mission={m} request={api} onOpenMission={onOpenMission} />}
      {phase === 2 && ['AWAITING_JOB', 'NO_MATCHES'].includes(m.status) && !d.selectedJob && (
        <QuestAddLink>
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
        </QuestAddLink>
      )}
      {phase === 2 && !completed && !d.selectedJob && (
        <button className={!d.matches?.length ? 'primary' : 'secondary'} onClick={onNewSearch}>
          {!d.matches?.length ? 'Search Australian jobs' : 'Run a new search'}
        </button>
      )}
      {phase === 2 && d.selectedJob && !completed && (
        <section className="quest-tile rc-next" aria-label="Next for this role">
          <div>
            <span className="quest-sub dark">NEXT FOR THIS ROLE</span>
            <p>
              {d.approvedResumeId
                ? 'Your resume for this role is approved.'
                : d.resumeDraft
                  ? 'Your tailored resume is ready to review.'
                  : m.status === 'AWAITING_EVIDENCE'
                    ? 'The resume team has one question for you first.'
                    : 'The resume team is tailoring your resume.'}
            </p>
          </div>
          <div className="rc-next-actions">
            <button className="quest-press lime" onClick={() => onNavigate(3)}>
              {d.resumeDraft && !d.approvedResumeId ? 'Review the resume' : 'Open the resume'}{' '}
              <ArrowRight size={15} />
            </button>
            {m.applicationId && onPractise && !d.practiceOnly && (
              <button
                className="quest-press"
                disabled={busy}
                onClick={() => onPractise(m.applicationId)}
              >
                Practise the interview now
              </button>
            )}
          </div>
        </section>
      )}
      {m.error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>
            {budgetExhausted && m.status === 'FAILED'
              ? 'This run has reached its AI usage limit. Find roles again or tailor the role again from the Quest log. Your saved results are still available.'
              : m.error}
          </span>
        </div>
      )}
      <div className="mission-actions">
        {m.status === 'FAILED' && budgetExhausted && (
          <button className="primary" disabled={busy} onClick={onNewSearch}>
            Find roles again
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
            {d.apiCalls || 0} / {MISSION_MODEL_CALL_LIMIT} model calls ·{' '}
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
        ((phase === 2 && !d.matches?.length && m.status !== 'NO_MATCHES') ||
          (phase === 3 && !d.resumeDraft && m.status !== 'AWAITING_EVIDENCE') ||
          (phase === 4 && !questions.length) ||
          (phase === 7 && (!d.selectedJob?.job?.applicationUrl || !d.approvedResumeId))) && (
          <section className="panel stage-prerequisite">
            <h2>{isWorking ? 'Preparing this step' : 'Before you start'}</h2>
            <p>
              {phase === 3
                ? d.selectedJob
                  ? `Target: ${d.selectedJob.job.title}. ${isWorking ? 'Your resume is being prepared.' : 'Your resume is not ready yet. Continue after resolving the run status above.'}`
                  : 'Target: Select a target in Job matching first.'
                : phase === 4
                  ? d.approvedResumeId
                    ? isWorking
                      ? 'Your approved resume is saved. Interview questions are being prepared.'
                      : 'Your approved resume is saved. Continue after resolving the run status above.'
                    : 'Approve your evidence-based resume before starting interview practice.'
                  : phase === 7
                    ? d.selectedJob && d.approvedResumeId
                      ? 'This role has no application link, so there is nothing to apply to. Demo roles never have one; choose a live or pasted listing to prepare an application.'
                      : 'Select a real target job and approve your resume before preparing an application.'
                    : isWorking
                      ? 'Your career team is preparing this step. Results are saved with this run.'
                      : 'This step has no results yet. Check the run status above to continue.'}
            </p>
            {(phase === 3 || phase === 7) && (
              <>
                {runRoute(m).some((s) => s.phase === 2) && (
                  <button className="secondary" onClick={() => onNavigate(2)}>
                    Go to the Shortlist
                  </button>
                )}
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
                Go to the Review
              </button>
            )}
          </section>
        )}
      <div id="career-analysis" />
      {phase === null && d.analysis && (
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
              {d.jobRetrieval.llmReviewed != null &&
                `${d.jobRetrieval.llmReviewed} shortlisted jobs reviewed by LLM; ${d.jobRetrieval.notLlmReviewed} not reviewed. `}
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
          <section id="job-matching" className="qj-section">
            {d.selectedJob && (
              <div className="section-heading">
                <h2>
                  {d.selectedJob ? 'Your chosen role' : 'Opportunities that fit your direction'}
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
            )}
            <div className={d.selectedJob ? undefined : 'qj-layout'}>
              {!d.selectedJob && (
                <QuestJobTable
                  matches={d.matches}
                  stageOf={(r) => boardStage(board, r)}
                  selectedId={viewJobId || d.matches[0]?.job.id}
                  compareIds={compareIds}
                  sourceLabel={
                    d.jobRetrieval?.source === 'fixtures'
                      ? 'sample jobs'
                      : d.jobRetrieval?.source === 'manual'
                        ? 'pasted listing'
                        : 'live source snapshots'
                  }
                  onSelect={setViewJobId}
                />
              )}
              <div className="jobs-grid">
                {(d.selectedJob
                  ? [d.selectedJob]
                  : [d.matches.find((r: any) => r.job.id === viewJobId) || d.matches[0]]
                ).map((r: any) => (
                  <RoleCard
                    key={r.job.id}
                    r={r}
                    evidence={
                      d.selectedJob ? <JobFit key={m.id} missionId={m.id} api={api} /> : undefined
                    }
                    source={
                      !completed ? (
                        <JobSourceActions job={r.job} missionId={m.id} request={api} />
                      ) : undefined
                    }
                    actions={
                      m.status === 'AWAITING_JOB' ? (
                      <>
                        <button
                          className="secondary full"
                          disabled={busy}
                          onClick={() =>
                            void onAction('decisions', { kind: 'job', jobId: r.job.id })
                          }
                        >
                          Select this opportunity
                          <ArrowRight size={15} />
                        </button>
                        {boardStage(board, r) ? (
                          <span className="quest-chip lime">
                            In your quests · {stageCopy[boardStage(board, r)!]?.label}
                          </span>
                        ) : (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void onAction('saved-roles', { jobId: r.job.id })}
                          >
                            Save to my quests for later
                          </button>
                        )}
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
                                          ) : undefined
                    }
                  />
                ))}
              </div>
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
      {(phase === null || phase === 3) &&
        m.status === 'AWAITING_EVIDENCE' &&
        d.evidenceQuestion?.skills?.length > 0 && (
          <EvidenceQuestion
            question={d.evidenceQuestion}
            busy={busy}
            onSubmit={(answers) => void onAction('decisions', { kind: 'evidence', answers })}
          />
        )}
      {(phase === null || phase === 3) && d.resumeDraft && (
        <section id="resume-tailoring" className="panel resume">
          {d.resumeTeam && (
            <PartyTrack team={d.resumeTeam} waiting={m.status === 'AWAITING_APPROVAL'} />
          )}
          {m.status === 'AWAITING_APPROVAL' && !d.resumeTeam && (
            <div className="approval-controls resume-approval-bar">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirm && !manualDirty}
                  disabled={busy || manualDirty}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I reviewed this resume and am ready to save it.
              </label>
              <button
                className="primary"
                disabled={!confirm || busy || manualDirty}
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
                busy={busy || manualDirty}
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
              {d.selectedJob?.gaps?.length > 0 && !d.resumeTeam && (
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
              {d.resumeTeam && (
                <PartyDecision
                  team={d.resumeTeam}
                  userName={userName}
                  waiting={m.status === 'AWAITING_APPROVAL'}
                  busy={busy}
                  approveBlocked={manualDirty}
                  revisions={d.revisions || 0}
                  onApprove={() =>
                    onAction('decisions', {
                      kind: 'resume',
                      decision: 'approve',
                      draftHash: d.resumeDraft.hash,
                    })
                  }
                  onReturn={(target, feedback) =>
                    onAction('decisions', {
                      kind: 'resume',
                      decision: 'reject',
                      draftHash: d.resumeDraft.hash,
                      target,
                      feedback,
                    })
                  }
                />
              )}
              {(!d.resumeTeam || d.approvedResumeId) && (
                <div className="section-heading">
                  <h2>
                    {completed
                      ? 'Saved resume'
                      : d.approvedResumeId
                        ? 'Approved resume'
                        : 'Edit with your agent'}
                  </h2>
                  <span className="tag">
                    {d.approvedResumeId ? 'Approved & saved' : 'Review required'}
                  </span>
                </div>
              )}
              <QuestEditDrawer quest={!!d.resumeTeam && m.status === 'AWAITING_APPROVAL'}>
                {m.status === 'AWAITING_APPROVAL' && (
                  <ResumeManualEdit
                    draft={d.resumeDraft}
                    busy={busy}
                    onDirty={(dirty) => {
                      setManualDirty(dirty);
                      if (dirty) setConfirm(false);
                    }}
                    onSave={(factId, text) =>
                      onAction('resume-agent/manual', {
                        draftHash: d.resumeDraft.hash,
                        factId,
                        text,
                      })
                    }
                  />
                )}
                {m.status === 'AWAITING_APPROVAL' && (
                  <ResumeAgent
                    draft={d.resumeDraft}
                    messages={d.resumeChat || []}
                    busy={busy || manualDirty}
                    onEdit={(message) =>
                      onAction('resume-agent', { draftHash: d.resumeDraft.hash, message })
                    }
                  />
                )}
              </QuestEditDrawer>
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

      {phase === 4 && questions.length > 0 && (
        <QuestBossBattle
          mission={m}
          busy={busy}
          onRound={(body) => onAction('interview/rounds', body)}
          onFinish={(endedEarly) => onAction('decisions', { kind: 'interview', endedEarly })}
          voiceStatus={m.mode === 'fixture' ? undefined : () => api('/voice/status')}
          startVoice={
            m.mode === 'fixture' ? undefined : () => api(`/missions/${m.id}/voice-session`, 'POST')
          }
          transcribe={
            m.mode === 'fixture'
              ? undefined
              : async (audio) => {
                  const r = await fetch(`/api/missions/${m.id}/transcribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': audio.type || 'audio/webm', 'X-CSRF-Token': csrf },
                    body: audio,
                  });
                  const body = await r.json();
                  if (!r.ok) throw Error(body.error || 'Transcription failed.');
                  return String(body.text || '');
                }
          }
        />
      )}
      {(phase === null || phase === 4) &&
        questions.length > 0 &&
        (phase === null || d.feedback) && (
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
                Role-specific practice for {d.selectedJob?.job.title}. Your answers stay separate
                from approved candidate facts.
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
                        {d.answers?.some((a: any) => a.questionId === item.id) && (
                          <Check size={13} />
                        )}
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
                  {d.endedEarly
                    ? 'You finished early; feedback reflects the available answers.'
                    : ''}
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
              {d.feedback && (
                <>
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
                  <ReadAloud
                    label="Read the feedback aloud"
                    text={[
                      'Strengths.',
                      ...(d.feedback.strengths || []),
                      'Areas to improve.',
                      ...(d.feedback.improvements || []),
                      'Next practice.',
                      ...(d.feedback.nextSteps || []),
                    ].join(' ')}
                  />
                </>
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

/** In the Quest UI, adding a job by link is a secondary action folded under the header. */
function QuestAddLink({ children }: { children: React.ReactNode }) {
  return (
    <details className="quest-edit-drawer qj-add">
      <summary>
        <span>Add a job from a link</span>
        <small>Paste a public listing. You still review its gaps before choosing it.</small>
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** In the Quest UI, hand edits sit behind a drawer so the Critic report and decision lead. */
function QuestEditDrawer({ quest, children }: { quest: boolean; children: React.ReactNode }) {
  if (!quest) return <>{children}</>;
  return (
    <details className="quest-edit-drawer">
      <summary>
        <span>Edit it yourself</span>
        <small>
          Change a line by hand or ask the resume agent. Edits are re-checked against your facts.
        </small>
      </summary>
      <div>{children}</div>
    </details>
  );
}

function ResumeDownloads({ id }: { id: string }) {
  return (
    <>
      <span className="form-actions">
        <a className="secondary" href={`/api/resumes/${id}/download?format=docx`}>
          Download DOCX
        </a>
        <a className="secondary" href={`/api/resumes/${id}/download?format=pdf`}>
          Download PDF
        </a>
      </span>
    </>
  );
}
