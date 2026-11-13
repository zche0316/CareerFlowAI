import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AgentAvatar, agentProfiles, type AgentId } from './characters.js';

// Sign-in and registration in the Quest look (CFS-120): the product promise on the left, the
// form on the right. No demo or sample bypass; the account starts empty.

const party: AgentId[] = ['scout', 'matcher', 'selector', 'critic', 'interviewer'];
const promises = [
  [
    'Roles across regions',
    'Official boards and verifiable sources, one role library with no repeats.',
  ],
  [
    'Skills you can prove',
    'Levels 0–4 from the evidence you approve, including GitHub and certificates.',
  ],
  [
    'A resume per role',
    'Every line cites your own approved facts. You approve before anything is saved.',
  ],
];

export function SignIn({
  error,
  onSubmit,
}: {
  error: string;
  onSubmit: (path: 'login' | 'register', body: Record<string, string>) => Promise<void>;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [register, setRegister] = useState(false),
    [err, setErr] = useState(error),
    [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await onSubmit(register ? 'register' : 'login', {
        email,
        password,
        ...(register ? { name } : {}),
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="quest auth">
      <section className="auth-story" aria-labelledby="auth-pitch">
        <a href="/" className="auth-brand" aria-label="CareerFlow home">
          <img src="/careerflow-logo.svg" alt="" />
          careerflow
        </a>
        <span className="quest-chip lime">Technical roles · across regions</span>
        <h1 id="auth-pitch" className="quest-display">
          Find the role.
          <br />
          Prove the fit.
        </h1>
        <p>
          CareerFlow finds roles, shows what each region asks for, rates your skills from evidence
          you approve, and tailors a resume for every role you pursue. Applying stays with you.
        </p>
        <ul className="auth-promises" aria-label="What CareerFlow does">
          {promises.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <div className="auth-party" aria-label="Your party">
          {party.map((id) => (
            <span key={id} title={agentProfiles[id].name}>
              <AgentAvatar agent={id} size={40} label={false} />
            </span>
          ))}
          <small>Your party of agents works in your own workspace.</small>
        </div>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="quest-sub dark">
          {register ? 'NEW WORKSPACE' : 'WELCOME TO CAREERFLOW'}
        </span>
        <h2 id="auth-title">{register ? 'Create your workspace' : 'Welcome back.'}</h2>
        <p>
          {register
            ? 'Your profile, roles and documents stay in your own workspace.'
            : 'Sign in to pick up your quests.'}
        </p>
        {err && (
          <div role="alert" className="auth-error">
            {err}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {register && (
            <label>
              Your name
              <input
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength={10}
              required
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="quest-press lime auth-submit" disabled={busy}>
            {busy ? 'Opening…' : register ? 'Create workspace' : 'Sign in'}
            <ArrowRight size={17} strokeWidth={2.6} />
          </button>
        </form>
        <button type="button" className="auth-switch" onClick={() => setRegister(!register)}>
          {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </section>
    </div>
  );
}
