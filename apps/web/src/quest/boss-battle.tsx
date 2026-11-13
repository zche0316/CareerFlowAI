import { useEffect, useState } from 'react';
import { ArrowRight, Flag, Swords } from 'lucide-react';
import { XP_RULES } from './progress.js';
import { ReadAloud, SpeakAnswer } from './voice.js';
import { VoiceInterviewer } from './voice-interviewer.js';

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
};

export const damageFor: Record<Mark, number> = { critical: 15, hit: 10, partial: 5, miss: 0 };
const markLabel: Record<Mark, string> = {
  critical: 'Critical',
  hit: 'Hit',
  partial: 'Glancing',
  miss: 'Missed',
};
export const roundDamage = (r: Round) =>
  Object.values(r.evaluation.star).reduce((n, m) => n + damageFor[m], 0);

/** Original panel of three stern interviewers. */
function Panel() {
  return (
    <svg
      role="img"
      aria-label="The panel: three interviewers behind a desk"
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
        d="M92 47q8-5 16 0"
        fill="none"
        stroke="#111218"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
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
  startVoice,
}: {
  /** Live mode only: a key for the realtime voice interviewer (CFS-136). */
  startVoice?: () => Promise<any>;
  mission: any;
  busy: boolean;
  onRound: (body: { questionId: string; answer: string; followUp: boolean }) => Promise<void>;
  onFinish: (endedEarly: boolean) => Promise<void>;
}) {
  const d = m.data || {};
  const questions: { id: string; question: string; focus: string }[] = d.questions || [];
  const rounds: Round[] = d.rounds || [];
  const live = m.status === 'AWAITING_INTERVIEW';
  const mainFor = (id: string) => rounds.find((r) => r.questionId === id && r.kind === 'answer');
  const followFor = (id: string) =>
    rounds.find((r) => r.questionId === id && r.kind === 'follow_up');
  const answered = questions.filter((q) => mainFor(q.id));
  const firstOpen = Math.max(
    0,
    questions.findIndex((q) => !mainFor(q.id)),
  );
  const [index, setIndex] = useState(firstOpen);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [text, setText] = useState('');
  const q = questions[Math.min(index, questions.length - 1)];
  const main = q ? mainFor(q.id) : undefined;
  const pendingFollow =
    live && main?.evaluation.followUp && !followFor(q.id) && !skipped.includes(q.id)
      ? main.evaluation.followUp
      : '';
  useEffect(() => setText(''), [q?.id, pendingFollow, rounds.length]);
  // Once a question is settled (answered, follow-up done or skipped), move to the next open one.
  useEffect(() => {
    if (!live || !main || pendingFollow) return;
    const next = questions.findIndex((x) => !mainFor(x.id));
    if (next >= 0) setIndex(next);
  }, [rounds.length, skipped.length]);
  const last = rounds.at(-1);

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
  const total = rounds.reduce((n, r) => n + roundDamage(r), 0);
  const allDone = questions.length > 0 && answered.length === questions.length;

  const prompt = pendingFollow || q?.question;
  const submit = async () => {
    if (!q || !text.trim()) return;
    await onRound({ questionId: q.id, answer: text.trim(), followUp: Boolean(pendingFollow) });
  };
  const nextQuestion = () => {
    if (q) setSkipped((s) => [...s, q.id]);
    const next = questions.findIndex((x, i) => i > index && !mainFor(x.id));
    if (next >= 0) setIndex(next);
  };

  const showChoices = claims.length > 0 || Boolean(lesson);

  return (
    <div className="quest-page boss">
      <section className="quest-tile ink boss-arena" aria-label="Arena">
        <div className="boss-foe">
          <Panel />
          <div className="boss-hp-head">
            <span>The Panel</span>
            <span>
              {questions.length - answered.length} of {questions.length} question
              {questions.length === 1 ? '' : 's'} left
            </span>
          </div>
          <div
            className="boss-hp"
            role="img"
            aria-label={`${questions.length - answered.length} of ${questions.length} questions left`}
          >
            {questions.map((x) => (
              <span key={x.id} className={mainFor(x.id) ? 'gone' : ''} />
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
          <div className="boss-qtabs" role="group" aria-label="Questions">
            {questions.map((x, i) => (
              <button
                key={x.id}
                type="button"
                className={`boss-qtab${i === index ? ' on' : ''}${mainFor(x.id) ? ' done' : ''}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                Q{i + 1}
              </button>
            ))}
          </div>
          {q && (
            <>
              <span className="quest-chip coral">
                {pendingFollow ? 'The panel counters' : `Question ${index + 1} · ${q.focus}`}
              </span>
              <p className="boss-bubble">“{prompt}”</p>
              <ReadAloud text={prompt || ''} label="Read the question aloud" />
              <small className="boss-fine">
                The Evaluator can follow up once per answer. Practice answers never become profile
                facts.
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
            {main && !pendingFollow ? (
              <p className="quest-note">
                You answered this one. Answer again to replace it, or pick another question.
              </p>
            ) : null}
            {startVoice && !pendingFollow && (
              <VoiceInterviewer
                start={startVoice}
                disabled={busy}
                onAnswer={(questionId, answer) => onRound({ questionId, answer, followUp: false })}
              />
            )}
            <label className="quest-field">
              {pendingFollow ? 'Your follow-up answer' : 'Your answer'}
              <textarea
                rows={6}
                maxLength={6000}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                placeholder="Situation, what you were asked to do, what you personally did, and what changed. Real experience only."
              />
            </label>
            <SpeakAnswer
              disabled={busy}
              onText={(words) => setText((t) => (t ? `${t} ` : '') + words)}
            />
            {showChoices && (
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
                      <span className="quest-chip ink">{c.factId}</span>
                      {c.text.length > 70 ? c.text.slice(0, 67) + '…' : c.text}
                    </button>
                  ))}
                  {lesson && (
                    <p className="boss-item lesson">
                      <span className="quest-chip lilac">Lesson</span>
                      {lesson.length > 90 ? lesson.slice(0, 87) + '…' : lesson}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="boss-actions">
              <button
                type="button"
                className="quest-press lime"
                disabled={busy || !text.trim()}
                onClick={() => void submit()}
              >
                <Swords size={18} />
                {busy ? 'The panel is scoring…' : pendingFollow ? 'Answer the follow-up' : 'Answer'}
              </button>
              {pendingFollow && (
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
                disabled={busy || answered.length === 0}
                onClick={() => void onFinish(!allDone)}
              >
                <Flag size={16} />
                {allDone ? 'Finish battle · get feedback' : 'Retreat · get feedback now'}
              </button>
            </div>
          </section>
        ) : (
          <section className="quest-tile boss-turn" aria-labelledby="boss-done">
            <h2 id="boss-done">Battle over</h2>
            <p>
              {answered.length} of {questions.length} questions answered · {total} total damage.
              {d.endedEarly ? ' You retreated early; feedback covers the answers you gave.' : ''}
            </p>
          </section>
        )}

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
      </div>
    </div>
  );
}
