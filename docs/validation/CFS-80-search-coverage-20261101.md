# Recent journeys and recruitment coverage — 1 November 2026

## Presentation

Overview shows at most three recent active/completed journeys. Failed, cancelled, stale and no-match attempts remain available through View all journeys; no records are deleted. Titles use the chosen role/company or search keyword/location, and rows show explicit state. Search setup states that connected sources do not cover the whole market.

## Live source probes

Read-only repository searches used existing server configuration; no mission or approved profile was changed. Adzuna credentials are absent; Tavily API-key mode is configured.

- Final Australia-wide automatic search, blank keyword/city: 14 source jobs before profile scoring. Fixed boards: Spaceship 1, VGW 1, GoFundMe 1, MongoDB 10. Tavily discovered 5 links, found 2 supported identities, verified 1; the other supported listing was removed. The discovered eligible AEMO graduate listing added one result.
- Final Sydney + business analyst automatic search: 2 jobs before profile scoring. All four fixed boards returned zero. Tavily discovered 5 links, found 3 supported identities, verified 2: VGW Australia Business Intelligence Analyst and Prezzee Senior Business Analyst - Finance. The hipages posting returned 404 and was excluded.
- US employer-board broad probe: 100 returned, reaching the aggregate employer cap. Board counts before aggregate cap were GoFundMe 11 and MongoDB 96; the other two had zero.
- The first parallel automatic probes saw temporary source unavailability (13 Australia / 0 Sydney). Sequential verification recovered Tavily and MongoDB; these first counts are not the final successful coverage result.

Ignored local evidence: output/job-search-final-coverage-20261101.json, output/job-source-diagnostics-20261101.json, output/job-search-coverage-20261101.json. The initial broad probe contains an illustrative SQL/Excel/Tableau score calculation, not a score audit of the signed-in account; final counts above are retrieval counts only.

## Implemented scope and limits

The fixed employer allowlist contains four Greenhouse boards. Tavily performs one basic search of five results, restricted to Greenhouse, Lever and Ashby hosting domains; postings must be confirmed through official APIs and pass geography checks. SEEK and Indeed are manual listing import only; this is not a whole-web recruiter index.

Each employer search returns up to 100 and the employer aggregate is capped at 100. Tavily adds at most 5, with deduplication: the current configured automatic search has a theoretical upper bound of 105 retrieved jobs. Adzuna, if configured, currently fetches only page 1 with 30 results, so all configured adapters together can supply at most 135 before deduplication. These are code bounds, not a promise of that many relevant Australian vacancies.

Greenhouse keyword filtering uses contiguous case-insensitive substring matching, then geography. Matching subsequently applies the profile-specific minimum score (default 40); there is no final five-job cap. The UI shows one selected job detail with the other matches in its list.

Validation: typecheck and production build passed; six agent-native browser tests passed, including the new recent/history regression. No additional recruitment sources, pagination or query-expansion behavior were introduced in this change.
