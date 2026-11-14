import { useState, type ReactNode } from 'react';
import { BadgeCheck, Code, Globe, Layers, Trophy } from 'lucide-react';

// Profile sources (CFS-112 to 114): preview what a public source adds, review it, then approve it
// as a new profile version. Nothing is added before the user approves the exact proposal.

type Field = {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'file' | 'textarea';
};
export type SourceConfig = { kind: string; title: string; hint: string; fields: Field[] };

export const sourceConfigs: SourceConfig[] = [
  {
    kind: 'github',
    title: 'GitHub',
    hint: 'Public repositories, languages, tests and CI, read through the official GitHub API.',
    fields: [{ name: 'username', label: 'GitHub username', placeholder: 'octocat' }],
  },
  {
    kind: 'certificate',
    title: 'Certificates',
    hint: 'Badge or verification links (one per line). Open Badges records, such as most Credly badges, are verified; others are kept as links.',
    fields: [
      {
        name: 'urls',
        label: 'Certificate links',
        type: 'textarea',
        placeholder: 'https://www.credly.com/badges/…',
      },
    ],
  },
  {
    kind: 'linkedin',
    title: 'LinkedIn data export',
    hint: 'LinkedIn has no public profile API. Download your data from LinkedIn (Settings → Data privacy → Get a copy of your data) and upload the ZIP here.',
    fields: [{ name: 'file', label: 'Export ZIP or CSV', type: 'file' }],
  },
  {
    kind: 'codeforces',
    title: 'Codeforces',
    hint: 'Contest rating and history from the official Codeforces API.',
    fields: [{ name: 'handle', label: 'Codeforces handle' }],
  },
  {
    kind: 'stackoverflow',
    title: 'Stack Overflow',
    hint: 'Reputation and your top answer tags from the official Stack Exchange API.',
    fields: [
      {
        name: 'user',
        label: 'User number or profile link',
        placeholder: 'https://stackoverflow.com/users/…',
      },
    ],
  },
  {
    kind: 'leetcode',
    title: 'LeetCode (optional)',
    hint: 'LeetCode has no official API; the public profile is read when possible. If it cannot be read, your own solved count is added as self-reported.',
    fields: [
      { name: 'username', label: 'LeetCode username' },
      { name: 'solved', label: 'Problems solved (used only if the profile cannot be read)' },
    ],
  },
  {
    kind: 'website',
    title: 'Personal website',
    hint: 'Project sections (a heading followed by text) on one page. Pages the site asks robots not to read are skipped.',
    fields: [{ name: 'url', label: 'Page address', placeholder: 'https://' }],
  },
];

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

function SourceCard({
  config,
  request,
  onApproved,
}: {
  config: SourceConfig;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onApproved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const p = result?.proposal;
  return (
    <section className="ps-card" aria-label={`${config.title} source`}>
      <h3>{config.title}</h3>
      <p className="small muted">{config.hint}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setDone('');
            setReviewed(false);
            setResult(await request(`/profile-sources/${config.kind}/preview`, 'POST', values));
          });
        }}
      >
        {config.fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.type === 'file' ? (
              <input
                type="file"
                accept=".zip,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void readFile(file).then((data) => setValues({ ...values, [f.name]: data }));
                }}
              />
            ) : f.type === 'textarea' ? (
              <textarea
                value={values[f.name] || ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            ) : (
              <input
                value={values[f.name] || ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
            )}
          </label>
        ))}
        <button type="submit" className="quest-press ql-go" disabled={busy}>
          {busy && !p ? 'Reading…' : 'Preview'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {p && (
        <div className="ps-preview">
          <ul>
            {p.summary.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
            {p.warnings.map((s: string) => (
              <li key={s}>⚠ {s}</li>
            ))}
          </ul>
          {[...p.projects, ...p.workExperiences, ...p.educations].length > 0 && (
            <>
              <h4>Records to add</h4>
              <ul>
                {[...p.workExperiences, ...p.projects, ...p.educations].map((r: any) => (
                  <li key={r.id}>
                    {r.title}
                    {r.organisation ? ` · ${r.organisation}` : ''}
                    {r.technologies?.length ? ` · ${r.technologies.join(', ')}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {p.verifiedEvidence.length > 0 && (
            <>
              <h4>Evidence for capability levels</h4>
              <ul>
                {p.verifiedEvidence.map((e: any) => (
                  <li key={e.skill + e.detail}>
                    {e.skill}: {e.detail} · supports level {e.supports}
                    {e.verified ? ' · verified' : ' · not verified'}
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed these items and want them in my profile.
          </label>
          <button
            type="button"
            className="quest-press lime ql-go"
            disabled={!reviewed || busy}
            onClick={() =>
              void run(async () => {
                const draft = await request('/profiles/drafts', 'POST', result.merged);
                await request(`/profiles/drafts/${draft.id}/approve`, 'POST', { reviewed: true });
                setResult(null);
                setDone(`${config.title} added. Your profile has a new approved version.`);
                onApproved();
              })
            }
          >
            Approve and add to my profile
          </button>
        </div>
      )}
    </section>
  );
}

// Compact marks for each source; brand names stay in text, no third-party logos are bundled.
const marks: Record<string, { mark: ReactNode; color: string; short: string }> = {
  github: { mark: <Code size={20} />, color: '#111218', short: 'Repositories' },
  certificate: { mark: <BadgeCheck size={20} />, color: '#3a9b2e', short: 'Badges & certificates' },
  linkedin: { mark: <b className="ps-in">in</b>, color: '#0a66c2', short: 'Data export' },
  codeforces: { mark: <Trophy size={20} />, color: '#1f8acb', short: 'Contest rating' },
  stackoverflow: { mark: <Layers size={20} />, color: '#f48024', short: 'Answer tags' },
  leetcode: { mark: <Code size={20} />, color: '#ffa116', short: 'Solved problems' },
  website: { mark: <Globe size={20} />, color: '#7c5cff', short: 'Project pages' },
};

export function ProfileSources({
  request,
  onApproved,
}: {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  onApproved: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const config = sourceConfigs.find((c) => c.kind === open);
  return (
    <section className="quest-tile profile-sources" aria-labelledby="ps-title">
      <div className="quest-tile-head">
        <h2 id="ps-title">Add evidence from your public profiles</h2>
        <span>Preview first; nothing is added until you approve it.</span>
      </div>
      <div className="ps-tiles" role="group" aria-label="Evidence sources">
        {sourceConfigs.map((c) => {
          const m = marks[c.kind];
          return (
            <button
              key={c.kind}
              type="button"
              className="ps-tile"
              aria-pressed={open === c.kind}
              onClick={() => setOpen(open === c.kind ? null : c.kind)}
            >
              <span className="ps-mark" style={{ background: m?.color }}>
                {m?.mark}
              </span>
              <strong>{c.title.replace(' (optional)', '')}</strong>
              <small>{m?.short}</small>
            </button>
          );
        })}
      </div>
      {config && (
        <SourceCard key={config.kind} config={config} request={request} onApproved={onApproved} />
      )}
    </section>
  );
}
