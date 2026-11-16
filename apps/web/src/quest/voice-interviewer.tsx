import { useEffect, useRef, useState } from 'react';
import { Mic, PhoneOff, Volume2 } from 'lucide-react';
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
type Line = { who: 'panel' | 'you'; text: string; note?: boolean };

/** What the battle view shows while a call runs (CFS-170): who is talking and what is said. */
export type LiveCall = {
  phase: 'idle' | 'connecting' | 'live' | 'saving' | 'done';
  speaker: 'panel' | 'you' | null;
  questionId: string | null;
  caption: string;
  // Your latest transcribed reply (CFS-172): the arena shows one exchange at a time, like
  // subtitles, while the full transcript stays folded away.
  yours: string;
};

/** "Question 2." in the panel's speech moves the answer pointer to the second question. */
export function questionNumber(text: string) {
  const m = /\bquestion\s+(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) - 1 : null;
}

export function VoiceInterviewer({
  start,
  onAnswer,
  onLive,
  disabled,
}: {
  start: () => Promise<Session>;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onLive?: (call: LiveCall) => void;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<LiveCall['phase']>('idle');
  const [speaker, setSpeaker] = useState<LiveCall['speaker']>(null);
  const [caption, setCaption] = useState('');
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [yours, setYours] = useState('');
  useEffect(() => {
    onLive?.({ phase, speaker, questionId, caption, yours });
  }, [phase, speaker, questionId, caption, yours]);
  const [lines, setLines] = useState<Line[]>([]);
  // The transcript box keeps its height and follows the newest line.
  const log = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines.length]);
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
  // Silent failures made visible (CFS-175): a browser that blocks the panel's audio, and a
  // microphone that delivers only silence (an embedded browser or an app without mic permission).
  const [blocked, setBlocked] = useState(false);
  const [level, setLevel] = useState(0);
  const [micSilent, setMicSilent] = useState(false);
  const meter = useRef<{ ctx: AudioContext; poll: ReturnType<typeof setInterval> } | null>(null);

  const listen = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let loudest = 0;
      const started = Date.now();
      const poll = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        loudest = Math.max(loudest, rms);
        setLevel(Math.min(1, rms * 8));
        // Speech is far above 0.01; a dead or blocked microphone stays near zero.
        setMicSilent(Date.now() - started > 6000 && loudest < 0.004);
      }, 200);
      meter.current = { ctx, poll };
    } catch {
      /* no Web Audio: the call still works, without the meter */
    }
  };

  const hangUp = () => {
    if (timer.current) clearInterval(timer.current);
    if (meter.current) {
      clearInterval(meter.current.poll);
      void meter.current.ctx.close().catch(() => {});
      meter.current = null;
    }
    setLevel(0);
    mic.current?.getTracks().forEach((t) => t.stop());
    pc.current?.close();
    pc.current = null;
    setSpeaker(null);
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
    setCaption('');
    setYours('');
    setQuestionId(null);
    setBlocked(false);
    setMicSilent(false);
    setPhase('connecting');
    try {
      const s = await start();
      session.current = s;
      setQuestionId(s.questions[0]?.id || null);
      const conn = new RTCPeerConnection();
      pc.current = conn;
      conn.ontrack = (e) => {
        if (!audio.current) return;
        audio.current.srcObject = e.streams[0];
        // Some browsers, embedded ones especially, refuse to autoplay: offer a button instead.
        audio.current.play().catch(() => setBlocked(true));
      };
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      listen(mic.current);
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
        // Who is talking drives the panel's animation in the arena.
        if (event.type === 'input_audio_buffer.speech_started') {
          setSpeaker('you');
          setYours('');
        }
        if (event.type === 'input_audio_buffer.speech_stopped') setSpeaker(null);
        if (event.type === 'output_audio_buffer.started') setSpeaker('panel');
        if (event.type === 'output_audio_buffer.stopped') setSpeaker(null);
        if (event.type === 'response.created') setCaption('');
        if (event.type === 'response.output_audio_transcript.delta')
          setCaption((c) => c + String(event.delta || ''));
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          const text = String(event.transcript || '').trim();
          // A turn that was heard but held no words shows up, so a silent mic is visible.
          if (!text)
            return setLines((l) => [
              ...l,
              { who: 'you', text: '(no words recognised in this reply)', note: true },
            ]);
          const q = s.questions[current.current];
          if (q) (answers.current[q.id] ||= []).push(text);
          setYours((y) => (y ? `${y} ${text}` : text));
          setLines((l) => [...l, { who: 'you', text }]);
        }
        if (event.type === 'conversation.item.input_audio_transcription.failed')
          setLines((l) => [
            ...l,
            {
              who: 'you',
              text: `(this reply could not be transcribed${event.error?.message ? `: ${event.error.message}` : ''})`,
              note: true,
            },
          ]);
        if (event.type === 'error' && event.error?.message)
          setError(`The voice service reported: ${event.error.message}`);
        if (event.type === 'response.output_audio_transcript.done') {
          const text = String(event.transcript || event.text || '').trim();
          if (!text) return;
          const n = questionNumber(text);
          if (n !== null && n >= 0 && n < s.questions.length) {
            current.current = n;
            setQuestionId(s.questions[n].id);
          }
          setCaption(text);
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
          {phase !== 'live' && (
            <small className="muted">
              Up to 10 minutes, billed per minute of audio. When you hang up, each answer is scored
              like a typed one.
            </small>
          )}
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
          <span
            className="voice-meter"
            role="img"
            aria-label={micSilent ? 'Microphone: silent' : 'Microphone level'}
          >
            <Mic size={14} aria-hidden="true" />
            <i style={{ width: `${Math.round(level * 100)}%` }} />
          </span>
          <button type="button" className="quest-press" onClick={() => void finish()}>
            <PhoneOff size={16} /> End and score my answers
          </button>
        </div>
      )}
      {phase === 'live' && blocked && (
        <p className="voice-warn" role="alert">
          This browser blocked the panel’s voice.{' '}
          <button
            type="button"
            className="quest-press lime"
            onClick={() =>
              void audio.current
                ?.play()
                .then(() => setBlocked(false))
                .catch(() => {})
            }
          >
            <Volume2 size={16} /> Play the panel’s voice
          </button>
        </p>
      )}
      {phase === 'live' && micSilent && (
        <p className="voice-warn" role="alert">
          Your microphone is sending silence, so the panel cannot hear you. Allow this browser to
          use the microphone (macOS: System Settings → Privacy &amp; Security → Microphone), check
          the input device, or open the page in Chrome or Safari instead of an editor’s built-in
          browser.
        </p>
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
        // While the call runs, the arena shows the current exchange; the full log is folded
        // here, opens on demand and keeps a fixed height. After the call it opens for review.
        <details className="voice-log" open={phase === 'done' || undefined}>
          <summary>
            Transcript · {lines.length} line{lines.length === 1 ? '' : 's'}
          </summary>
          <ol ref={log} className="voice-transcript" aria-label="Interview transcript">
            {lines.map((l, i) => (
              <li key={i} className={`line-${l.who}${l.note ? ' line-note' : ''}`}>
                <b>{l.who === 'panel' ? 'Panel' : 'You'}</b> {l.text}
              </li>
            ))}
          </ol>
        </details>
      )}
      {error && (
        <p role="alert" className="voice-error">
          {error}
        </p>
      )}
    </section>
  );
}
