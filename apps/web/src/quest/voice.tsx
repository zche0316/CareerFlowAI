import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2 } from 'lucide-react';

// Speech input and read-aloud for interview practice (CFS-98, phase 1). Both use the browser's
// own speech services, so there is no model cost and CareerFlow never receives or stores audio:
// only the text the user chooses to submit. Controls are hidden where the browser lacks them.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

const recognitionClass = (): (new () => Recognition) | null => {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
const language = () => (navigator.language?.startsWith('en') ? navigator.language : 'en-AU');

/** A button that reads text aloud, and stops when pressed again or when the text changes. */
export function ReadAloud({ text, label = 'Read aloud' }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    // A new question or verdict stops the old one.
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [text]);
  useEffect(() => () => void (canSpeak() && window.speechSynthesis.cancel()), []);
  if (!canSpeak() || !text.trim()) return null;
  const toggle = () => {
    window.speechSynthesis.cancel();
    if (speaking) return setSpeaking(false);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = language();
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  return (
    <button
      type="button"
      className="text-button voice-read"
      aria-pressed={speaking}
      onClick={toggle}
    >
      <Volume2 size={15} aria-hidden="true" /> {speaking ? 'Stop reading' : label}
    </button>
  );
}

/**
 * Dictation into an answer box. It starts only when the user presses it, adds the words to the
 * editable answer and never submits anything.
 */
export function SpeakAnswer({
  disabled,
  onText,
}: {
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const rec = useRef<Recognition | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  const Recognition = typeof window === 'undefined' ? null : recognitionClass();
  if (!Recognition) return null;
  const stop = () => rec.current?.stop();
  const start = () => {
    setError('');
    const r = new Recognition();
    r.lang = language();
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let finalText = '';
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else pending += t;
      }
      if (finalText.trim()) onText(finalText.trim());
      setInterim(pending);
    };
    r.onerror = (e: any) =>
      setError(
        e?.error === 'not-allowed'
          ? 'Microphone access was blocked. Allow it in the browser, or type your answer.'
          : 'Speech input stopped. You can try again or type your answer.',
      );
    r.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    r.start();
    setListening(true);
  };
  return (
    <div className="voice-input">
      <button
        type="button"
        className={`quest-press${listening ? ' lime' : ''}`}
        disabled={disabled && !listening}
        aria-pressed={listening}
        onClick={listening ? stop : start}
      >
        {listening ? <Square size={15} /> : <Mic size={15} />}
        {listening ? 'Stop speaking' : 'Speak your answer'}
      </button>
      <small className="muted">
        {listening
          ? interim
            ? `Hearing: ${interim}`
            : 'Listening… your words appear in the answer box for you to edit.'
          : 'Your browser’s speech service turns speech into text. CareerFlow keeps only the text you submit, never audio.'}
      </small>
      {error && (
        <small role="alert" className="voice-error">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * Record one spoken answer and have the server transcribe it (CFS-139, live mode). Works in any
 * browser with a microphone; the words land in the editable answer box and nothing is submitted.
 */
export function RecordAnswer({
  disabled,
  transcribe,
  onText,
}: {
  disabled?: boolean;
  transcribe: (audio: Blob) => Promise<string>;
  onText: (text: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  if (typeof window === 'undefined' || !('MediaRecorder' in window) || !navigator.mediaDevices)
    return null;
  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setState('transcribing');
        try {
          const text = await transcribe(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
          if (text) onText(text);
          else setError('No speech was recognised. Try again closer to the microphone.');
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setState('idle');
        }
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setState('recording');
      timer.current = setInterval(
        () =>
          setSeconds((t) => {
            // About five minutes keeps one answer under the upload limit.
            if (t + 1 >= 290) r.stop();
            return t + 1;
          }),
        1000,
      );
    } catch (e) {
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser, or type your answer.'
          : (e as Error).message,
      );
    }
  };
  return (
    <div className="voice-input">
      <button
        type="button"
        className={`quest-press${state === 'recording' ? ' lime' : ''}`}
        disabled={(disabled && state !== 'recording') || state === 'transcribing'}
        aria-pressed={state === 'recording'}
        onClick={state === 'recording' ? () => rec.current?.stop() : start}
      >
        {state === 'recording' ? <Square size={15} /> : <Mic size={15} />}
        {state === 'recording'
          ? `Stop · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
          : state === 'transcribing'
            ? 'Transcribing…'
            : 'Record your answer'}
      </button>
      <small className="muted">
        Your recording is turned into text and then discarded. Edit the text before you send it.
      </small>
      {error && (
        <small role="alert" className="voice-error">
          {error}
        </small>
      )}
    </div>
  );
}
