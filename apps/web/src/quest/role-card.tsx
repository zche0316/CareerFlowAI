import type { ReactNode } from 'react';
import { CompanyAvatar, SourceIcon } from '../company-avatar.js';
import { requirementChips, salaryText, type Requirement } from './job-board.js';

// One role in the Quest look (CFS-131): who, where and pay at a glance, the fit score, the
// employer's requirements grouped by how much approved evidence covers them, and the actions.
// The scoring rules, the listing text and the source stay one click away instead of stacked.

const groups: { state: Requirement['state']; title: string; hint: string }[] = [
  { state: 'evidenced', title: 'You have evidence', hint: 'Approved facts cover these.' },
  { state: 'partial', title: 'Partly shown', hint: 'Related evidence; worth strengthening.' },
  { state: 'missing', title: 'No evidence yet', hint: 'Kept as gaps; never claimed.' },
];

const tone = (score: number) => (score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low');

export function RoleCard({
  r,
  actions,
  evidence,
  source,
}: {
  r: any;
  /** Buttons for this role (choose, save, compare), shown under the summary. */
  actions?: ReactNode;
  /** Per-requirement evidence for a chosen role (job-fit), shown collapsed. */
  evidence?: ReactNode;
  /** Availability checks for live listings, shown with the source. */
  source?: ReactNode;
}) {
  const job = r.job;
  const chips = requirementChips(r);
  const score = Math.max(0, Math.min(100, Number(r.score) || 0));
  const counts = Object.fromEntries(
    groups.map((g) => [g.state, chips.filter((c) => c.state === g.state).length]),
  ) as Record<Requirement['state'], number>;
  const pay = salaryText(job);
  return (
    <article className="quest-tile rc" aria-label={`${job.title} at ${job.company}`}>
      <header className="rc-head">
        <CompanyAvatar job={job} />
        <div className="rc-title">
          <span className="rc-company">
            <SourceIcon job={job} /> {job.company}
          </span>
          <h3>{job.title}</h3>
          <div className="rc-facts">
            {job.location && <span>{job.location}</span>}
            {job.employmentType && !/unspecified|not supplied/i.test(job.employmentType) && (
              <span>{job.employmentType}</span>
            )}
            <span className={pay ? '' : 'muted'}>{pay ? `${pay} a year` : 'Pay not stated'}</span>
            {!job.source?.liveVacancy && !job.source?.externalListing && (
              <span className="quest-chip outline">Demo role</span>
            )}
          </div>
        </div>
        <div
          className={`rc-fit ${tone(score)}`}
          role="img"
          aria-label={`Estimated match score ${score} out of 100`}
          style={{ '--fit': `${score}%` } as React.CSSProperties}
        >
          <b>{score}</b>
          <small>fit</small>
        </div>
      </header>

      {chips.length > 0 && (
        <>
          <p className="rc-summary">
            {chips.length} requirements · <b>{counts.evidenced}</b> with evidence ·{' '}
            <b>{counts.partial}</b> partly · <b>{counts.missing}</b> with none
          </p>
          <div className="rc-groups">
            {groups.map((g) =>
              counts[g.state] ? (
                <section key={g.state} className={`rc-group ${g.state}`} aria-label={g.title}>
                  <h4>
                    {g.title} <span>{counts[g.state]}</span>
                  </h4>
                  <ul>
                    {chips
                      .filter((c) => c.state === g.state)
                      .map((c, i) => (
                        <li key={c.term + i} className={`qj-req ${c.state}`}>
                          {c.term}
                          {c.level === 'preferred' && <small> · nice to have</small>}
                        </li>
                      ))}
                  </ul>
                  <small className="muted">{g.hint}</small>
                </section>
              ) : null,
            )}
          </div>
        </>
      )}

      {actions && <div className="rc-actions">{actions}</div>}

      <div className="rc-more">
        {(evidence || r.mapping?.items?.length > 0) && (
          <details>
            <summary>Evidence for each requirement</summary>
            {evidence || <MappingItems items={r.mapping.items} />}
          </details>
        )}
        <details>
          <summary>How the fit score works</summary>
          <ScoreDetails r={r} />
        </details>
        <details>
          <summary>Listing and source</summary>
          {job.description && <p className="rc-description">{job.description}</p>}
          <p className="small muted">
            {job.source?.name} · {job.source?.version}.{' '}
            {job.source?.liveVacancy
              ? 'Retrieved vacancy; availability may change.'
              : job.source?.externalListing
                ? 'User-pasted listing; availability unverified.'
                : 'Fictional sample vacancy.'}
          </p>
          {job.applicationUrl && (
            <a href={job.applicationUrl} target="_blank" rel="noopener noreferrer">
              View the listing ↗
            </a>
          )}
          {source}
        </details>
      </div>
    </article>
  );
}

function ScoreDetails({ r }: { r: any }) {
  return (
    <div className="rc-score">
      {r.explanation && <p>{r.explanation}</p>}
      {r.scoringWeights && (
        <ul aria-label="Suitability score components">
          {Object.entries(r.scoringWeights as Record<string, number>).map(([key, weight]) => (
            <li key={key}>
              <span>{`${key === 'semantic' ? 'text overlap' : key}: `}</span>
              <span className="muted">{Math.round(weight * 100)}% weight</span>
              <b>
                {r.components?.[key] == null
                  ? 'not scored'
                  : `${Math.round(r.components[key] * 100)}% evidenced`}
              </b>
            </li>
          ))}
        </ul>
      )}
      {r.scoringVersion === 'matching-v2' && r.requirements && (
        <>
          <p>
            <strong>Required skills:</strong>{' '}
            {r.requirements.required?.join(', ') || 'Not stated in the listing'}
          </p>
          <p>
            <strong>Preferred skills (optional):</strong>{' '}
            {r.requirements.preferred?.join(', ') || 'Not stated'}
          </p>
        </>
      )}
      {r.gaps?.length > 0 && (
        <p>
          <strong>Gaps:</strong> {r.gaps.join('; ')}
        </p>
      )}
      <p className="small muted">
        {r.scoringVersion === 'llm-evidence-v1'
          ? 'A model quotes each requirement from the listing and links your approved facts; code scores evidenced, partial and missing items. Unknown categories are left out rather than given half credit.'
          : r.scoringVersion === 'matching-v2'
            ? 'Rule-based score: 40% required skills · 5% preferred skills · 15% experience · 10% education · 15% preferences · 15% text overlap. Unknown parts get neutral half credit.'
            : 'Saved score from an earlier version.'}{' '}
        A fit score is a guide, not a hiring probability.
      </p>
    </div>
  );
}

// What the listing says for each requirement and which approved facts the model linked to it.
function MappingItems({ items }: { items: any[] }) {
  return (
    <ul className="rc-mapping">
      {items.map((item, i) => (
        <li key={i}>
          <strong>
            {item.term}{' '}
            <span className="muted">
              · {item.level} · {String(item.status).replaceAll('_', ' ')}
            </span>
          </strong>
          {item.excerpt && <blockquote>{item.excerpt}</blockquote>}
          {item.reason && <p>{item.reason}</p>}
          {item.evidence?.length > 0 && (
            <ul>
              {item.evidence.map((e: any) => (
                <li key={e.factId}>
                  <code>{e.factId}</code> {e.quote}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
