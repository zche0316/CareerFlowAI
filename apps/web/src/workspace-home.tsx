import React, { useState } from 'react';
import { ArrowRight, FileText, UserRound, BriefcaseBusiness } from 'lucide-react';

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
const missionAction = (m: any) =>
  m.status === 'FAILED' && (m.data?.apiCalls || 0) >= 12
    ? 'Review saved results'
    : actionText[m.status] || 'View progress';
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
  const [goal, setGoal] = useState(''),
    [showAll, setShowAll] = useState(false);
  const missions = workspace?.missions || [];
  const current =
    missions.find((m: any) => m.status.startsWith('AWAITING')) ||
    missions.find((m: any) => ['RUNNING', 'QUEUED', 'FAILED'].includes(m.status)) ||
    missions[0];
  const hasProfile = !!workspace?.profile;
  return (
    <div className="workspace-home agent-home">
      <div className="page-heading">
        <div>
          <h1>What’s next for your career?</h1>
          <p>
            {hasProfile
              ? 'Your agent starts with your approved profile.'
              : 'Start with a conversation. No resume needed.'}
          </p>
        </div>
      </div>
      <section className="agent-home-start" aria-label="Start career work">
        {hasProfile ? (
          <>
            <label htmlFor="career-goal">What would you like to work towards?</label>
            <textarea
              id="career-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Find a data analyst role in Sydney…"
              rows={3}
            />
            <div className="agent-home-composer-actions">
              <span>Profile v{workspace.profile.version} attached</span>
              <button className="primary" onClick={() => onSearch(goal || undefined)}>
                New career mission <ArrowRight size={16} />
              </button>
            </div>
          </>
        ) : (
          <button className="primary" onClick={onProfile}>
            Build your profile <ArrowRight size={16} />
          </button>
        )}
      </section>
      <div className="agent-context-links">
        <button onClick={onProfile}>
          <UserRound size={16} />
          {hasProfile ? `Profile v${workspace.profile.version}` : 'Your profile'}
        </button>
        <button onClick={onLibrary}>
          <FileText size={16} />
          {workspace?.resumes?.length || 0} saved documents
        </button>
      </div>
      {current && (
        <section className="agent-continue" aria-label="Continue career work">
          <div>
            <span>Continue</span>
            <h2>{current.data?.selectedJob?.job.title || current.goal}</h2>
            <p>{current.status.toLowerCase().replaceAll('_', ' ')}</p>
          </div>
          <button className="secondary" onClick={() => onOpen(current)}>
            {missionAction(current)}
            <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section aria-labelledby="recent-searches-title" className="agent-history">
        <div className="section-heading">
          <h2 id="recent-searches-title">Recent missions</h2>
          {missions.length > 8 && (
            <button className="text-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show recent' : 'Show all'}
            </button>
          )}
        </div>
        {missions.length ? (
          <div className="search-list">
            {(showAll ? missions : missions.slice(0, 8)).map((m: any) => (
              <button className="search-row" key={m.id} onClick={() => onOpen(m)}>
                <BriefcaseBusiness size={18} />
                <div>
                  <strong>{m.goal}</strong>
                  <p>
                    {new Date(m.createdAt).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {m.data?.selectedJob ? ` · ${m.data.selectedJob.job.title}` : ''}
                  </p>
                </div>
                <span className="row-action">
                  {missionAction(m)}
                  <ArrowRight size={15} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Your conversations and saved work will appear here.</p>
        )}
      </section>
    </div>
  );
}
