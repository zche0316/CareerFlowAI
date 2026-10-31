import React from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  FileCheck2,
  Layers,
  MessageSquare,
} from 'lucide-react';

export function nextMissionStep(m: any): number {
  if (m.status === 'COMPLETE') return 4;
  if (m.status === 'AWAITING_APPROVAL' || (m.data?.resumeDraft && !m.data?.approvedResumeId))
    return 3;
  if (m.status === 'AWAITING_INTERVIEW' || m.data?.approvedResumeId) return 4;
  if (m.data?.selectedJob) return 3;
  if (m.status === 'AWAITING_JOB' || m.data?.matches?.length || m.status === 'NO_MATCHES') return 2;
  return 1;
}

const actionText: Record<string, string> = {
  AWAITING_JOB: 'Choose a job',
  AWAITING_APPROVAL: 'Review your resume',
  AWAITING_INTERVIEW: 'Practise your interview',
  COMPLETE: 'Review journey results',
  FAILED: 'Review and retry',
  STALE: 'Review previous search',
  NO_MATCHES: 'Review search results',
  CANCELLED: 'View previous search',
};

export function WorkspaceHome({
  workspace,
  onProfile,
  onSearch,
  onOpen,
  onLibrary,
}: {
  workspace: any;
  onProfile: () => void;
  onSearch: (goal?: string) => void;
  onOpen: (m: any, phase?: number) => void;
  onLibrary: () => void;
}) {
  const missions = workspace?.missions || [];
  const current = missions[0];
  const hasProfile = !!workspace?.profile;
  const steps = [
    {
      title: 'Your profile',
      text: 'Build and approve your experience.',
      icon: Layers,
      done: hasProfile,
      go: current ? () => onOpen(current, 0) : onProfile,
    },
    {
      title: 'Career analysis',
      text: 'Explore your strengths and direction.',
      icon: Layers,
      done: !!current?.data?.analysis,
      go: current ? () => onOpen(current, 1) : hasProfile ? () => onSearch() : onProfile,
    },
    {
      title: 'Find a job',
      text: 'Explore ranked jobs and choose a role.',
      icon: BriefcaseBusiness,
      done: !!current?.data?.selectedJob,
      go: current ? () => onOpen(current, 2) : hasProfile ? () => onSearch() : onProfile,
    },
    {
      title: 'Your resume',
      text: 'Review, approve and export.',
      icon: FileCheck2,
      done: !!current?.data?.approvedResumeId,
      go: current ? () => onOpen(current, 3) : onLibrary,
    },
    {
      title: 'Interview practice',
      text: 'Practise answers and get feedback.',
      icon: MessageSquare,
      done: !!current?.data?.feedback,
      go: current ? () => onOpen(current, 4) : onProfile,
    },
  ];
  const nextLabel = !hasProfile
    ? 'Build your profile'
    : current
      ? current.status === 'FAILED' && (current.data?.apiCalls || 0) >= 12
        ? 'Review saved results'
        : actionText[current.status] || 'View progress'
      : 'Find matching jobs';
  const firstIncomplete = steps.findIndex((step) => !step.done);
  return (
    <div className="workspace-home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>Your next career step</h1>
          <p>Build your profile, find a role and prepare your application.</p>
        </div>
        <button className="secondary" onClick={hasProfile ? () => onSearch() : onProfile}>
          New career mission <ArrowRight size={16} />
        </button>
      </div>
      <div className="prototype-overview-layout">
        <div className="prototype-overview-main">
          <section className="next-action" aria-labelledby="next-action-title">
            <img className="workspace-hero-art" src="/careerflow-journey.svg" alt="" />
            <div>
              <span className="eyebrow">NEXT STEP</span>
              <h2 id="next-action-title">
                {!hasProfile
                  ? 'Start with your experience'
                  : current
                    ? nextLabel
                    : 'Find the right opportunity'}
              </h2>
              <p>
                {!hasProfile
                  ? 'No resume needed. Tell us about your work, study or projects, then review the profile before using it.'
                  : current
                    ? current.goal
                    : 'Your approved profile is ready. Choose a location and search for matching jobs.'}
              </p>
              {hasProfile && (
                <span className="small muted">
                  Approved profile v{workspace.profile.version} · {workspace.resumes?.length || 0}{' '}
                  saved documents
                </span>
              )}
            </div>
            <button
              className="primary"
              onClick={!hasProfile ? onProfile : current ? () => onOpen(current) : () => onSearch()}
            >
              {nextLabel}
              <ArrowRight size={17} />
            </button>
          </section>
          <div className="journey-title">
            <h2>{current ? 'Latest application journey' : 'Your career journey'}</h2>
            <span>
              {steps.filter((step) => step.done).length} of {steps.length} steps complete
            </span>
          </div>
          <section className="journey-overview" aria-label="Application steps">
            {steps.map((s, i) => (
              <button
                key={s.title}
                onClick={s.go}
                className={s.done ? 'journey-done' : i === firstIncomplete ? 'journey-current' : ''}
              >
                <span className={s.done ? 'step-badge complete' : 'step-badge'}>
                  {s.done ? <Check size={17} /> : i + 1}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.text}</p>
                </div>
              </button>
            ))}
          </section>
        </div>
        <aside className="prototype-overview-side">
          <section className="prototype-side-panel">
            <div className="prototype-side-heading">
              <h2>Application progress</h2>
              <button className="text-button" onClick={onProfile}>
                View profile <ArrowRight size={14} />
              </button>
            </div>
            <p className="progress-scope">
              {current
                ? current.data?.selectedJob?.job.title || current.goal
                : 'Build your profile to start your first application journey.'}
            </p>
            <div className="prototype-progress">
              <div
                className="prototype-progress-ring"
                style={
                  {
                    '--progress': `${(steps.filter((step) => step.done).length / steps.length) * 100}%`,
                  } as React.CSSProperties
                }
              >
                <strong>
                  {Math.round((steps.filter((step) => step.done).length / steps.length) * 100)}%
                </strong>
              </div>
              <div>
                <p>
                  {steps.filter((step) => step.done).length} of {steps.length} steps completed
                </p>
              </div>
            </div>
            <div className="prototype-mini-steps">
              {steps.map((step, i) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={step.go}
                  className={i === firstIncomplete ? 'current' : ''}
                >
                  <span>{step.done ? <Check size={13} /> : i + 1}</span>
                  {step.title}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </section>
          <section className="prototype-side-panel">
            <h2>Career coach</h2>
            <p>Continue the conversation about your career and experience.</p>
            <button className="prototype-coach-link" onClick={onProfile}>
              Open profile conversation <ArrowRight size={16} />
            </button>
          </section>
          <section className="prototype-side-panel">
            <div className="prototype-side-heading">
              <h2>Your profile</h2>
              <button className="text-button" onClick={onProfile}>
                View <ArrowRight size={14} />
              </button>
            </div>
            <div className="prototype-profile-row">
              <span>
                {String(workspace?.profile?.data?.name || 'You')
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <div>
                <strong>{workspace?.profile?.data?.name || 'Your profile'}</strong>
                <p>{workspace?.profile?.data?.location || 'Add your location'}</p>
              </div>
            </div>
            <div className="prototype-skill-list">
              {(workspace?.profile?.data?.skills || []).slice(0, 4).map((skill: string) => (
                <span key={skill}>{skill}</span>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <section aria-labelledby="recent-searches-title">
        <div className="section-heading">
          <h2 id="recent-searches-title">
            Application journeys <span>{missions.length}</span>
          </h2>
          <button className="text-button" onClick={onLibrary}>
            Saved documents <ArrowRight size={15} />
          </button>
        </div>
        <p className="muted small">
          Each journey keeps its own profile snapshot, target job, resume and interview practice.
        </p>
        {missions.length ? (
          <div className="search-list">
            {missions.map((m: any) => (
              <button className="search-row" key={m.id} onClick={() => onOpen(m)}>
                <BriefcaseBusiness size={19} />
                <div>
                  <strong>{m.goal}</strong>
                  <p>
                    {new Date(m.createdAt).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {m.mode === 'fixture' ? 'Demo data' : 'Live AI'}
                    {m.data?.selectedJob ? ` · ${m.data.selectedJob.job.title}` : ''}
                  </p>
                </div>
                <span className="row-action">
                  {m.status === 'FAILED' && (m.data?.apiCalls || 0) >= 12
                    ? 'Review saved results'
                    : actionText[m.status] || 'View progress'}{' '}
                  <ArrowRight size={16} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>Your searches will appear here</h3>
            <p>
              {hasProfile
                ? 'Start a search to see jobs matched to your approved profile.'
                : 'Approve your profile first, then search for jobs.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
