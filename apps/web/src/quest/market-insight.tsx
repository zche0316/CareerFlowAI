import { useEffect, useState } from 'react';

// Regional market insight (CFS-115): counted from the roles your own searches found.

const familyLabel: Record<string, string> = {
  all: 'All roles',
  data: 'Data and analytics',
  software: 'Software engineering',
  ml: 'Machine learning and AI',
  cloud: 'Cloud and DevOps',
  product: 'Product and business analysis',
  other: 'Other',
};
const money = (n: number | null, currency: string) =>
  n === null ? '–' : `${currency} ${Math.round(n / 1000)}k`;

export function MarketInsight({
  request,
  country,
}: {
  request: (path: string) => Promise<any>;
  country: string;
}) {
  const [family, setFamily] = useState('all');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    request(`/insights?country=${country}&family=${family}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [country, family]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return null;
  const o = data.overall;
  return (
    <section className="quest-tile market-insight" aria-labelledby="mi-title">
      <div className="quest-tile-head">
        <h2 id="mi-title">What {data.countryName} roles ask for</h2>
        <label className="mi-family">
          <span className="sr-only">Role family</span>
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            {data.families.map((f: any) => (
              <option key={f.id} value={f.id}>
                {familyLabel[f.id] || f.id} ({f.roles})
              </option>
            ))}
          </select>
        </label>
      </div>
      {o.roles === 0 ? (
        <p className="qh-empty">
          No roles found here yet. Find roles or send Scout out in this country to build the
          picture.
        </p>
      ) : (
        <>
          <dl className="mi-overall">
            <div>
              <dt>Roles counted</dt>
              <dd>{o.roles}</dd>
            </div>
            <div>
              <dt>Salary (middle half)</dt>
              <dd>
                {o.salary
                  ? `${money(o.salary.low, o.salary.currency)}–${money(o.salary.high, o.salary.currency)}`
                  : 'Not stated'}
              </dd>
            </div>
            <div>
              <dt>Visa sponsorship offered</dt>
              <dd>
                {o.workRights.sponsorshipAvailable} · citizen/PR only {o.workRights.citizenOrPrRequired}
              </dd>
            </div>
            <div>
              <dt>Remote · hybrid</dt>
              <dd>
                {o.arrangement.remote} · {o.arrangement.hybrid}
              </dd>
            </div>
          </dl>
          <h3>Most requested skills</h3>
          <ul className="mi-skills">
            {o.topSkills.map((s: any) => (
              <li key={s.skill} title={s.examples.map((e: any) => `${e.title} · ${e.company}`).join('\n')}>
                <strong>{s.skill}</strong> {s.count} of {o.roles}
              </li>
            ))}
          </ul>
          {data.cities.length > 1 && (
            <details>
              <summary>By city</summary>
              <ul>
                {data.cities.map((c: any) => (
                  <li key={c.city}>
                    {c.city}: {c.roles} role{c.roles === 1 ? '' : 's'}
                    {c.salary ? ` · median ${money(c.salary.median, c.salary.currency)}` : ''}
                    {c.topSkills[0] ? ` · top skill ${c.topSkills[0].skill}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <p className="small muted">{data.limitations.join(' ')}</p>
    </section>
  );
}
