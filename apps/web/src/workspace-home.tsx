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
  if (m.status === 'AWAITING_JOB' || m.data?.matches?.length || m.status === 'NO_MATCHES') return 2;
  return 1;
}

const actionText: Record<string, string> = {
  AWAITING_JOB: 'Choose a job',
  AWAITING_APPROVAL: 'Review your resume',
  AWAITING_INTERVIEW: 'Practise your interview',
  COMPLETE: 'View interview feedback',
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
  onSearch: () => void;
  onOpen: (m: any, phase?: number) => void;
  onLibrary: () => void;
}) {
  const missions = workspace?.missions || [];
  const current =
    missions.find((m: any) => m.status.startsWith('AWAITING')) ||
    missions.find((m: any) => ['RUNNING', 'QUEUED', 'FAILED'].includes(m.status)) ||
    missions[0];
  const hasProfile = !!workspace?.profile;
  const steps = [
    {
      title: 'Your profile',
      text: 'Build and approve your experience.',
      icon: Layers,
      done: hasProfile,
      go: onProfile,
    },
    {
      title: 'Find a job',
      text: 'Explore ranked jobs and choose a role.',
      icon: BriefcaseBusiness,
      done: !!current?.data?.selectedJob,
      go: current ? () => onOpen(current, 2) : hasProfile ? onSearch : onProfile,
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
      ? actionText[current.status] || 'View progress'
      : 'Find matching jobs';
  return (
    <div className="workspace-home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1>Your next career step</h1>
          <p>Build your profile, find a role and prepare your application.</p>
        </div>
        <button className="secondary" onClick={hasProfile ? onSearch : onProfile}>
          New career mission <ArrowRight size={16} />
        </button>
      </div>
      <section className="next-action" aria-labelledby="next-action-title">
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
              Approved profile v{workspace.profile.version} · {workspace.resumes?.length || 0} saved
              documents
            </span>
          )}
        </div>
        <button
          className="primary"
          onClick={!hasProfile ? onProfile : current ? () => onOpen(current) : onSearch}
        >
          {nextLabel}
          <ArrowRight size={17} />
        </button>
      </section>
      <section className="journey-overview" aria-label="Application steps">
        {steps.map((s, i) => (
          <button key={s.title} onClick={s.go}>
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
      <section aria-labelledby="recent-searches-title">
        <div className="section-heading">
          <h2 id="recent-searches-title">
            Your missions <span>{missions.length}</span>
          </h2>
          <button className="text-button" onClick={onLibrary}>
            Saved documents <ArrowRight size={15} />
          </button>
        </div>
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
                  {actionText[m.status] || 'View progress'} <ArrowRight size={16} />
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
