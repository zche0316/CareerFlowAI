import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowRight, Radar, Trash2 } from 'lucide-react';
import { countries } from '../../../../packages/recruitment/src/geography.js';
import { workRightsLabels, type JobRecord } from '../../../../packages/contracts/src/job-record.js';
import { AgentAvatar, agentProfiles, type AgentId } from './characters.js';
import { stageCopy } from './applications.js';

type Package = {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string | null;
  score: number;
  missionId: string | null;
  status: string | null;
  approved: boolean;
  critic: string | null;
  record: JobRecord;
};
type Sweep = {
  id: string;
  status: string;
  trigger: string;
  mode: string;
  calls: number;
  createdAt: string;
  fetched: number | null;
  fresh: number | null;
  alreadySeen: number | null;
  duplicates: number | null;
  reposted: number | null;
  reviewed: number | null;
  notReviewed: number | null;
  failures: { provider: string; message: string }[];
  limitations: string[];
  webDiscovery: {
    pagesFound: number;
    pagesRead: number;
    accepted: number;
    rejected: { url: string; reason: string }[];
  } | null;
  agentDiscovery: {
    searches: number;
    pagesOpenedByModel: number;
    reported: number;
    checked: number;
    leads: number;
    rejected: { url: string; reason: string }[];
  } | null;
  leads: number | null;
  handoffs: { at: string; from: string; to: string; reason: string }[];
  error: string | null;
  packages: Package[];
};
type Setting = {
  enabled: boolean;
  topK: number;
  minScore: number;
  search: {
    provider: string;
    country: string;
    keyword: string;
    location: string;
    [k: string]: any;
  };
};
type Overview = {
  setting: Setting;
  schedule: { cron: string; timeZone: string };
  limits: { reviewPerSweep: number; sweepsPerDay: number };
  modelSearchAvailable: boolean;
  webSearchAvailable: boolean;
  trackedTotal: number;
  tracked: {
    fingerprint: string;
    firstSeenAt: string;
    record: JobRecord;
    board: { id: string; stage: string } | null;
  }[];
  sweeps: Sweep[];
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const busyStatus = (s: string | null) => s === 'QUEUED' || s === 'RUNNING';

// Scout's own source choices; any other saved provider still shows under its raw name.
// Two tiers: the Tavily-based sources are cheap and quick but find few roles; model web search
// finds far more (see docs/EVALUATION.md, "Discovery comparison") and costs much more per sweep.
const sources: [string, string][] = [
  ['auto', 'Official boards + web pages · low cost'],
  ['employers', 'Official employer boards only · low cost'],
  ['web', 'Web pages only · low cost'],
];
const modelSource: [string, string] = ['agent', 'Model web search · finds most, costs more'];
const sourceHint: Record<string, string> = {
  auto: 'Quick and cheap: one search per board type, a few model reads. Usually finds only a handful of new roles.',
  employers:
    'Quick and cheap: only roles confirmed through official Greenhouse, Lever or Ashby boards.',
  web: 'Quick and cheap: one web search and at most eight page reads. Often finds one role or none.',
  agent:
    'A model searches the web for several minutes and reports up to 25 roles. Pages Scout may read are checked; the rest (for example SEEK) become leads you open and paste. Roughly 25 times the tokens of the low-cost sources.',
};
const sourceLabel = (r: JobRecord) =>
  r.fictional
    ? 'demo role'
    : r.lead
      ? r.pasted
        ? 'lead · ad pasted by you'
        : 'lead · not checked'
      : r.source === 'lead'
        ? 'ad pasted by you'
        : r.source === 'web'
          ? 'web page · unverified vacancy'
          : r.source === 'agent'
            ? 'model search · page checked · unverified vacancy'
            : r.source;

// What a package's quest status means for the person reviewing the batch.
function packageState(p: Package): { label: string; tone: string } {
  if (!p.missionId || !p.status) return { label: 'Starting', tone: 'outline' };
  if (p.status === 'CANCELLED') return { label: 'Discarded', tone: 'outline' };
  if (p.status === 'FAILED') return { label: 'Needs a retry', tone: 'coral' };
  if (p.status === 'AWAITING_APPROVAL') return { label: 'Draft ready · your call', tone: 'lime' };
  if (p.approved) return { label: 'Approved by you', tone: 'ink' };
  if (busyStatus(p.status)) return { label: 'Resume team at work', tone: 'lilac' };
  return { label: p.status.toLowerCase().replace(/_/g, ' '), tone: 'outline' };
}

const who: Record<string, AgentId | 'you'> = {
  scout: 'scout',
  job_matcher: 'matcher',
  resume_team: 'rewriter',
  human_review: 'you',
};
const names: Record<string, string> = {
  scout: 'Scout',
  job_matcher: 'Job Matcher',
  resume_team: 'Resume team',
  human_review: 'You',
  report: 'Sweep report',
};

const money = (r: JobRecord) => {
  const s = r.salary;
  if (!s || (s.annualMin === null && s.annualMax === null)) return null;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const range =
    s.annualMin !== null && s.annualMax !== null && s.annualMax !== s.annualMin
      ? `${k(s.annualMin)}–${k(s.annualMax)}`
      : k((s.annualMin ?? s.annualMax)!);
  return `${s.currency} ${range}/yr${s.period === 'year' ? '' : ' (converted)'}`;
};

export function QuestScout({
  hasProfile,
  request,
  onOpenMission,
  onBuildProfile,
  onChanged,
}: {
  hasProfile: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onOpenMission: (id: string, step: number) => void;
  onBuildProfile: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  // The lead whose advertisement the user is pasting, and the text so far.
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Setting | null>(null);
  const [saved, setSaved] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const live = useRef(true);

  const load = async () => {
    try {
      const d: Overview = await request('/scout');
      if (!live.current) return;
      setData(d);
      setForm((f) => f || d.setting);
    } catch (e: any) {
      if (live.current) setError(e.message || 'Scout is unavailable.');
    }
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, []);

  const latest = data?.sweeps[0];
  const working =
    Boolean(latest && busyStatus(latest.status)) ||
    Boolean(data?.sweeps.some((s) => s.packages.some((p) => busyStatus(p.status))));
  // Poll only while Scout or a resume team is actually working.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [working]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
      onChanged();
    } catch (e: any) {
      setError(e.message || 'That did not work. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  if (!hasProfile)
    return (
      <div className="quest-page">
        <section className="quest-tile">
          <h1 className="quest-display">Scout needs a profile first</h1>
          <p>Scout compares new roles with your approved facts, so approve a profile to start.</p>
          <button type="button" className="quest-press lime" onClick={onBuildProfile}>
            Build my profile
          </button>
        </section>
      </div>
    );
  if (!data || !form) return <p className="quest-fine dark">{error || 'Loading Scout…'}</p>;

  const packages = data.sweeps.flatMap((s) => s.packages.map((p) => ({ ...p, sweep: s })));
  const open = packages.filter((p) => p.status !== 'CANCELLED');
  const ready = open.filter((p) => p.status === 'AWAITING_APPROVAL').length;
  const live_ = data.setting.search.provider !== 'fixtures';

  return (
    <div className="quest-page sc">
      <section className="quest-tile ink sc-hero" aria-labelledby="sc-title">
        <div className="sc-hero-copy">
          <span className="quest-chip dark">
            {data.setting.enabled
              ? `Daily sweep on · 07:00 ${data.schedule.timeZone.split('/')[1]}`
              : 'Daily sweep off'}
          </span>
          <h1 id="sc-title" className="quest-display">
            Scout finds the roles. You make the calls.
          </h1>
          <p>
            Each sweep reads{' '}
            {!live_
              ? 'the labelled demo roles'
              : data.setting.search.provider === 'employers'
                ? 'official employer job boards'
                : data.setting.search.provider === 'web'
                  ? 'public web pages found by search'
                  : data.setting.search.provider === 'agent'
                    ? 'what a model finds with its own web search, checked page by page'
                    : 'public job boards'}
            , skips anything you have already seen, and hands the best new matches to a resume team
            each. Nothing is sent anywhere, and no draft is approved without you.
          </p>
          <div className="sc-hero-actions">
            <button
              type="button"
              className="quest-press lime"
              disabled={busy || Boolean(latest && busyStatus(latest.status))}
              onClick={() => void act(() => request('/scout/sweeps', 'POST', {}))}
            >
              <Radar size={18} />
              {latest && busyStatus(latest.status) ? 'Scout is out…' : 'Send Scout out now'}
            </button>
            <span className="quest-sub">
              Up to {data.limits.sweepsPerDay} sweeps a day
              {live_
                ? ` · the model scores at most ${data.limits.reviewPerSweep} roles per sweep`
                : ''}
            </span>
          </div>
        </div>
        <div className="sc-hero-side">
          <AgentAvatar agent="scout" size={96} />
          <dl className="sc-stats">
            <div>
              <dt>Roles on record</dt>
              <dd>{data.trackedTotal}</dd>
            </div>
            <div>
              <dt>Drafts waiting on you</dt>
              <dd>{ready}</dd>
            </div>
          </dl>
        </div>
      </section>

      {error && (
        <p role="alert" className="quest-note coral">
          {error}
        </p>
      )}

      <section className="quest-tile" aria-labelledby="sc-batch">
        <div className="quest-tile-head">
          <h2 id="sc-batch">Batch review</h2>
          <span>
            {open.length
              ? `${open.length} package${open.length === 1 ? '' : 's'} · ${ready} ready for you`
              : 'No packages yet'}
          </span>
        </div>
        {open.length === 0 ? (
          <p className="quest-fine dark">
            When a sweep finds new roles above your minimum match, one resume team per role starts
            in parallel and their drafts land here together.
          </p>
        ) : (
          <ul className="sc-packs">
            {open.map((p) => {
              const state = packageState(p);
              const rights = p.record.workRights;
              return (
                <li key={p.sweep.id + p.jobId} className="sc-pack">
                  <div className="sc-pack-top">
                    <span className="sc-score" aria-label={`Match score ${p.score}`}>
                      {p.score}
                    </span>
                    <div className="sc-pack-title">
                      <strong>{p.title}</strong>
                      <span>
                        {p.company} · {p.location}
                        {p.record.source === 'web' && ` · ${sourceLabel(p.record)}`}
                      </span>
                    </div>
                    <span className={`quest-chip ${state.tone}`}>{state.label}</span>
                    {p.critic && p.status === 'AWAITING_APPROVAL' && (
                      <span className="quest-chip outline">
                        Critic: {p.critic === 'passed' ? 'passed it' : 'left open issues'}
                      </span>
                    )}
                  </div>
                  <p className="sc-quote">
                    {rights ? (
                      <>
                        <b>{workRightsLabels[rights.value]}:</b> “{rights.quote}”
                      </>
                    ) : (
                      'Work rights: not stated in this listing.'
                    )}
                  </p>
                  <div className="sc-pack-actions">
                    {p.missionId && (
                      <button
                        type="button"
                        className={`quest-press${p.status === 'AWAITING_APPROVAL' ? ' lime' : ''}`}
                        onClick={() => onOpenMission(p.missionId!, 3)}
                      >
                        {p.status === 'AWAITING_APPROVAL' ? 'Review the draft' : 'Open the quest'}
                        <ArrowRight size={16} />
                      </button>
                    )}
                    {p.url && (
                      <a className="sc-link" href={p.url} target="_blank" rel="noreferrer">
                        Original listing
                      </a>
                    )}
                    {p.missionId &&
                      !p.approved &&
                      p.status !== 'COMPLETE' &&
                      (discarding === p.missionId ? (
                        <span className="sc-confirm">
                          Discard this package?
                          <button
                            type="button"
                            className="sc-link"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await request(`/missions/${p.missionId}/cancel`, 'POST', {});
                                setDiscarding(null);
                              })
                            }
                          >
                            Yes, discard
                          </button>
                          <button
                            type="button"
                            className="sc-link"
                            onClick={() => setDiscarding(null)}
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="sc-link"
                          onClick={() => setDiscarding(p.missionId)}
                        >
                          <Trash2 size={14} aria-hidden="true" /> Discard
                        </button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="sc-cols">
        <section className="quest-tile" aria-labelledby="sc-log">
          <div className="quest-tile-head">
            <h2 id="sc-log">Sweep log</h2>
            <span>
              {data.sweeps.length === 1 ? 'Latest sweep' : `Last ${data.sweeps.length} sweeps`}
            </span>
          </div>
          {data.sweeps.length === 0 && (
            <p className="quest-fine dark">Scout has not been out yet.</p>
          )}
          <ol className="sc-sweeps">
            {data.sweeps.map((s) => (
              <li key={s.id} className="sc-sweep">
                <div className="sc-sweep-head">
                  <strong>{when(s.createdAt)}</strong>
                  <span className="quest-chip outline">
                    {s.trigger === 'schedule' ? 'Scheduled' : 'Sent by you'}
                  </span>
                  <span
                    className={`quest-chip ${s.status === 'FAILED' ? 'coral' : s.status === 'COMPLETE' ? 'lime' : 'lilac'}`}
                  >
                    {s.status === 'COMPLETE'
                      ? 'Done'
                      : s.status === 'FAILED'
                        ? 'Failed'
                        : 'Out now'}
                  </span>
                </div>
                {s.fetched !== null && (
                  <p className="sc-counts">
                    {s.fetched} fetched · <b>{s.fresh} new</b>
                    {s.reposted ? ` (${s.reposted} re-advertised)` : ''} · {s.alreadySeen} seen
                    before · {s.duplicates} duplicate{s.duplicates === 1 ? '' : 's'} across boards
                    {s.reviewed !== null && ` · ${s.reviewed} scored`}
                    {s.notReviewed ? ` · ${s.notReviewed} not scored (call limit)` : ''}
                    {s.mode !== 'fixture' && ` · ${s.calls} model calls`}
                  </p>
                )}
                {s.agentDiscovery && (
                  <p className="sc-counts">
                    Model search: {s.agentDiscovery.searches} searches · {s.agentDiscovery.reported}{' '}
                    roles reported · <b>{s.agentDiscovery.checked} pages checked</b> ·{' '}
                    {s.agentDiscovery.leads} leads to open yourself ·{' '}
                    {s.agentDiscovery.rejected.length} rejected
                  </p>
                )}
                {s.webDiscovery && (
                  <p className="sc-counts">
                    Web: read {s.webDiscovery.pagesRead} of {s.webDiscovery.pagesFound} pages ·{' '}
                    {s.webDiscovery.accepted} accepted · {s.webDiscovery.rejected.length} rejected
                  </p>
                )}
                {s.error && <p className="quest-note coral">{s.error}</p>}
                {s.failures.map((f, i) => (
                  <p key={i} className="quest-note coral">
                    <b>{f.provider}:</b> {f.message}
                  </p>
                ))}
                {s.handoffs.length > 0 && (
                  <ul className="sc-handoffs">
                    {s.handoffs.map((h, i) => (
                      <li key={i}>
                        {who[h.from] && who[h.from] !== 'you' && (
                          <AgentAvatar agent={who[h.from] as AgentId} size={22} label={false} />
                        )}
                        <span>
                          <b>
                            {names[h.from] || h.from} → {names[h.to] || h.to}
                          </b>{' '}
                          {h.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="quest-tile violet" aria-labelledby="sc-orders">
          <div className="quest-tile-head">
            <h2 id="sc-orders">Scout’s orders</h2>
            <span>{agentProfiles.scout.quote}</span>
          </div>
          <form
            className="sc-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const next = await request('/scout/settings', 'PUT', {
                  enabled: form.enabled,
                  topK: form.topK,
                  minScore: form.minScore,
                  search: {
                    provider: form.search.provider,
                    board: form.search.board,
                    country: form.search.country,
                    region: form.search.region || '',
                    location: form.search.location,
                    keyword: form.search.keyword,
                  },
                });
                setForm(next);
                setSaved(true);
              });
            }}
            onChange={() => setSaved(false)}
          >
            <label className="quest-check">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Sweep every day at 07:00 ({data.schedule.timeZone})
            </label>
            <label className="quest-field">
              Sources
              <select
                value={form.search.provider}
                onChange={(e) =>
                  setForm({ ...form, search: { ...form.search, provider: e.target.value } })
                }
              >
                {form.search.provider === 'fixtures' ? (
                  <option value="fixtures" disabled>
                    Demo roles (fixture mode)
                  </option>
                ) : (
                  <>
                    {[...sources, ...(data.modelSearchAvailable ? [modelSource] : [])].map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                    {![...sources, ...(data.modelSearchAvailable ? [modelSource] : [])].some(
                      ([value]) => value === form.search.provider,
                    ) && (
                      <option value={form.search.provider}>
                        {form.search.provider === 'agent'
                          ? `${modelSource[1]} · unavailable on this server`
                          : form.search.provider}
                      </option>
                    )}
                  </>
                )}
              </select>
            </label>
            {sourceHint[form.search.provider] && (
              <p className="quest-fine">
                {sourceHint[form.search.provider]}
                {data.modelSearchAvailable &&
                  form.search.provider !== 'agent' &&
                  ' Model web search is available on this server and finds far more roles.'}
                {!data.webSearchAvailable &&
                  ['auto', 'web', 'agent'].includes(form.search.provider) &&
                  (form.search.provider === 'auto'
                    ? ' Web pages are skipped on this server because no Tavily key is set, so only official boards are searched.'
                    : ' No Tavily key is set on this server, so web pages cannot be read.')}
              </p>
            )}
            <label className="quest-field">
              Role keywords
              <input
                type="text"
                maxLength={150}
                value={form.search.keyword}
                onChange={(e) =>
                  setForm({ ...form, search: { ...form.search, keyword: e.target.value } })
                }
              />
            </label>
            <div className="sc-form-row">
              <label className="quest-field">
                Realm
                <select
                  value={form.search.country}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      search: { ...form.search, country: e.target.value, region: '' },
                    })
                  }
                >
                  {countries.map((c: any) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="quest-field">
                City
                <input
                  type="text"
                  maxLength={150}
                  value={form.search.location}
                  onChange={(e) =>
                    setForm({ ...form, search: { ...form.search, location: e.target.value } })
                  }
                />
              </label>
            </div>
            <div className="sc-form-row">
              <label className="quest-field">
                Packages per sweep
                <select
                  value={form.topK}
                  onChange={(e) => setForm({ ...form, topK: Number(e.target.value) })}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="quest-field">
                Minimum match
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.minScore}
                  onChange={(e) => setForm({ ...form, minScore: Number(e.target.value) })}
                />
              </label>
            </div>
            <button type="submit" className="quest-press ink" disabled={busy}>
              Save orders
            </button>
            {saved && (
              <span role="status" className="quest-sub dark">
                Saved. The next sweep uses these.
              </span>
            )}
          </form>
        </section>
      </div>

      <section className="quest-tile" aria-labelledby="sc-records">
        <div className="quest-tile-head">
          <h2 id="sc-records">Roles on record</h2>
          <span>
            {data.trackedTotal
              ? `Latest ${data.tracked.length} of ${data.trackedTotal} from Scout and Find roles · every field quotes the listing or stays empty`
              : 'Empty until your first search'}
          </span>
        </div>
        {data.tracked.length > 0 && (
          <div className="sc-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">First seen</th>
                  <th scope="col">Work rights</th>
                  <th scope="col">Arrangement</th>
                  <th scope="col">Level</th>
                  <th scope="col">Salary</th>
                </tr>
              </thead>
              <tbody>
                {data.tracked.map((t) => {
                  const r = t.record;
                  return (
                    <Fragment key={t.fingerprint}>
                      <tr>
                        <th scope="row">
                          {r.title}
                          <small>
                            {r.company}
                            {` · ${sourceLabel(r)}`}
                          </small>
                          {r.lead && r.url && !r.pasted && (
                            <small>
                              {r.leadReason || 'Not checked'} ·{' '}
                              <a href={r.url} target="_blank" rel="noreferrer noopener">
                                Open to check
                              </a>
                            </small>
                          )}
                          {t.board ? (
                            <span className="quest-chip lime sc-board">
                              In your quests · {stageCopy[t.board.stage]?.label || t.board.stage}
                            </span>
                          ) : (
                            !r.lead && (
                              <button
                                type="button"
                                className="quest-press sc-lead-action"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await request(`/scout/roles/${t.fingerprint}/save`, 'POST');
                                  })
                                }
                              >
                                Save to my quests
                              </button>
                            )
                          )}
                          {r.lead && r.missionId && (
                            <button
                              type="button"
                              className="quest-press sc-lead-action"
                              onClick={() => onOpenMission(r.missionId!, 3)}
                            >
                              Open package <ArrowRight size={14} />
                            </button>
                          )}
                          {r.lead && !r.missionId && pasteFor !== t.fingerprint && (
                            <button
                              type="button"
                              className="quest-press sc-lead-action"
                              disabled={busy}
                              onClick={() => {
                                setPasteFor(t.fingerprint);
                                setPasteText('');
                              }}
                            >
                              Paste the ad
                            </button>
                          )}
                        </th>
                        <td>{when(t.firstSeenAt)}</td>
                        <td>
                          {r.workRights ? (
                            <>
                              {workRightsLabels[r.workRights.value]}
                              <small>“{r.workRights.quote}”</small>
                            </>
                          ) : (
                            <span className="sc-empty">Not stated</span>
                          )}
                        </td>
                        <td>
                          {r.arrangement ? (
                            <>
                              {r.arrangement.value}
                              <small>“{r.arrangement.quote}”</small>
                            </>
                          ) : (
                            <span className="sc-empty">Not stated</span>
                          )}
                        </td>
                        <td>
                          {r.seniority?.value || <span className="sc-empty">Not stated</span>}
                        </td>
                        <td>
                          {money(r) ? (
                            <>
                              {money(r)}
                              <small>
                                {r.salary!.quote
                                  ? `“${r.salary!.quote}”`
                                  : 'From the job board field'}
                              </small>
                            </>
                          ) : (
                            <span className="sc-empty">Not stated</span>
                          )}
                        </td>
                      </tr>
                      {pasteFor === t.fingerprint && (
                        <tr className="sc-paste">
                          <td colSpan={6}>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void act(async () => {
                                  await request(`/scout/leads/${t.fingerprint}/package`, 'POST', {
                                    description: pasteText,
                                  });
                                  setPasteFor(null);
                                  setPasteText('');
                                });
                              }}
                            >
                              <label className="quest-field">
                                Advertisement for {r.title} at {r.company}
                                <textarea
                                  rows={8}
                                  value={pasteText}
                                  maxLength={20000}
                                  placeholder="Open the link, copy the whole advertisement and paste it here."
                                  onChange={(e) => setPasteText(e.target.value)}
                                />
                              </label>
                              <p className="quest-fine">
                                Scout scores this text against your approved profile and starts a
                                resume team on it. The text is yours and is not checked by the
                                server; nothing is sent to the employer.
                              </p>
                              <div className="sc-paste-actions">
                                <button
                                  type="submit"
                                  className="quest-press lime"
                                  disabled={busy || pasteText.trim().length < 200}
                                >
                                  Start resume team
                                </button>
                                <button
                                  type="button"
                                  className="quest-press"
                                  onClick={() => setPasteFor(null)}
                                >
                                  Cancel
                                </button>
                                {pasteText.trim().length < 200 && (
                                  <span className="quest-sub">At least 200 characters</span>
                                )}
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
