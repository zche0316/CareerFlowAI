export const countries = [
  {
    code: 'au',
    name: 'Australia',
    currency: 'AUD',
    aliases: ['australia', 'australian'],
    regions: [
      ['New South Wales', 'NSW', 'Sydney', 'Newcastle', 'Wollongong'],
      ['Victoria', 'VIC', 'Melbourne', 'Geelong'],
      ['Queensland', 'QLD', 'Brisbane', 'Gold Coast', 'Cairns', 'Townsville'],
      ['Western Australia', 'WA', 'Perth'],
      ['South Australia', 'SA', 'Adelaide'],
      ['Tasmania', 'TAS', 'Hobart', 'Launceston'],
      ['Australian Capital Territory', 'ACT', 'Canberra'],
      ['Northern Territory', 'NT', 'Darwin'],
    ],
  },
  {
    code: 'nz',
    name: 'New Zealand',
    currency: 'NZD',
    aliases: ['new zealand'],
    regions: [
      ['Auckland', 'Auckland'],
      ['Wellington', 'Wellington'],
      ['Canterbury', 'Christchurch', 'Canterbury'],
      ['Otago', 'Dunedin', 'Otago'],
    ],
  },
  {
    code: 'gb',
    name: 'United Kingdom',
    currency: 'GBP',
    aliases: ['united kingdom', 'uk', 'great britain'],
    regions: [
      ['England', 'London', 'Manchester', 'Birmingham', 'Cambridge', 'Bristol', 'Leeds', 'England'],
      ['Scotland', 'Edinburgh', 'Glasgow', 'Scotland'],
      ['Wales', 'Cardiff', 'Wales'],
      ['Northern Ireland', 'Belfast', 'Northern Ireland'],
    ],
  },
  {
    code: 'us',
    name: 'United States',
    currency: 'USD',
    aliases: ['united states', 'usa', 'u.s.'],
    regions: [
      ['California', 'CA', 'San Francisco', 'Los Angeles', 'San Diego', 'California'],
      ['New York', 'NY', 'New York', 'NYC'],
      ['Washington', 'WA', 'Seattle', 'Washington'],
      ['Texas', 'TX', 'Austin', 'Dallas', 'Houston', 'Texas'],
      ['Massachusetts', 'MA', 'Boston', 'Massachusetts'],
      ['Illinois', 'IL', 'Chicago', 'Illinois'],
    ],
  },
  {
    code: 'ca',
    name: 'Canada',
    currency: 'CAD',
    aliases: ['canada', 'canadian'],
    regions: [
      ['Ontario', 'Toronto', 'Ottawa', 'Ontario'],
      ['British Columbia', 'Vancouver', 'British Columbia'],
      ['Quebec', 'Montreal', 'Quebec'],
      ['Alberta', 'Calgary', 'Edmonton', 'Alberta'],
    ],
  },
  { code: 'sg', name: 'Singapore', currency: 'SGD', aliases: ['singapore'], regions: [] },
  {
    code: 'de',
    name: 'Germany',
    currency: 'EUR',
    aliases: ['germany', 'deutschland'],
    regions: [
      ['Berlin', 'Berlin'],
      ['Bavaria', 'Munich', 'Bavaria'],
      ['Hamburg', 'Hamburg'],
      ['Hesse', 'Frankfurt', 'Hesse'],
    ],
  },
  {
    code: 'fr',
    name: 'France',
    currency: 'EUR',
    aliases: ['france'],
    regions: [
      ['Île-de-France', 'Paris', 'Île-de-France'],
      ['Auvergne-Rhône-Alpes', 'Lyon'],
      ['Provence-Alpes-Côte d’Azur', 'Marseille', 'Nice'],
    ],
  },
];
const contains = (text, term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[^a-z])' + escaped + '(?:$|[^a-z])', 'i').test(text);
};
export function countrySpec(code) {
  const c = countries.find((c) => c.code === code);
  if (!c) throw Error('Unsupported country selection.');
  return c;
}
export function filterGeography(location, code, region = '', city = '') {
  const c = countrySpec(code);
  const explicit = countries.filter((x) => x.aliases.some((a) => contains(location, a)));
  // Explicit country names take precedence over city aliases. Ambiguous country-less locations are excluded.
  const cityMatches = countries.filter(
    (x) =>
      x.regions.some((r) =>
        r.some((a, i) => (i !== 1 || a.length > 3) && a.length > 3 && contains(location, a)),
      ) ||
      (x.code === 'sg' && contains(location, 'Singapore')),
  );
  const inCountry = explicit.length
    ? explicit.some((x) => x.code === code)
    : cityMatches.length === 1 && cityMatches[0].code === code;
  if (!inCountry) return false;
  if (region) {
    const r = c.regions.find((r) => r[0] === region);
    if (!r) throw Error('Region does not belong to selected country.');
    if (
      !r.some((v, i) =>
        i !== 1 || v.length > 2
          ? contains(location, v)
          : new RegExp('(?:,|\\s)' + v + '(?:,|$)', 'i').test(location),
      )
    )
      return false;
  }
  return !city || location.toLowerCase().includes(city.toLowerCase());
}
