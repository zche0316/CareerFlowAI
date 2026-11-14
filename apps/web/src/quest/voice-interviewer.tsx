import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { AgentAvatar } from './characters.js';

// Live voice interviewer (CFS-136). The server hands out a one-minute key for one realtime
// session that already knows the panel's instructions and this run's questions; audio flows
// between the browser and the model over WebRTC. When the interview ends, each answer's
// transcript is submitted like a typed answer and the Evaluator scores it. No audio is stored.

type Session = {
  clientSecret: string;
  callsUrl: string;
  limitSeconds: number;
  questions: { id: string; question: string }[];
  remaining: number;
};
type Line = { who: 'panel' | 'you'; text: string };

/** "Question 2." in the panel's speech moves the answer pointer to the second question. */
export function questionNumber(text: string) {
  const m = /\bquestion\s+(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) - 1 : null;
}

export function VoiceInterviewer({
  start,
  onAnswer,
  disabled,
}: {
  start: () => Promise<Session>;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'live' | 'saving' | 'done'>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [saved, setSaved] = useState(0);
  const pc = useRef<RTCPeerConnection | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const session = useRef<Session | null>(null);
  const current = useRef(0);
  const answers = useRef<Record<string, string[]>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const hangUp = () => {
    if (timer.current) clearInterval(timer.current);
    mic.current?.getTracks().forEach((t) => t.stop());
    pc.current?.close();
    pc.current = null;
  };
  useEffect(() => () => hangUp(), []);

  const finish = async () => {
    hangUp();
    const s = session.current;
    if (!s) return setPhase('idle');
    setPhase('saving');
    let count = 0;
    for (const q of s.questions) {
      const text = (answers.current[q.id] || []).join(' ').trim();
      if (text.split(/\s+/).length < 4) continue;
      try {
        await onAnswer(q.id, text);
        count++;
        setSaved(count);
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setPhase('done');
  };

  const begin = async () => {
    setError('');
    setLines([]);
    answers.current = {};
    current.current = 0;
    setPhase('connecting');
    try {
      const s = await start();
      session.current = s;
      const conn = new RTCPeerConnection();
      pc.current = conn;
      conn.ontrack = (e) => {
        if (audio.current) audio.current.srcObject = e.streams[0];
      };
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      conn.addTrack(mic.current.getTracks()[0], mic.current);
      const channel = conn.createDataChannel('oai-events');
      channel.addEventListener('open', () =>
        channel.send(JSON.stringify({ type: 'response.create' })),
      );
      channel.addEventListener('message', (e) => {
        let event: any;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          const text = String(event.transcript || '').trim();
          if (!text) return;
          const q = s.questions[current.current];
          if (q) (answers.current[q.id] ||= []).push(text);
          setLines((l) => [...l, { who: 'you', text }]);
        }
        if (event.type === 'response.output_audio_transcript.done') {
          const text = String(event.transcript || event.text || '').trim();
          if (!text) return;
          const n = questionNumber(text);
          if (n !== null && n >= 0 && n < s.questions.length) current.current = n;
          setLines((l) => [...l, { who: 'panel', text }]);
        }
      });
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      const answer = await fetch(s.callsUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${s.clientSecret}`, 'Content-Type': 'application/sdp' },
      });
      if (!answer.ok) {
        const detail = await answer
          .json()
          .then((j) => j?.error?.message as string | undefined)
          .catch(() => undefined);
        throw Error(
          `The voice service did not accept the call (${answer.status})${detail ? `: ${detail}` : ''}. Type your answers instead.`,
        );
      }
      await conn.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      setSeconds(0);
      setPhase('live');
      timer.current = setInterval(
        () =>
          setSeconds((t) => {
            if (t + 1 >= s.limitSeconds) void finish();
            return t + 1;
          }),
        1000,
      );
    } catch (e) {
      hangUp();
      setPhase('idle');
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser, or type your answers.'
          : (e as Error).message,
      );
    }
  };

  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return (
    <section className="quest-tile voice-live" aria-labelledby="voice-live">
      <div className="voice-live-head">
        <AgentAvatar agent="interviewer" size={40} label={false} />
        <div>
          <h3 id="voice-live">Live voice interview</h3>
          <small className="muted">
            The panel asks the questions out loud and you answer by speaking. Your answers are then
            scored like typed ones. Live mode, billed per minute of audio; up to 10 minutes.
          </small>
        </div>
      </div>
      <audio ref={audio} autoPlay />
      {phase === 'idle' && (
        <button type="button" className="quest-press lime" disabled={disabled} onClick={begin}>
          <Mic size={16} /> Start the voice interview
        </button>
      )}
      {phase === 'connecting' && <p role="status">Connecting to the panel…</p>}
      {phase === 'live' && (
        <div className="voice-live-bar">
          <span className="voice-dot" aria-hidden="true" /> Live · {mmss(seconds)} /{' '}
          {mmss(session.current?.limitSeconds || 600)}
          <button type="button" className="quest-press" onClick={() => void finish()}>
            <PhoneOff size={16} /> End and score my answers
          </button>
        </div>
      )}
      {phase === 'saving' && <p role="status">Scoring your answers… {saved} saved</p>}
      {phase === 'done' && (
        <p role="status">
          {saved
            ? `${saved} spoken answer${saved === 1 ? '' : 's'} scored. See the panel’s verdict below.`
            : 'No answer was long enough to score. Try again or type your answers.'}
        </p>
      )}
      {lines.length > 0 && (
        <ol className="voice-transcript" aria-label="Interview transcript">
          {lines.map((l, i) => (
            <li key={i} className={l.who}>
              <b>{l.who === 'panel' ? 'Panel' : 'You'}</b> {l.text}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
    </section>
  );
}
