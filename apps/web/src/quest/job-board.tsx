import { useState } from 'react';
import { stageCopy } from './applications.js';
import { CompanyAvatar } from '../company-avatar.js';

type Filter = 'strong' | 'salary' | 'live' | 'evidence';

const filters: { id: Filter; label: string; test: (r: any) => boolean }[] = [
  { id: 'strong', label: 'Match ≥ 70', test: (r) => Number(r.score) >= 70 },
  { id: 'salary', label: 'Salary stated', test: (r) => Boolean(r.job.salary) },
  { id: 'live', label: 'Live vacancy', test: (r) => Boolean(r.job.source?.liveVacancy) },
  { id: 'evidence', label: 'No required gaps', test: (r) => requiredGaps(r) === 0 },
];

const money = (n?: number) =>
  n == null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export function salaryText(job: any) {
  const s = job.salary;
  if (!s) return null;
  return `${s.currency} ${money(s.min)}–${money(s.max)}`;
}

/** Required requirements with no full evidence; works for both saved scoring versions. */
// Same source as the chips, so the table count and the detail card always agree.
function requiredGaps(r: any) {
  const chips = requirementChips(r);
  if (!chips.length) return (r.gaps || []).length;
  return chips.filter((c) => c.level !== 'preferred' && c.state !== 'evidenced').length;
}

export type Requirement = {
  term: string;
  state: 'evidenced' | 'partial' | 'missing';
  level?: string;
};

/** Requirement × your evidence, from the LLM mapping when present, else the rule-based match lists. */
export function requirementChips(r: any): Requirement[] {
  if (r.mapping?.items?.length)
    return r.mapping.items.map((i: any) => ({
      term: i.term,
      level: i.level,
      state:
        i.status === 'evidenced' ? 'evidenced' : i.status === 'partial' ? 'partial' : 'missing',
    }));
  const required: string[] = r.requirements?.required || [];
  const matched = new Set<string>((r.matches || []).map((m: string) => m.toLowerCase()));
  return required.map((term) => ({
    term,
    level: 'required',
    state: matched.has(term.toLowerCase()) ? 'evidenced' : 'missing',
  }));
}

export function RequirementChips({ r }: { r: any }) {
  const items = requirementChips(r);
  if (!items.length) return null;
  const label = { evidenced: 'evidenced', partial: 'partial', missing: 'no evidence' };
  return (
    <div className="qj-reqs">
      <span className="qj-reqs-title">Requirements vs your evidence</span>
      <ul>
        {items.slice(0, 10).map((item, i) => (
          <li key={item.term + i} className={`qj-req ${item.state}`}>
            {item.term}
            <span className="sr-only">: {label[item.state]}</span>
            {item.level === 'preferred' && <small> · nice to have</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shortlist as a sortable data table with quick filters; the selected row drives the detail card. */
export function QuestJobTable({
  matches,
  selectedId,
  compareIds,
  sourceLabel,
  onSelect,
  stageOf,
}: {
  stageOf?: (r: any) => string | null;
  matches: any[];
  selectedId: string;
  compareIds: string[];
  sourceLabel: string;
  onSelect: (id: string) => void;
}) {
  const [active, setActive] = useState<Filter[]>([]);
  const shown = matches.filter((r) =>
    active.every((id) => filters.find((f) => f.id === id)!.test(r)),
  );
  return (
    <section className="qj-board" aria-labelledby="qj-title">
      <div className="qj-board-head">
        <div>
          <h2 id="qj-title">Shortlist</h2>
          <span>
            Showing {shown.length} of {matches.length} · {sourceLabel} · sorted by match
          </span>
        </div>
        <div className="qj-filters" role="group" aria-label="Filters">
          {filters.map((f) => {
            const on = active.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                className={`qj-filter${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => setActive(on ? active.filter((x) => x !== f.id) : [...active, f.id])}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="qj-scroll">
        <table className="qj-table">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Match</th>
              <th scope="col">Gaps</th>
              <th scope="col">Salary / yr</th>
              <th scope="col">Location</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const sel = r.job.id === selectedId;
              const gaps = requiredGaps(r);
              const score = Math.max(0, Math.min(100, Number(r.score) || 0));
              return (
                <tr key={r.job.id} className={sel ? 'sel' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="qj-role"
                      aria-pressed={sel}
                      onClick={() => onSelect(r.job.id)}
                    >
                      <CompanyAvatar job={r.job} small />
                      <span>
                        <strong>{r.job.title}</strong>
                        <small>
                          {r.job.company}
                          {compareIds.includes(r.job.id) && ' · comparing'}
                          {stageOf?.(r) && ` · in your quests (${stageCopy[stageOf(r)!]?.label})`}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="qj-score">
                      <b>{r.score}</b>
                      <span className="qj-bar" aria-hidden="true">
                        <i style={{ width: `${score}%` }} />
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`quest-chip ${gaps ? 'coral' : 'lime'}`}>
                      {gaps ? `${gaps} gap${gaps === 1 ? '' : 's'}` : 'Covered'}
                    </span>
                  </td>
                  <td className={r.job.salary ? '' : 'qj-muted'}>
                    {salaryText(r.job) || 'Not stated'}
                  </td>
                  <td>{r.job.location || '–'}</td>
                  <td>
                    <span className="quest-chip">
                      {r.job.source?.liveVacancy
                        ? r.job.source?.provider || r.job.source?.name || 'Live'
                        : r.job.source?.externalListing
                          ? 'Pasted link'
                          : 'Demo job'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={6} className="qj-muted">
                  No roles match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
