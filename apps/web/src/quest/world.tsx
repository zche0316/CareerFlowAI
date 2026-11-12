import { MarketInsight } from './market-insight.js';
import { useState, type ReactNode } from 'react';
import { ExternalLink, Plane } from 'lucide-react';
import { countries } from '../../../../packages/recruitment/src/geography.js';

// Island art per realm. Positions are a stylised map, not geography.
const islands: Record<
  string,
  { x: number; y: number; w: number; h: number; fill: string; shape: string }
> = {
  ca: { x: 4, y: 8, w: 20, h: 24, fill: '#8FD3FF', shape: '58% 42% 55% 45% / 48% 60% 40% 52%' },
  us: { x: 8, y: 40, w: 20, h: 22, fill: '#FFC24B', shape: '46% 54% 40% 60% / 56% 44% 56% 44%' },
  gb: { x: 36, y: 8, w: 12, h: 20, fill: '#FF8A6B', shape: '44% 56% 62% 38% / 55% 45% 55% 45%' },
  fr: { x: 38, y: 36, w: 12, h: 18, fill: '#C4B8FF', shape: '50% 50% 44% 56% / 48% 56% 44% 52%' },
  de: { x: 52, y: 14, w: 13, h: 19, fill: '#F4F4F8', shape: '60% 40% 45% 55% / 50% 58% 42% 50%' },
  sg: { x: 62, y: 44, w: 14, h: 16, fill: '#5ED6C4', shape: '50% 50% 46% 54% / 58% 42% 58% 42%' },
  au: { x: 70, y: 64, w: 22, h: 28, fill: '#D4F55B', shape: '52% 48% 40% 60% / 46% 56% 44% 54%' },
  nz: { x: 87, y: 36, w: 11, h: 18, fill: '#FFD6C9', shape: '40% 60% 50% 50% / 62% 38% 62% 38%' },
};

const shortName: Record<string, string> = { gb: 'UK', us: 'USA', nz: 'NZ', sg: 'SG' };

// Visa and work-rights rules are only ever linked, never summarised by the app.
const officialRules: Record<string, { label: string; url: string }> = {
  au: { label: 'Department of Home Affairs', url: 'https://immi.homeaffairs.gov.au/' },
  nz: { label: 'Immigration New Zealand', url: 'https://www.immigration.govt.nz/' },
  gb: { label: 'GOV.UK visas and immigration', url: 'https://www.gov.uk/browse/visas-immigration' },
  us: { label: 'U.S. Citizenship and Immigration Services', url: 'https://www.uscis.gov/' },
  ca: {
    label: 'Immigration, Refugees and Citizenship Canada',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship.html',
  },
  sg: { label: 'Ministry of Manpower', url: 'https://www.mom.gov.sg/' },
  de: {
    label: 'Make it in Germany (federal portal)',
    url: 'https://www.make-it-in-germany.com/en/',
  },
  fr: { label: 'France-Visas', url: 'https://france-visas.gouv.fr/' },
};

export const rightsPattern =
  /\b(citizen(ship)?|permanent resident(s|cy)?|right to work|work rights|work authori[sz]ation|visa sponsorship|sponsor(ship)?|security clearance)\b/i;

const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** The sentence around a work-rights mention, quoted from the job text. */
function quoteAround(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hit = sentences.find((s) => rightsPattern.test(s));
  if (!hit) return null;
  return hit.length > 180 ? hit.slice(0, 177) + '…' : hit;
}

export function realmStats(workspace: any, code: string) {
  const currency = countries.find((c) => c.code === code)?.currency;
  const quests = (workspace?.missions || []).filter(
    (m: any) => (m.data?.jobSearch?.country || 'au') === code,
  );
  const byId = new Map<string, any>();
  for (const m of quests) for (const r of m.data?.matches || []) byId.set(r.job.id, r);
  const roles = [...byId.values()];
  const salaried = roles.filter(
    (r) =>
      r.job.salary && r.job.salary.currency === currency && (r.job.salary.min || r.job.salary.max),
  );
  const mids = salaried.map((r) => {
    const { min, max } = r.job.salary;
    return min && max ? (min + max) / 2 : min || max;
  });
  const rights = roles.filter((r) => rightsPattern.test(r.job.description || ''));
  const sample = rights
    .map((r) => ({ job: r.job, quote: quoteAround(r.job.description) }))
    .find((x) => x.quote);
  const terms = new Map<string, number>();
  for (const r of roles) {
    const list: string[] = r.mapping?.items
      ? r.mapping.items.filter((i: any) => i.level === 'required').map((i: any) => i.term)
      : r.requirements?.required || [];
    for (const t of new Set(list.map((x) => x.toLowerCase())))
      terms.set(t, (terms.get(t) || 0) + 1);
  }
  const rounds = quests.flatMap((m: any) => m.data?.rounds || []);
  return {
    quests: quests.length,
    roles: roles.length,
    salaried: salaried.length,
    salaryMedian: median(mids),
    currency,
    rights: rights.length,
    sample,
    matchMedian: median(roles.map((r) => Number(r.score) || 0)),
    topTerms: [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    rounds: rounds.length,
  };
}

const money = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function Source({ children }: { children: ReactNode }) {
  return <span className="wm-src">{children}</span>;
}

export function QuestWorld({
  workspace,
  realm,
  onTravel,
  onNewQuest,
  onSeason,
  request,
}: {
  workspace: any;
  request?: (path: string) => Promise<any>;
  realm: string;
  onTravel: (code: string) => void;
  onNewQuest: () => void;
  onSeason: () => void;
}) {
  const [picked, setPicked] = useState(realm);
  if (!workspace) return <p className="quest-fine dark">Loading the map…</p>;
  const spec = countries.find((c) => c.code === picked) || countries[0];
  const stats = realmStats(workspace, spec.code);
  const official = officialRules[spec.code];
  const here = spec.code === realm;
  const charted = countries.filter((c) => realmStats(workspace, c.code).roles > 0).length;
  const compare = [realm, ...countries.map((c) => c.code).filter((c) => c !== realm)]
    .map((code) => ({
      code,
      name: countries.find((c) => c.code === code)!.name,
      s: realmStats(workspace, code),
    }))
    .filter((x, i) => i === 0 || x.s.quests > 0)
    .slice(0, 4);

  return (
    <div className="quest-page wm">
      <div className="wm-head">
        <h1 className="quest-display">Every country plays by different rules.</h1>
        <p>
          Pick a realm and your next quest searches there. Every number below comes from your own
          tracked job records; visa rules only link to the official government page.
        </p>
      </div>

      <div className="quest-row wm-main">
        <section className="quest-tile ink wm-map" aria-labelledby="wm-map">
          <div className="quest-tile-head">
            <h2 id="wm-map">World map</h2>
            <span>
              Not to scale · {charted} of {countries.length} realms charted from your records
            </span>
          </div>
          <div className="wm-sea">
            {countries.map((c) => {
              const i = islands[c.code];
              const s = realmStats(workspace, c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  className={`wm-isle${picked === c.code ? ' picked' : ''}${realm === c.code ? ' here' : ''}`}
                  aria-pressed={picked === c.code}
                  aria-label={`${c.name}${realm === c.code ? ', current realm' : ''}`}
                  style={{
                    left: `${i.x}%`,
                    top: `${i.y}%`,
                    width: `${i.w}%`,
                    height: `${i.h}%`,
                    background: i.fill,
                    borderRadius: i.shape,
                  }}
                  onClick={() => setPicked(c.code)}
                >
                  {realm === c.code && <span className="wm-tag">You are here</span>}
                  <strong className="wm-long">{shortName[c.code] || c.name}</strong>
                  <strong className="wm-code" aria-hidden="true">
                    {c.code.toUpperCase()}
                  </strong>
                  <small>{s.roles ? `${s.roles} roles` : 'uncharted'}</small>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="quest-tile wm-realm" aria-labelledby="wm-realm">
          <div className="quest-tile-head">
            <h2 id="wm-realm">{spec.name}</h2>
            <span className={`quest-chip ${here ? 'lime' : 'outline'}`}>
              {here ? 'Current realm' : 'Not visited'}
            </span>
          </div>
          <div className="wm-row">
            <span>SEARCH SCOPE (SCOUT)</span>
            <p>
              {spec.regions.length
                ? `${spec.regions.length} regions: ${spec.regions.map((r) => r[0]).join(', ')}.`
                : 'Whole country; no regional split.'}
            </p>
            <Source>job search geography config</Source>
          </div>
          <div className="wm-row">
            <span>WORK RIGHTS</span>
            <p>
              {stats.roles
                ? `${stats.rights} of ${stats.roles} tracked roles mention citizenship, residency, work rights or sponsorship.`
                : 'No tracked roles here yet.'}
            </p>
            {stats.sample && (
              <blockquote>
                “{stats.sample.quote}” <cite>{stats.sample.job.company}</cite>
              </blockquote>
            )}
            <Source>
              quoted job text ·{' '}
              <a href={official.url} target="_blank" rel="noopener noreferrer">
                {official.label} <ExternalLink size={11} />
              </a>{' '}
              for the rules themselves
            </Source>
          </div>
          <div className="wm-row">
            <span>SALARY NORM</span>
            <p>
              {stats.salaryMedian
                ? `Median ${stats.currency} ${money(stats.salaryMedian)} / yr (midpoint of stated ranges).`
                : `No ${stats.currency} salary stated in your tracked roles yet.`}
            </p>
            <Source>
              {stats.salaried} of {stats.roles} roles stated a salary in {stats.currency}
            </Source>
          </div>
          <div className="wm-row">
            <span>WHAT EMPLOYERS ASK FOR</span>
            <p>
              {stats.topTerms.length
                ? stats.topTerms.map(([t, n]) => `${t} (${n})`).join(' · ')
                : 'Nothing tracked yet.'}
            </p>
            <Source>required items in your ranked roles</Source>
          </div>
          <div className="wm-row">
            <span>YOUR RECORD HERE</span>
            <p>
              {stats.quests} quest{stats.quests === 1 ? '' : 's'} · median match{' '}
              {stats.matchMedian === null ? '–' : Math.round(stats.matchMedian)} · {stats.rounds}{' '}
              practice round{stats.rounds === 1 ? '' : 's'}
            </p>
          </div>
          <div className="wm-actions">
            {here && (
              <button type="button" className="quest-press" onClick={onSeason}>
                Season event
              </button>
            )}
            {here ? (
              <button type="button" className="quest-press lime" onClick={onNewQuest}>
                Start a quest in {spec.name}
              </button>
            ) : (
              <button type="button" className="quest-press ink" onClick={() => onTravel(spec.code)}>
                <Plane size={18} />
                Travel to {spec.name}
              </button>
            )}
          </div>
          <p className="quest-fine dark">
            Travelling sets where your next quest searches and its salary currency. Resume and
            interview rule packs per realm are planned, not active yet.
          </p>
        </aside>
      </div>

      {compare.length > 1 && (
        <section className="quest-tile violet wm-compare" aria-labelledby="wm-cmp">
          <h2 id="wm-cmp">Compare realms you have searched</h2>
          <div className="wm-table">
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  {compare.map((c) => (
                    <th key={c.code} scope="col">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Tracked roles</th>
                  {compare.map((c) => (
                    <td key={c.code}>{c.s.roles}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Mention work rights</th>
                  {compare.map((c) => (
                    <td key={c.code}>
                      {c.s.roles ? `${Math.round((100 * c.s.rights) / c.s.roles)}%` : '–'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Salary median</th>
                  {compare.map((c) => (
                    <td key={c.code}>
                      {c.s.salaryMedian ? `${c.s.currency} ${money(c.s.salaryMedian)}` : '–'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Your match, median</th>
                  {compare.map((c) => (
                    <td key={c.code}>
                      {c.s.matchMedian === null ? '–' : Math.round(c.s.matchMedian)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      {request && <MarketInsight request={request} country={picked} />}
    </div>
  );
}
