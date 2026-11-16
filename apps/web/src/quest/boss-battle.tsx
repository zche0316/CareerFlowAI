import { useEffect, useState } from 'react';
import { ArrowRight, Flag, Lock, Swords } from 'lucide-react';
import { XP_RULES } from './progress.js';
import { ReadAloud, RecordAnswer, SpeakAnswer } from './voice.js';
import { VoiceInterviewer, type LiveCall } from './voice-interviewer.js';
import { interviewPlan } from '../../../../packages/contracts/src/interview-plan.js';
import {
  battleReport,
  starParts,
  type BattleReport,
} from '../../../../packages/contracts/src/battle-report.js';

type Mark = 'critical' | 'hit' | 'partial' | 'miss';
type Round = {
  questionId: string;
  kind: 'answer' | 'follow_up';
  prompt: string;
  answer: string;
  evaluation: {
    star: Record<'situation' | 'task' | 'action' | 'result', Mark>;
    note: string;
    followUp: string;
  };
  reviewer: 'rules' | 'model';
  at?: string;
};

/** The end of a long spoken line, cut at a word, so a subtitle never grows past a few lines. */
export const subtitle = (text: string, max = 220) => {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(-max);
  return '…' + cut.slice(cut.indexOf(' ') + 1);
};

// A resume fact id ("workExperiences-<uuid>-detail-2") is internal; players see its kind.
const stageStatus = {
  open: 'not started',
  probing: 'follow-up waiting',
  covered: 'covered',
  partly: 'partly covered',
  skipped: 'skipped',
} as const;

const itemLabel = (factId: string) =>
  /^workExperiences/.test(factId)
    ? 'Work'
    : /^projects/.test(factId)
      ? 'Project'
      : /^educations?/.test(factId)
        ? 'Education'
        : /^skill/.test(factId)
          ? 'Skill'
          : 'Evidence';
export const damageFor: Record<Mark, number> = { critical: 15, hit: 10, partial: 5, miss: 0 };
const markLabel: Record<Mark, string> = {
  critical: 'Critical',
  hit: 'Hit',
  partial: 'Glancing',
  miss: 'Missed',
};
export const roundDamage = (r: Round) =>
  Object.values(r.evaluation.star).reduce((n, m) => n + damageFor[m], 0);

/**
 * Original panel of three stern interviewers. During a live call (CFS-170) the lead interviewer
 * talks while the panel speaks, and the panel leans in while the candidate speaks.
 */
function Panel({
  live = false,
  speaker = null,
}: {
  live?: boolean;
  speaker?: 'panel' | 'you' | null;
}) {
  return (
    <svg
      role="img"
      aria-label={
        live
          ? `The panel on a live call: ${speaker === 'panel' ? 'speaking' : speaker === 'you' ? 'listening to you' : 'waiting'}`
          : 'The panel: three interviewers behind a desk'
      }
      className={`boss-panel-art${live ? ' live' : ''}${speaker ? ` talk-${speaker}` : ''}`}
      width="280"
      height="140"
      viewBox="0 0 200 100"
    >
      <rect
        x="20"
        y="16"
        width="44"
        height="44"
        rx="12"
        fill="#3B3D47"
        stroke="#fff"
        strokeWidth="2.5"
      />
      <path d="M28 30l10 4M56 30l-10 4" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="34" cy="40" r="2.8" fill="#fff" />
      <circle cx="50" cy="40" r="2.8" fill="#fff" />
      <path d="M34 50h16" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <g className="boss-lead">
        <rect
          x="78"
          y="6"
          width="44"
          height="54"
          rx="12"
          fill="#FF8A6B"
          stroke="#fff"
          strokeWidth="2.5"
        />
        <path d="M86 22l10 5M114 22l-10 5" stroke="#111218" strokeWidth="3" strokeLinecap="round" />
        <circle cx="92" cy="34" r="3" fill="#111218" />
        <circle cx="108" cy="34" r="3" fill="#111218" />
        <path
          className="boss-mouth"
          d="M92 47q8-5 16 0"
          fill="none"
          stroke="#111218"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </g>
      <rect
        x="136"
        y="16"
        width="44"
        height="44"
        rx="22"
        fill="#3B3D47"
        stroke="#fff"
        strokeWidth="2.5"
      />
      <circle cx="150" cy="38" r="5" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="166" cy="38" r="5" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M155 38h6M151 50h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <rect
        x="6"
        y="62"
        width="188"
        height="30"
        rx="8"
        fill="#262836"
        stroke="#fff"
        strokeWidth="2.5"
      />
    </svg>
  );
}

/**
 * Interview practice as a boss battle. Questions are the boss's health; the Evaluator scores
 * each answer on STAR (the damage model) and may counter with one follow-up.
 */
export function QuestBossBattle({
  mission: m,
  busy,
  onRound,
  onFinish,
  onReplan,
  startVoice,
  transcribe,
  voiceStatus,
}: {
  /** Which voice features the project can use; hides the ones it cannot (CFS-139). */
  voiceStatus?: () => Promise<{ realtime: boolean; transcribe: boolean }>;
  /** Live mode only: server transcription of a recorded answer (CFS-139). */
  transcribe?: (audio: Blob) => Promise<string>;
  /** Live mode only: a key for the realtime voice interviewer (CFS-136). */
  startVoice?: () => Promise<any>;
  mission: any;
  busy: boolean;
  onRound: (body: { questionId: string; answer: string; followUp: boolean }) => Promise<void>;
  onFinish: (endedEarly: boolean) => Promise<void>;
  /** Plans an unstarted interview from before the stage plan again (CFS-173). */
  onReplan?: () => Promise<void>;
}) {
  const d = m.data || {};
  const [voice, setVoice] = useState<{ realtime: boolean; transcribe: boolean } | null>(null);
  useEffect(() => {
    voiceStatus?.()
      .then(setVoice)
      .catch(() => setVoice({ realtime: false, transcribe: false }));
  }, []);
  // Two ways to answer, one at a time on screen (CFS-170): a live call with the panel, or one
  // question at a time by typing or recording. The choice is remembered on this browser.
  const canCall = Boolean(startVoice && voice?.realtime);
  const [mode, setModeState] = useState<'call' | 'turns'>(() => {
    try {
      return localStorage.getItem('careerflow.answerMode') === 'turns' ? 'turns' : 'call';
    } catch {
      return 'call';
    }
  });
  const setMode = (next: 'call' | 'turns') => {
    setModeState(next);
    try {
      localStorage.setItem('careerflow.answerMode', next);
    } catch {
      /* private mode: for this page only */
    }
  };
  const calling = canCall && mode === 'call';
  const [call, setCall] = useState<LiveCall | null>(null);
  const onCall = Boolean(call && (call.phase === 'live' || call.phase === 'connecting'));
  const questions: { id: string; question: string; focus: string }[] = d.questions || [];
  const rounds: Round[] = d.rounds || [];
  const live = m.status === 'AWAITING_INTERVIEW';
  const mainFor = (id: string) => rounds.find((r) => r.questionId === id && r.kind === 'answer');
  const answered = questions.filter((q) => mainFor(q.id));
  const firstOpen = Math.max(
    0,
    questions.findIndex((q) => !mainFor(q.id)),
  );
  const [index, setIndex] = useState(firstOpen);
  const [localSkips, setSkipped] = useState<string[]>([]);
  // Skips the panel agreed to on the server (CFS-145) count as well as the Next button's.
  const serverSkips: string[] = d.skippedQuestions || [];
  const skipped = [...localSkips, ...serverSkips];
  // The panel's latest reply to a non-answer about this question, if no answer came after it.
  const chat: { questionId: string; user: string; reply: string; at: string; skipped: boolean }[] =
    d.panelChat || [];
  const [text, setText] = useState('');
  // Voice only (CFS-162): answers come from the microphone like a real interview; the
  // transcript stays visible to check, but cannot be typed into or pasted from items.
  const [voiceOnly, setVoiceOnly] = useState(() => {
    try {
      return localStorage.getItem('careerflow.voiceOnly') === 'yes';
    } catch {
      return false;
    }
  });
  const toggleVoiceOnly = (on: boolean) => {
    setVoiceOnly(on);
    try {
      localStorage.setItem('careerflow.voiceOnly', on ? 'yes' : 'no');
    } catch {
      /* private mode: for this page only */
    }
  };
  // The stage plan (CFS-166): one stage per question, follow-ups until covered or the stage's
  // budget is spent, done when every stage is settled.
  const plan = interviewPlan(
    questions,
    rounds.map((r) => ({ ...r, at: r.at || '' })),
    skipped,
  );
  const settled = (s: (typeof plan.steps)[number]) => s.status !== 'open' && s.status !== 'probing';
  const q = questions[Math.min(index, questions.length - 1)];
  const step = plan.steps[Math.min(index, questions.length - 1)];
  const main = q ? mainFor(q.id) : undefined;
  const pendingFollow = live && step ? step.pendingFollowUp : '';
  useEffect(() => setText(''), [q?.id, pendingFollow, rounds.length, chat.length]);
  // Once a stage is settled (covered, out of follow-ups or skipped), move to the next open one.
  useEffect(() => {
    if (!live || !step || !settled(step) || !plan.next) return;
    setIndex(plan.steps.indexOf(plan.next));
  }, [rounds.length, skipped.length]);
  const last = rounds.at(-1);
  const lastChat = chat.at(-1);
  const panelReply =
    lastChat &&
    q &&
    lastChat.questionId === q.id &&
    !lastChat.skipped &&
    (!last?.at || last.at < lastChat.at)
      ? lastChat
      : null;
  // A skip agreed by the panel moves on like the Next button.
  useEffect(() => {
    if (!live || !lastChat?.skipped) return;
    const next = questions.findIndex(
      (x) => !mainFor(x.id) && !serverSkips.includes(x.id) && !localSkips.includes(x.id),
    );
    if (next >= 0) setIndex(next);
  }, [chat.length]);

  // Boss traits come from the selected job's requirement mapping, never invented. The resume
  // team's gap report is preferred: it includes answers confirmed during tailoring (CFS-123).
  const items: any[] = d.resumeTeam?.gaps?.requirements || d.selectedJob?.mapping?.items || [];
  const weak = items
    .filter((i) => i.level === 'required' && i.status === 'evidenced')
    .slice(0, 2)
    .map((i) => i.term);
  const resists = items
    .filter((i) => i.level === 'required' && i.status === 'not_evidenced')
    .slice(0, 2)
    .map((i) => i.term);
  const claims: { factId: string; text: string }[] = (d.resumeDraft?.claims || []).slice(0, 4);
  const lesson: string | undefined = d.priorFeedback?.improvements?.[0];
  const allDone = plan.done;
  const left = plan.steps.filter((s) => !settled(s)).length;

  const prompt = pendingFollow || q?.question;
  const submit = async () => {
    if (!q || !text.trim()) return;
    await onRound({ questionId: q.id, answer: text.trim(), followUp: Boolean(pendingFollow) });
  };
  const nextQuestion = () => {
    if (q) setSkipped((s) => [...s, q.id]);
    const open = plan.steps
      .map((s, i) => (i !== index && !settled(s) ? i : -1))
      .filter((i) => i >= 0);
    const next = open.find((i) => i > index) ?? open[0];
    if (next !== undefined) setIndex(next);
  };

  const showChoices = claims.length > 0 || Boolean(lesson);
  // The plan follows the call: the question the panel is asking is the one shown.
  useEffect(() => {
    const i = questions.findIndex((x) => x.id === call?.questionId);
    if (onCall && i >= 0) setIndex(i);
  }, [call?.questionId, onCall]);
  const waiting = plan.steps.filter((s) => s.status === 'probing').length;
  // Questions stay hidden until the panel asks them (CFS-177): answered or skipped ones, the one
  // being asked one at a time, and those a live call has reached. All show once it is over.
  const [callAsked, setCallAsked] = useState<string[]>([]);
  useEffect(() => {
    const id = call?.questionId;
    if (onCall && id) setCallAsked((a) => (a.includes(id) ? a : [...a, id]));
  }, [call?.questionId, onCall]);
  const asked = (i: number) =>
    !live ||
    plan.steps[i]?.status !== 'open' ||
    (!calling && i === index) ||
    callAsked.includes(questions[i]?.id);
  const shown = q ? asked(Math.min(index, questions.length - 1)) : false;
  // Mirrors the server's canReplan (CFS-173): no stages and nothing answered yet.
  const replannable =
    Boolean(onReplan) &&
    live &&
    questions.length > 0 &&
    !questions.some((x: any) => x.stage) &&
    rounds.length === 0 &&
    !(d.answers || []).some((a: any) => a.answer?.trim()) &&
    chat.length === 0;

  return (
    <div className="quest-page boss">
      <section className="quest-tile ink boss-arena" aria-label="Arena">
        <div className="boss-foe">
          <Panel live={onCall} speaker={onCall ? call!.speaker : null} />
          {onCall && (
            <p className={`boss-call-status talk-${call!.speaker || 'idle'}`} role="status">
              <span className="boss-wave" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              {call!.phase === 'connecting'
                ? 'Connecting to the panel…'
                : call!.paused
                  ? 'Paused · the panel is waiting'
                  : call!.speaker === 'panel'
                    ? 'The panel is speaking'
                    : call!.speaker === 'you'
                      ? 'Listening to you'
                      : 'Your turn to speak'}
            </p>
          )}
          <div className="boss-hp-head">
            <span>The Panel</span>
            <span>
              {left} of {questions.length} stage{questions.length === 1 ? '' : 's'} left
            </span>
          </div>
          <div
            className="boss-hp"
            role="img"
            aria-label={`${left} of ${questions.length} stages left`}
          >
            {plan.steps.map((s) => (
              <span key={s.questionId} className={settled(s) ? 'gone' : ''} />
            ))}
          </div>
          {(weak.length > 0 || resists.length > 0) && (
            <div className="boss-traits">
              {weak.map((t) => (
                <span key={t} className="quest-chip lime">
                  Weak to: your {t} evidence
                </span>
              ))}
              {resists.map((t) => (
                <span key={t} className="quest-chip dark">
                  Resists: {t} (no evidence yet)
                </span>
              ))}
            </div>
          )}
          <small className="boss-fine">
            Traits come from this job’s requirement mapping. Damage is STAR coverage scored by the
            Evaluator.
          </small>
        </div>
        <div className="boss-ask">
          {replannable && !onCall && (
            <div className="boss-replan" role="note">
              <p>
                These questions were made before the interview plan, so they have no stages
                (motivation, behavioural, technical…). Nothing is answered yet, so the panel can
                plan this interview again.
              </p>
              <button
                type="button"
                className="quest-press lime"
                disabled={busy}
                onClick={() => void onReplan!()}
              >
                Re-plan the interview
              </button>
            </div>
          )}
          <div className="boss-qtabs" role="group" aria-label="Interview plan">
            {plan.steps.map((s, i) => (
              <button
                key={s.questionId}
                type="button"
                className={`boss-qtab ${s.status}${i === index ? ' on' : ''}${settled(s) ? ' done' : ''}${asked(i) ? '' : ' locked'}`}
                aria-pressed={i === index}
                disabled={!asked(i)}
                title={
                  asked(i) ? `${s.label}: ${stageStatus[s.status]}` : `${s.label}: not asked yet`
                }
                onClick={() => setIndex(i)}
              >
                {!asked(i) && <Lock size={12} aria-hidden="true" />}
                {i + 1} · {s.label}
                {settled(s) && (
                  <span aria-hidden="true"> {s.status === 'covered' ? '✓' : '–'}</span>
                )}
                <span className="sr-only">
                  {' '}
                  ({asked(i) ? stageStatus[s.status] : 'not asked yet'})
                </span>
              </button>
            ))}
          </div>
          {q && (
            <>
              <span className="quest-chip coral boss-ask-chip">
                {onCall
                  ? `Live call · ${step?.label || 'Question'}`
                  : calling
                    ? `Up next on the call · ${step?.label || 'Question'}`
                    : pendingFollow
                      ? `The panel counters · follow-up ${(step?.used || 0) + 1} of ${step?.budget}`
                      : `${step?.label || 'Question'}${shown ? ` · ${q.focus}` : ''}`}
              </span>
              {panelReply && !calling && (
                <p className="boss-panel-reply" role="status">
                  <b>The panel:</b> {panelReply.reply}
                </p>
              )}
              {onCall ? (
                // One exchange at a time, like subtitles (CFS-172): the panel's line and yours.
                <div className="boss-subtitles">
                  <p className="boss-bubble live" aria-live="polite">
                    <b>Panel</b> {subtitle(call!.caption) || '…'}
                  </p>
                  <p className={`boss-bubble you${call!.speaker === 'you' ? ' on' : ''}`}>
                    <b>You</b>{' '}
                    {call!.speaker === 'you' && !call!.yours
                      ? 'Listening…'
                      : subtitle(call!.yours) || 'Answer out loud when the panel finishes.'}
                  </p>
                </div>
              ) : (
                <>
                  {shown ? (
                    <p className="boss-bubble">“{calling ? q.question : prompt}”</p>
                  ) : (
                    <p className="boss-bubble hidden-question">
                      The panel asks this question when the call reaches it. Questions stay hidden
                      until they are asked, as in a real interview.
                    </p>
                  )}
                  {!calling && shown && (
                    <ReadAloud text={prompt || ''} label="Read the question aloud" />
                  )}
                </>
              )}
              <small className="boss-fine">
                {step
                  ? `This stage checks ${step.goal}. The panel follows up ${
                      step.budget === 0
                        ? 'never here'
                        : `up to ${step.budget} time${step.budget === 1 ? '' : 's'}`
                    } until it is covered.`
                  : ''}{' '}
                Practice answers never become profile facts.
              </small>
            </>
          )}
        </div>
      </section>

      <div className="quest-row boss-row">
        {live ? (
          <section className="quest-tile boss-turn" aria-labelledby="boss-turn">
            <div className="quest-tile-head">
              <h2 id="boss-turn">Your turn</h2>
              <span className="quest-chip lime">+{XP_RULES.practiceAnswer} XP per answer</span>
            </div>
            {canCall && (
              <div className="boss-modes" role="group" aria-label="How to answer">
                <button
                  type="button"
                  aria-pressed={mode === 'call'}
                  disabled={onCall}
                  onClick={() => setMode('call')}
                >
                  <b>Live call</b>
                  <small>The panel asks out loud and follows up; you talk.</small>
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'turns'}
                  disabled={onCall}
                  onClick={() => setMode('turns')}
                >
                  <b>One question at a time</b>
                  <small>Type or record each answer and get a verdict after each.</small>
                </button>
              </div>
            )}
            {calling ? (
              <>
                <VoiceInterviewer
                  start={startVoice!}
                  disabled={busy}
                  onLive={setCall}
                  onAnswer={(questionId, answer) =>
                    onRound({ questionId, answer, followUp: false })
                  }
                />
                {waiting > 0 && !onCall && (
                  <p className="quest-note">
                    {waiting} written follow-up{waiting === 1 ? '' : 's'} from the verdict{' '}
                    {waiting === 1 ? 'waits' : 'wait'} in “One question at a time”. The call covers
                    the stages not answered yet.
                  </p>
                )}
              </>
            ) : (
              <>
                {main && !pendingFollow ? (
                  <p className="quest-note">
                    You answered this one. Answer again to replace it, or pick another question.
                  </p>
                ) : null}
                <label className="checkbox boss-voice-only">
                  <input
                    type="checkbox"
                    checked={voiceOnly}
                    onChange={(e) => toggleVoiceOnly(e.target.checked)}
                  />
                  Voice only, like a real interview: answer by recording, no typing
                </label>
                <label className="quest-field">
                  {pendingFollow ? 'Your follow-up answer' : 'Your answer'}
                  {voiceOnly && ' (transcript of your recording)'}
                  <textarea
                    rows={6}
                    maxLength={6000}
                    value={text}
                    readOnly={voiceOnly}
                    disabled={busy}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Situation, what you were asked to do, what you personally did, and what changed. Real experience only."
                  />
                </label>
                {transcribe && voice?.transcribe ? (
                  <RecordAnswer
                    disabled={busy}
                    transcribe={transcribe}
                    onText={(words) => setText((t) => (t ? `${t} ` : '') + words)}
                  />
                ) : (
                  <SpeakAnswer
                    disabled={busy}
                    onText={(words) => setText((t) => (t ? `${t} ` : '') + words)}
                  />
                )}
                {voiceOnly && text && (
                  <button type="button" className="text-button" onClick={() => setText('')}>
                    Clear and record again
                  </button>
                )}
                {showChoices && !voiceOnly && (
                  <div className="boss-items">
                    <span>Use an item</span>
                    <div>
                      {claims.map((c) => (
                        <button
                          key={c.factId}
                          type="button"
                          className="boss-item"
                          onClick={() => setText((t) => (t ? `${t} ` : '') + c.text)}
                        >
                          <span className="quest-chip ink">{itemLabel(c.factId)}</span>
                          <span className="boss-item-text">
                            {c.text.length > 140 ? c.text.slice(0, 137) + '…' : c.text}
                          </span>
                        </button>
                      ))}
                      {lesson && (
                        <p className="boss-item lesson">
                          <span className="quest-chip lilac">Lesson</span>
                          <span className="boss-item-text">
                            {lesson.length > 140 ? lesson.slice(0, 137) + '…' : lesson}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="boss-actions">
              {!calling && (
                <button
                  type="button"
                  className="quest-press lime"
                  disabled={busy || !text.trim()}
                  onClick={() => void submit()}
                >
                  <Swords size={18} />
                  {busy
                    ? 'The panel is scoring…'
                    : pendingFollow
                      ? 'Answer the follow-up'
                      : 'Answer'}
                </button>
              )}
              {pendingFollow && !calling && (
                <button
                  type="button"
                  className="quest-press"
                  disabled={busy}
                  onClick={nextQuestion}
                >
                  Skip follow-up
                  <ArrowRight size={16} />
                </button>
              )}
              <button
                type="button"
                className="quest-press"
                disabled={busy || answered.length === 0 || onCall}
                onClick={() => void onFinish(!allDone)}
              >
                <Flag size={16} />
                {allDone ? 'Finish battle · get feedback' : 'Retreat · get feedback now'}
              </button>
            </div>
          </section>
        ) : (
          <BattleReportView
            report={battleReport(
              questions,
              rounds.map((r) => ({ ...r, at: r.at || '' })),
              skipped,
            )}
            endedEarly={Boolean(d.endedEarly)}
            rules={rounds.some((r) => r.reviewer === 'rules')}
          />
        )}

        {live && (
          <section className="quest-tile lime boss-last" aria-labelledby="boss-last">
            <div className="quest-tile-head">
              <h2 id="boss-last">Last round</h2>
              <b className="boss-dmg">{last ? `${roundDamage(last)} dmg` : '–'}</b>
            </div>
            {last ? (
              <>
                <div className="boss-star">
                  {(['situation', 'task', 'action', 'result'] as const).map((k) => (
                    <div key={k} className={`boss-mark ${last.evaluation.star[k]}`}>
                      <span>{k.toUpperCase()}</span>
                      <b>{markLabel[last.evaluation.star[k]]}</b>
                    </div>
                  ))}
                </div>
                <p className="boss-note">{last.evaluation.note}</p>
                <ReadAloud
                  text={[last.evaluation.note, last.evaluation.followUp].filter(Boolean).join(' ')}
                  label="Read the verdict aloud"
                />
                {last.evaluation.followUp && (
                  <div className="boss-counter">
                    <span>THE PANEL COUNTERS</span>
                    <b>“{last.evaluation.followUp}”</b>
                  </div>
                )}
                <small>
                  {last.reviewer === 'rules'
                    ? 'Demo mode: rule-based scoring, not an AI assessment.'
                    : 'Scored by the Evaluator model.'}{' '}
                  Practice answers are feedback, never facts.
                </small>
              </>
            ) : (
              <p className="boss-note">
                Answer a question and the Evaluator’s STAR verdict appears here.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

const gradeWord = { S: 'Outstanding', A: 'Strong', B: 'Solid', C: 'Developing', D: 'Early' };

/**
 * Battle report (CFS-178): an overall grade, then per stage its grade, the STAR marks (each part
 * at its best across the answer and follow-ups), every answer with the panel's note, and what
 * the panel still wanted to know. Grades come from the saved marks, not a new model call.
 */
function BattleReportView({
  report,
  endedEarly,
  rules,
}: {
  report: BattleReport;
  endedEarly: boolean;
  rules: boolean;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <section className="quest-tile battle-report" aria-labelledby="battle-report">
      <div className="battle-report-head">
        <div>
          <h2 id="battle-report">Battle report</h2>
          <p>
            {report.answered} of {report.stages.length} stages answered · overall{' '}
            {pct(report.score)}
            {endedEarly ? ' · you retreated early' : ''}
          </p>
        </div>
        <span
          className={`battle-grade big g-${report.grade}`}
          aria-label={`Overall grade ${report.grade}`}
        >
          {report.grade}
          <small>{gradeWord[report.grade]}</small>
        </span>
      </div>
      <details className="battle-scale">
        <summary>How grades work</summary>
        <p>
          Each STAR part counts at its best mark across a stage’s answer and follow-ups: Critical 3,
          Hit 2, Glancing 1, Missed 0. A stage’s score is its share of 12 points: S from 90%, A from
          75%, B from 55%, C from 35%, D below. The overall score averages every planned stage, so
          an unanswered or skipped stage counts as zero.{' '}
          {rules
            ? 'Demo mode marks answers with simple rules, not an AI assessment.'
            : 'Marks come from the Evaluator model.'}
        </p>
      </details>
      <ol className="battle-stages">
        {report.stages.map((s, i) => (
          <li key={s.step.questionId} className="battle-stage">
            <div className="battle-stage-head">
              <h3>
                {i + 1} · {s.step.label}
              </h3>
              <span className={`battle-status ${s.step.status}`}>{stageStatus[s.step.status]}</span>
              {s.grade ? (
                <span className={`battle-grade g-${s.grade}`} aria-label={`Grade ${s.grade}`}>
                  {s.grade}
                  <small>{pct(s.score!)}</small>
                </span>
              ) : (
                <span className="battle-grade none">–</span>
              )}
            </div>
            <p className="battle-question">“{s.question}”</p>
            {s.star ? (
              <div className="boss-star">
                {starParts.map((k) => (
                  <div key={k} className={`boss-mark ${s.star![k]}`}>
                    <span>{k.toUpperCase()}</span>
                    <b>{markLabel[s.star![k]]}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                {s.step.status === 'skipped' ? 'Skipped' : 'Not answered'}: this stage scores zero.
              </p>
            )}
            {s.rounds.map((r, j) => (
              <div key={j} className="battle-round">
                <span className="battle-round-kind">
                  {r.kind === 'answer' ? 'Your answer' : `Follow-up: “${r.prompt || ''}”`}
                </span>
                <details>
                  <summary>
                    {r.answer.length > 120 ? r.answer.slice(0, 117) + '…' : r.answer}
                  </summary>
                  <p>{r.answer}</p>
                </details>
                {r.evaluation.note && (
                  <p className="battle-note">
                    <b>Panel:</b> {r.evaluation.note}
                  </p>
                )}
              </div>
            ))}
            {s.stillWanted && (
              <p className="battle-wanted">
                <b>The panel still wanted to know:</b> {s.stillWanted}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
