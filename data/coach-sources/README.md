# Coach sources

`onet-31.json` is built by `npm run coach:sources` from three files of the O*NET 31.0 Database
(`occupation_data.csv`, `task_statements.csv`, `software_skills.csv`, downloaded from
https://www.onetcenter.org/database.html). It keeps computer and mathematical occupations
(`15-*`) and a few analyst, management and engineering occupations (`11-3021`, `13-1111`,
`13-1161`, `13-2051`, `17-2061`, `17-2072`): each description, up to six core tasks and up to
ten software examples.

This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor,
Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license
(https://creativecommons.org/licenses/by/4.0/). O*NET® is a trademark of USDOL/ETA. CareerFlow
has modified all or some of this information (selected occupations, shortened task and software
lists). USDOL/ETA has not approved, endorsed, or tested these modifications.

## ESCO (`esco.json`)

Built by `npm run coach:esco` from the public ESCO API (https://ec.europa.eu/esco/api): every
occupation in ISCO unit groups 1330, 2120, 2413, 2421, 2511–2514, 2519, 2521–2523, 2529, 2153 and
3511–3514, plus their specialisations one level down; each keeps its description, up to five
alternative names and up to twelve essential skills.

This service uses the ESCO classification of the European Commission. ESCO is reused free of
charge under Commission Decision 2011/833/EU. CareerFlow has modified it (selected occupations,
shortened lists).

## Embeddings (`embeddings.json`)

Built by `npm run coach:embed` (needs `OPENAI_NATIVE_API_KEY`): `text-embedding-3-small` at 512
dimensions for every O*NET and ESCO document (title and text), stored as one base64 Float32
block. Rebuild after either corpus changes.
