import { useEffect, useState } from 'react';

// Capability levels (CFS-111): per-skill level 0-4 with confidence and the evidence behind it.

const levelNames = ['No evidence', 'Aware', 'Used', 'Proficient', 'Advanced'];
const confidenceLabel: Record<string, string> = {
  verified: 'Verified source',
  story: 'STAR story',
  described: 'Described',
  listed: 'Listed only',
};
const dimensionLabel: Record<string, string> = {
  stack: 'Tech stack',
  'problem-solving': 'Problem solving',
  practice: 'Engineering practice',
  domain: 'Domain',
  communication: 'Communication',
};

export function CapabilityLevels({
  request,
  profileVersion,
}: {
  request: (path: string) => Promise<any>;
  profileVersion: number;
}) {
  const [skills, setSkills] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    request('/capabilities')
      .then((r) => setSkills(Array.isArray(r?.skills) ? r.skills : []))
      .catch(() => setSkills([]));
  }, [profileVersion]);
  if (!skills) return null;
  return (
    <section className="quest-tile cap-levels" aria-labelledby="cap-title">
      <div className="quest-tile-head">
        <h2 id="cap-title">Capability levels</h2>
        <span>
          0 none · 1 aware · 2 used · 3 proficient · 4 advanced. Skills unused for three years show
          one level lower.
        </span>
      </div>
      {skills.length === 0 ? (
        <p className="qh-empty">No skills with evidence yet.</p>
      ) : (
        <ul className="cap-list">
          {skills.map((s) => (
            <li key={s.skill}>
              <button
                type="button"
                className="cap-row"
                aria-expanded={open === s.skill}
                onClick={() => setOpen(open === s.skill ? null : s.skill)}
              >
                <strong>{s.skill}</strong>
                <span
                  className="cap-pips"
                  role="img"
                  aria-label={`Level ${s.level} of 4, ${levelNames[s.level]}`}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <i key={n} className={n <= s.level ? 'on' : ''} />
                  ))}
                </span>
                <span className="cap-name">{levelNames[s.level]}</span>
                <span
                  className={`quest-chip ${s.confidence === 'verified' ? 'lime' : s.confidence === 'story' ? 'lilac' : 'outline'}`}
                >
                  {confidenceLabel[s.confidence]}
                </span>
                <small>{dimensionLabel[s.dimension]}</small>
              </button>
              {open === s.skill && (
                <ul className="cap-evidence">
                  {s.evidence.map((e: any, i: number) => (
                    <li key={i}>
                      {e.kind === 'external'
                        ? `${e.source}${e.verified ? ' (verified)' : ''}: ${e.label}`
                        : e.label}
                    </li>
                  ))}
                  {s.stale && <li>Last used {s.lastUsed}; shown one level lower.</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
