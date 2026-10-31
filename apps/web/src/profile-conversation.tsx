import React, { useEffect, useRef, useState } from 'react';
import { sameProfileField } from '../../../packages/contracts/src/profile-comparison.js';
import {
  closedExperience,
  experiences,
} from '../../../packages/contracts/src/profile-interview.js';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import { createPortal } from 'react-dom';
import { ProfileCanvas, profileFieldLabels, type ProfileProposal } from './profile-canvas.js';
export type Request = (path: string, method?: string, body?: unknown) => Promise<any>;
// The model's reply may repeat/paraphrase its structured question. Show that
// question once, rather than turning one turn into two competing prompts.
const narrative = (m: any) =>
  m.role === 'assistant' && m.questions?.length
    ? m.text
        .split(/(?<=[.!?])\s+|(?<=[。！？])\s*/u)
        .filter((part: string) => !/[?？]/.test(part))
        .join(' ')
        .trim()
    : m.text;
export function ProfileConversation({
  mode = 'build',
  initialPrompt,
  form,
  api,
  onChange,
  profileVersion,
  onReview,
  onPendingChange,
  previewTarget,
  previewData,
  approved,
}: {
  mode?: 'build' | 'edit';
  initialPrompt?: { id: string; text: string; label: string } | null;
  previewTarget?: HTMLElement | null;
  previewData?: CareerProfile;
  approved?: boolean;
  form: CareerProfile;
  profileVersion: number;
  onReview?: () => void;
  onPendingChange?: (pending: boolean) => void;
  api: Request;
  onChange: (key: keyof CareerProfile, value: any) => void;
}) {
  const [threads, setThreads] = useState<any[]>([]),
    [thread, setThread] = useState<any>(null),
    [message, setMessage] = useState(''),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [waitSeconds, setWaitSeconds] = useState(0),
    [error, setError] = useState(''),
    [preparingSaved, setPreparingSaved] = useState(false),
    [preparationNotice, setPreparationNotice] = useState(''),
    [applied, setApplied] = useState<Record<string, { value: any; stamp: number }>>({});
  useEffect(() => {
    if (!initialPrompt) return;
    setMessage(initialPrompt.text);
    const input = document.querySelector<HTMLTextAreaElement>('#profile-conversation textarea');
    input?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    input?.focus({ preventScroll: true });
  }, [initialPrompt?.id]);
  const version = useRef(profileVersion);
  version.current = profileVersion;
  const latest = useRef(form),
    mounted = useRef(true),
    log = useRef<HTMLDivElement>(null);
  latest.current = form;
  useEffect(() => {
    mounted.current = true;
    const initial = JSON.stringify(latest.current);
    void api('/profile-threads')
      .then(async (rows) => {
        if (!mounted.current) return;
        setThreads(rows);
        const saved = rows.find((row: any) =>
          mode === 'edit' ? row.title === 'Profile edits' : row.title !== 'Profile edits',
        );
        if (!saved) return;
        const t = await api(`/profile-threads/${saved.id}`);
        if (!mounted.current) return;
        setThread(t);
        // Resume the same owned draft only when no edit/version change raced the load.
        if (t.profileVersion === version.current && JSON.stringify(latest.current) === initial)
          for (const [key, value] of Object.entries(t.workingForm))
            onChange(key as keyof CareerProfile, value);
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [thread?.revision]);
  useEffect(() => {
    if (!busy) {
      setWaitSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setWaitSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const start = async () => {
    const t = await api('/profile-threads', 'POST', {
      currentProfile: latest.current,
      title: mode === 'edit' ? 'Profile edits' : 'Profile building',
      mode,
    });
    if (mounted.current) {
      setThread(t);
      setThreads(await api('/profile-threads'));
    }
    return t;
  };
  const send = (text = message) =>
    run(async () => {
      const t = thread || (await start());
      const next = await api(`/profile-threads/${t.id}/messages`, 'POST', {
        text,
        mode,
        currentProfile: latest.current,
        revision: t.revision,
        consent,
      });
      if (mounted.current) {
        setThread(next);
        setMessage((current) => (current === text ? '' : current));
      }
    });
  const pending = thread?.proposals.filter((p: any) => p.status === 'PENDING') || [];
  useEffect(() => {
    onPendingChange?.(pending.length > 0);
  }, [pending.length]);
  const reviewStage = mode === 'build' && thread?.interview?.phase === 'review';
  const organise = async (
    t: any,
    recordId: string,
    recordSection: 'workExperiences' | 'projects',
  ) => {
    setPreparationNotice('Preparing your experience summary…');
    try {
      await api(`/profile-threads/${t.id}/organise`, 'POST', {
        currentProfile: latest.current,
        revision: t.revision,
        recordId,
        recordSection,
        consent,
      });
    } catch (e) {
      setPreparationNotice(
        'Organisation failed. Original answers and your draft are unchanged. Retry using the experience button below.',
      );
      throw e;
    }
    const next = await api(`/profile-threads/${t.id}`);
    if (mounted.current) {
      setThread(next);
      setPreparationNotice(
        'Your experience summary is ready. Review the suggestions, then use them in your draft.',
      );
    }
  };
  const control = (action: string, recordKey?: string) =>
    run(async () => {
      const t = thread || (await start());
      const next = await api(`/profile-threads/${t.id}/controls`, 'POST', {
        action,
        recordKey,
        currentProfile: latest.current,
        revision: t.revision,
      });
      if (mounted.current) setThread(next);
      if (consent && ['finish_experience', 'finish_interview'].includes(action)) {
        const effective = Object.assign(
          {},
          latest.current,
          ...t.proposals
            .filter((p: any) => p.status === 'PENDING')
            .map((p: any) => ({ [p.field]: p.after })),
        );
        const candidate = experiences(effective).find((r: any) => r.key === t.interview?.active);
        if (candidate?.details.length)
          await organise(
            next,
            candidate.id,
            candidate.key.startsWith('workExperiences:') ? 'workExperiences' : 'projects',
          );
      }
    });
  const retry = () =>
    run(async () => {
      const answer = [...thread.messages]
        .reverse()
        .find((m: any) => m.role === 'user' && m.kind !== 'interview-control');
      const next = await api(`/profile-threads/${thread.id}/messages`, 'POST', {
        text: answer.text,
        retryMessageId: answer.id,
        mode,
        currentProfile: latest.current,
        revision: thread.revision,
        consent,
      });
      if (mounted.current) setThread(next);
    });

  const apply = () =>
    run(async () => {
      const submitted = structuredClone(latest.current);
      const r = await api(`/profile-threads/${thread.id}/proposals`, 'POST', {
        currentProfile: submitted,
        revision: thread.revision,
        reviewed: true,
      });
      if (!mounted.current) return;
      setThread(r.thread);
      if (
        r.fields.some(
          (field: keyof CareerProfile) =>
            !sameProfileField(latest.current[field], submitted[field]),
        )
      )
        throw Error(
          'You edited these details while the request ran. Your edit was kept. Continue the conversation for a fresh suggestion.',
        );
      for (const field of r.fields) onChange(field, r.data[field]);
      setApplied((current) => ({
        ...current,
        ...Object.fromEntries(
          r.fields.map((field: string) => [field, { value: r.data[field], stamp: Date.now() }]),
        ),
      }));
    });
  const decide = (proposal: ProfileProposal, decision: 'apply' | 'reject') =>
    run(async () => {
      const submitted = structuredClone(latest.current);
      const result = await api(`/profile-threads/${thread.id}/proposals/${proposal.id}`, 'POST', {
        decision,
        revision: thread.revision,
        currentProfile: submitted,
      });
      if (!mounted.current) return;
      setThread(result.thread);
      if (!result.applied) return;
      if (
        !sameProfileField(
          latest.current[result.field as keyof CareerProfile],
          submitted[result.field as keyof CareerProfile],
        )
      )
        throw Error(
          'You edited this block while the request ran. Your edit was kept. Ask for a fresh suggestion.',
        );
      onChange(result.field, result.value);
      setApplied((current) => ({
        ...current,
        [result.field]: { value: result.value, stamp: Date.now() },
      }));
    });
  const recoverAnswers = () =>
    run(async () => {
      setPreparingSaved(true);
      setPreparationNotice('Reading saved answers and preparing draft suggestions…');
      try {
        const next = await api(`/profile-threads/${thread.id}/messages`, 'POST', {
          text: 'Organise my saved answers for review.',
          recoverSavedAnswers: true,
          currentProfile: latest.current,
          revision: thread.revision,
          consent,
        });
        if (!mounted.current) return;
        setThread(next);
        const response = next.messages.at(-1),
          pendingUpdates = next.proposals.filter((p: any) => p.status === 'PENDING').length;
        if (response.failed) {
          setPreparationNotice('Preparation failed. Your saved answers and draft are unchanged.');
          throw Error(
            'Could not prepare the saved answers. Open Processing failure details in the latest reply.',
          );
        }
        if (!pendingUpdates) {
          setPreparationNotice('No draft updates were prepared. Your draft is unchanged.');
          throw Error(
            'No source-supported suggestions were prepared. See Preparation details in the latest reply.',
          );
        }
        setPreparationNotice(
          `${pendingUpdates} draft update(s) prepared. Review the suggested details above, then use them in your draft.`,
        );
      } finally {
        if (mounted.current) setPreparingSaved(false);
      }
    });
  return (
    <>
      {previewTarget &&
        createPortal(
          <ProfileCanvas
            data={previewData || form}
            proposals={pending}
            busy={busy}
            error={error}
            applied={applied}
            approved={!!approved}
            onDecision={(p, decision) => void decide(p, decision)}
            onApplyAll={() => void apply()}
          />,
          previewTarget,
        )}
      <section className="profile-assistant chat-first" aria-label="Persistent Profile Builder">
        <h3>{mode === 'build' ? 'Build with your agent' : 'Edit with your agent'}</h3>
        <p className="conversation-intro">
          {profileVersion
            ? `Context · Profile v${profileVersion}`
            : 'Start from your goals, a project or an experience.'}
        </p>
        {initialPrompt && message.includes(initialPrompt.label) && (
          <p className="agent-context-caption">Story attached · {initialPrompt.label}</p>
        )}
        {mode === 'edit' && (
          <div className="agent-quick-actions">
            <button
              className="secondary"
              disabled={busy || !consent || pending.length > 0}
              onClick={() =>
                void run(async () => {
                  const t = thread || (await start());
                  const result = await api(`/profile-threads/${t.id}/polish`, 'POST', {
                    currentProfile: latest.current,
                    revision: t.revision,
                    consent,
                  });
                  if (mounted.current) setThread(result);
                })
              }
            >
              Polish profile
            </button>
            <small>
              {consent ? 'Review suggestions before saving.' : 'Allow AI below to enable polish.'}
            </small>
          </div>
        )}
        <div ref={log} className="conversation-log" role="log" aria-label="Saved profile messages">
          {!thread && (
            <article className="conversation-message assistant">
              <strong>Profile Builder</strong>
              <p>
                {mode === 'build'
                  ? 'What would you like to do next in your career? Tell me a little about yourself.'
                  : 'What would you like to change? I can help refine your goals, skills or experience.'}
              </p>
            </article>
          )}
          {thread?.messages.map((m: any) => (
            <article className={`conversation-message ${m.role}`} key={m.id}>
              <strong>{m.role === 'user' ? 'You' : 'Profile Builder'}</strong>
              <p>{narrative(m)}</p>
              {m.questions?.slice(0, 1).map((q: string) => (
                <p key={q}>{q}</p>
              ))}
              {m.preparation && (
                <details open={m.preparation.status === 'no_changes'}>
                  <summary>Preparation details</summary>
                  <p>
                    {m.preparation.modelRecords} record(s) returned; {m.preparation.acceptedRecords}{' '}
                    passed source checks; {m.preparation.changes} draft update(s) prepared.
                  </p>
                  {m.preparation.rejectedRecords?.map((r: any, i: number) => (
                    <div key={i}>
                      <strong>{r.title}</strong>
                      <ul>
                        {r.reasons.map((reason: string) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {!!m.preparation.discardedFields?.length && (
                    <p>
                      Unsupported field suggestions: {m.preparation.discardedFields.join(', ')}.
                    </p>
                  )}
                </details>
              )}
              {m.failed && (
                <details>
                  <summary>Processing failure details</summary>
                  <p>
                    The saved answer is retained. You can retry it or finish the interview without a
                    model call.
                  </p>
                  <small>
                    {m.diagnostic?.category ? `${m.diagnostic.category} · ` : ''}
                    {m.diagnostic?.stage} · {m.diagnostic?.kind} {m.diagnostic?.status || ''}
                  </small>
                  {m.diagnostic?.elapsedMs != null && (
                    <p>
                      Elapsed: {(m.diagnostic.elapsedMs / 1000).toFixed(1)}s · Limit:{' '}
                      {m.diagnostic.timeoutMs / 1000}s
                    </p>
                  )}
                  {m.diagnostic?.issues?.map((issue: any, i: number) => (
                    <p key={i}>
                      {issue.path}: {issue.message}
                    </p>
                  ))}
                </details>
              )}
              {!!m.retrieved?.length && (
                <details>
                  <summary>Sources used for this reply</summary>
                  {m.retrieved.map((h: any) => (
                    <p key={h.id}>{h.text}</p>
                  ))}
                </details>
              )}
            </article>
          ))}
        </div>
        {busy && (
          <p role="status" className="conversation-working">
            <span className="pulse" />
            {waitSeconds < 3
              ? 'Sending your request to the profile agent…'
              : waitSeconds < 30
                ? `Waiting for your agent’s reply · ${waitSeconds}s. Suggested edits will appear for review.`
                : `Still waiting for your agent · ${waitSeconds}s. Keep this page open; your message stays in the input until a reply arrives.`}
          </p>
        )}
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {!!pending.length && (
          <p className="conversation-change-hint" role="status">
            {pending.length} suggested change{pending.length === 1 ? '' : 's'} ready in your
            profile.{' '}
            <a href={`#profile-change-${pending[0].field}`}>
              Review {profileFieldLabels[pending[0].field] || 'changes'}
            </a>
          </p>
        )}
        {mode === 'build' &&
          thread &&
          [...(form.workExperiences || []), ...(form.projects || [])].some(
            (r) => r.details.length,
          ) && (
            <details>
              <summary>Experience summaries</summary>
              <p>Turn your answers into a structured summary for review.</p>
              {[...(form.workExperiences || []), ...(form.projects || [])]
                .filter((r) => r.details.length)
                .map((r) => (
                  <p key={r.id}>
                    <button
                      className="secondary"
                      disabled={busy || !consent || pending.length > 0}
                      onClick={() =>
                        void run(() =>
                          organise(
                            thread,
                            r.id,
                            (form.workExperiences || []).includes(r)
                              ? 'workExperiences'
                              : 'projects',
                          ),
                        )
                      }
                    >
                      Organise: {r.title}
                    </button>
                  </p>
                ))}
            </details>
          )}
        {preparationNotice && (
          <p role="status" aria-live="polite">
            {preparationNotice}
          </p>
        )}
        {!reviewStage && (
          <label>
            Your next profile message
            <textarea
              aria-label="Your next profile message"
              placeholder={
                mode === 'build'
                  ? 'Tell me about yourself or a project…'
                  : 'What should we change in your profile?'
              }
              onKeyDown={(e) => {
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === 'Enter' &&
                  !e.nativeEvent.isComposing &&
                  consent &&
                  message.trim() &&
                  !busy
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              value={message}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
        )}
        {(thread || !reviewStage) && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              aria-label="I allow the configured model to process this conversation, working form and retrieved confirmed evidence."
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span aria-hidden="true">
              Allow AI to use this conversation, profile and confirmed evidence.
            </span>
          </label>
        )}
        {!reviewStage && (
          <button
            className="primary"
            disabled={busy || !message.trim() || !consent}
            onClick={() => void send()}
          >
            {busy ? 'Preparing a reply…' : 'Send profile message'}
          </button>
        )}
        {thread?.messages.at(-1)?.failed && (
          <button className="secondary" disabled={busy || !consent} onClick={() => void retry()}>
            Retry saved answer
          </button>
        )}
        {mode === 'build' && thread && (
          <section className="interview-controls" aria-label="Interview progress">
            <p role="status">
              {reviewStage
                ? 'Interview finished — review your draft.'
                : thread.interview?.active
                  ? `Discussing: ${thread.interviewRecords?.find((r: any) => r.key === thread.interview.active)?.title || 'current experience'}`
                  : 'Choose an experience or finish when ready.'}
            </p>
            {reviewStage ? (
              <>
                {thread.hasUnfiledExperience && (
                  <div className="info">
                    <div>
                      <p>
                        A finished experience is saved in the conversation but is not yet a
                        structured draft record. Organise those answers without another interview,
                        or review the current draft.
                      </p>
                      <button
                        className="secondary"
                        disabled={busy || !consent}
                        onClick={() => void recoverAnswers()}
                      >
                        {preparingSaved
                          ? 'Preparing saved answers…'
                          : 'Prepare missing experience from saved answers'}
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="primary"
                  disabled={busy || pending.length > 0 || !onReview}
                  onClick={onReview}
                >
                  {thread.hasUnfiledExperience
                    ? 'Review current draft without this experience'
                    : 'Review profile draft now'}
                </button>
                {pending.length > 0 && (
                  <p>Use or decline the pending details above before preparing the final draft.</p>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void control('resume')}
                >
                  Resume interview
                </button>
              </>
            ) : (
              <div className="form-actions">
                <button
                  className="secondary"
                  disabled={busy || !thread.interview?.active}
                  onClick={() => void control('finish_experience')}
                >
                  Finish this experience
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void control('next_experience')}
                >
                  Add another experience
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void control('finish_interview')}
                >
                  Finish interview & review
                </button>
                <button
                  className="text-button"
                  disabled={busy || !thread.interview?.question}
                  onClick={() => void control('skip_question')}
                >
                  Skip this question
                </button>
              </div>
            )}
            {!!thread.interview?.closed?.length && (
              <details>
                <summary>Finished experiences</summary>
                {thread.interviewRecords
                  ?.filter((r: any) => closedExperience(thread.interview.closed, r.key))
                  .map((r: any) => (
                    <p key={r.key}>
                      {r.title}{' '}
                      <button
                        className="text-button"
                        disabled={busy || r.historical}
                        onClick={() => void control('resume', r.key)}
                      >
                        Reopen this experience
                      </button>
                    </p>
                  ))}
              </details>
            )}
          </section>
        )}
        {mode === 'edit' && (
          <button
            className="text-button"
            disabled={busy || pending.length > 0}
            onClick={() => void run(start)}
          >
            New edit conversation
          </button>
        )}
        {mode === 'build' && (
          <details className="conversation-settings">
            <summary>Need an earlier conversation?</summary>
            <p className="muted">
              Your latest conversation resumes automatically. Open recovery only if you need an
              older session or an earlier unsaved draft.
            </p>
            <details className="recovery-options">
              <summary>Recovery options</summary>
              <label>
                Earlier conversation
                <select
                  value={thread?.id || ''}
                  disabled={busy}
                  onChange={(e) =>
                    void run(async () => {
                      const t = await api(`/profile-threads/${e.target.value}`);
                      if (mounted.current) setThread(t);
                    })
                  }
                >
                  <option value="">Choose a conversation</option>
                  {threads.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.title} · {new Date(t.updatedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>
              <button className="text-button" disabled={busy} onClick={() => void run(start)}>
                Start a separate conversation
              </button>
              {thread && (
                <>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => setThread(await api(`/profile-threads/${thread.id}`)))
                    }
                  >
                    Reload this conversation
                  </button>
                  <p className="muted">
                    Restoring replaces the unsaved editor only. Your approved profile is unchanged.
                  </p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      for (const [key, value] of Object.entries(thread.workingForm))
                        onChange(key as keyof CareerProfile, value);
                    }}
                  >
                    Restore its unsaved draft
                  </button>
                </>
              )}
            </details>
          </details>
        )}
      </section>
    </>
  );
}
