import React, { useEffect, useRef, useState } from 'react';
import {
  closedExperience,
  experiences,
} from '../../../packages/contracts/src/profile-interview.js';
import type { CareerProfile } from '../../../packages/contracts/src/index.js';
import { CareerMemoryPanel } from './career-memory.js';
import { ProfileSummary } from './profile-summary.js';
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
  form,
  api,
  onChange,
  profileVersion,
  onReview,
  onPendingChange,
}: {
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
    [error, setError] = useState(''),
    [preparingSaved, setPreparingSaved] = useState(false),
    [preparationNotice, setPreparationNotice] = useState(''),
    [remember, setRemember] = useState<any>(null),
    [memoryOpen, setMemoryOpen] = useState(false);
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
        if (!rows[0]) return;
        const t = await api(`/profile-threads/${rows[0].id}`);
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
    const t = await api('/profile-threads', 'POST', { currentProfile: latest.current });
    if (mounted.current) {
      setThread(t);
      setThreads(await api('/profile-threads'));
    }
    return t;
  };
  const send = () =>
    run(async () => {
      const t = thread || (await start());
      const text = message;
      const next = await api(`/profile-threads/${t.id}/messages`, 'POST', {
        text,
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
  const reviewStage = thread?.interview?.phase === 'review';
  const organise = async (
    t: any,
    recordId: string,
    recordSection: 'workExperiences' | 'projects',
  ) => {
    setPreparationNotice('Organising answers and saving a draft memory…');
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
        'Organised details and a draft memory are ready. Review the suggestions, then use them in your draft.',
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
            JSON.stringify(latest.current[field]) !== JSON.stringify(submitted[field]),
        )
      )
        throw Error(
          'You edited these details while the request ran. Your edit was kept. Continue the conversation for a fresh suggestion.',
        );
      for (const field of r.fields) onChange(field, r.data[field]);
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
  const proposalData = Object.assign(
    {},
    form,
    ...pending.map((p: any) => ({ [p.field]: p.after })),
  );
  return (
    <>
      <section className="profile-assistant chat-first" aria-label="Persistent Profile Builder">
        <h3>Your career conversation</h3>
        <div ref={log} className="conversation-log" role="log" aria-label="Saved profile messages">
          {!thread && (
            <article className="conversation-message assistant">
              <strong>Profile Builder</strong>
              <p>
                What kind of role would you like to explore, and where are you in your career? It is
                fine if you are still deciding.
              </p>
            </article>
          )}
          {thread?.messages.map((m: any) => (
            <article className={`conversation-message ${m.role}`} key={m.id}>
              <strong>{m.role === 'user' ? 'You' : 'Profile Builder'}</strong>
              {m.role === 'user' && m.answerTag && (
                <p className="small muted">Answer field: {m.answerTag.split(':').at(-1)}</p>
              )}
              <p>{narrative(m)}</p>
              {m.questions?.slice(0, 1).map((q: string) => (
                <p key={q}>{q}</p>
              ))}
              {m.role === 'user' && m.kind !== 'interview-control' && (
                <details>
                  <summary>Keep this answer as a memory</summary>
                  <button
                    className="text-button"
                    onClick={() => {
                      setRemember({
                        text: m.text,
                        source: { kind: 'conversation', id: `${thread.id}/${m.id}`, quote: m.text },
                      });
                      setMemoryOpen(true);
                    }}
                  >
                    Save message as draft memory
                  </button>
                </details>
              )}
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
                    {m.diagnostic?.stage} · {m.diagnostic?.kind} {m.diagnostic?.status || ''}
                  </small>
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
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {!!pending.length && (
          <section className="conversation-proposal" aria-label="Suggested profile update">
            <h4>Details ready for your draft</h4>
            <p>
              Review these suggestions before adding them. Your approved profile stays unchanged.
            </p>
            <details>
              <summary>Review suggested details</summary>
              <ProfileSummary data={proposalData} />
              <details>
                <summary>Supporting source quotations</summary>
                {pending
                  .flatMap((p: any) => p.evidence)
                  .map((e: any, i: number) => (
                    <blockquote key={i}>{e.quote}</blockquote>
                  ))}
              </details>
            </details>
            <button className="secondary" disabled={busy} onClick={() => void apply()}>
              Use these details in my draft
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void control('keep_current_draft')}
            >
              Keep my current draft instead
            </button>
          </section>
        )}
        {thread &&
          [...(form.workExperiences || []), ...(form.projects || [])].some(
            (r) => r.details.length,
          ) && (
            <details>
              <summary>Organise experience answers & draft memories</summary>
              <p>
                Group each experience into background, personal actions, outcomes and reflection.
                Original answers stay available. Memories remain drafts until confirmed.
              </p>
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
        {thread && (
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
        {!reviewStage && (
          <label>
            Your next profile message
            <textarea
              aria-label="Your next profile message"
              placeholder="Tell me about your goals or an experience…"
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
              onChange={(e) => setConsent(e.target.checked)}
            />
            I allow the configured model to process this conversation, working form and retrieved
            confirmed evidence.
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
        <details className="conversation-settings">
          <summary>Conversation history & recovery</summary>
          <label>
            Saved profile conversation
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
            Start profile conversation
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
                Reload saved conversation
              </button>
              <p>
                Restore replaces this unsaved draft only. It does not change an approved profile.
              </p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  for (const [key, value] of Object.entries(thread.workingForm))
                    onChange(key as keyof CareerProfile, value);
                }}
              >
                Restore saved working form
              </button>
            </>
          )}
        </details>
      </section>
      <details
        open={memoryOpen}
        onToggle={(e) => setMemoryOpen(e.currentTarget.open)}
        className="optional-memory"
      >
        <summary>Career memory & STAR library</summary>
        <CareerMemoryPanel profileVersion={profileVersion} api={api} incoming={remember} />
      </details>
    </>
  );
}
