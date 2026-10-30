# Job Matching v2 — requirement evidence and scoring

New matching runs separate mandatory skills, preferred skills and unclassified mentions. The existing profile approval, ranking, comparison, official-source recheck and selected-job handoff remain in use. No stylesheet or navigation design changes are included.

## Scoring

`packages/matching/domain.js` exports `scoringVersion = matching-v2` and weights. The score is the rounded sum of component × weight × 100:

| Component | Weight | Evidence rule |
|---|---:|---|
| Required skills | 40% | Matched explicit mandatory skills / extracted mandatory skills |
| Preferred skills | 5% | Matched optional skills / extracted preferred skills |
| Experience | 15% | Supplied years / minimum stated years, capped at 1 |
| Education | 10% | Completed degree level and named subject assessment |
| Preferences | 15% | Mean of location assessment and employment type comparison |
| TF-IDF overlap | 15% | Lexical cosine similarity; not an embedding model |

Unknown requirement components use 0.5 neutral credit, never a confirmed match. An explicit zero-year/no-experience requirement gets full experience credit. Missing preferred skills are listed separately, never as mandatory gaps. A skill repeated in both sections counts only as mandatory. Scores are heuristic indicators, not probabilities or eligibility decisions.

The result saves its scoring version, weights, individual components, assessment reasons and extraction excerpts. Existing saved missions keep their original scores and display the legacy formula. Start a new mission to use v2.

## Requirement extraction

`packages/matching/requirements.js::requirementClauses` recognises explicit requirements, essential/preferred headings, multiline lists and requirement words. `extractRequirements` uses the maintained skill vocabulary and aliases, such as PostgreSQL → SQL. A narrative sentence such as “Our stack uses Docker” remains a mention. Negated requirements and OR alternatives are retained for review rather than converted into an AND requirement. Source excerpts appear in the existing Evidence, gaps & source disclosure.

Experience parsing distinguishes absent requirements from zero, excludes preferred experience and handles ranges/plus-years. When several non-optional year requirements are present, the maximum stated minimum is used conservatively. This does not distinguish specialised experience from total experience; review the source excerpt.

Education uses completed evidence already filtered by `matchingProfileView`. Each record is assessed separately; a high degree in one record cannot supply the level for a different record's subject. A named subject must match a supported subject alias. Different/unknown subjects and equivalent-experience alternatives require manual review rather than inferred equivalence. This is not credential verification.

Location assessment uses the repository geography catalogue to compare country, state/region and city. Explicit conflicting countries take precedence. A broad country preference can match a city in that country; a city preference cannot be satisfied by country-only evidence. Bare ambiguous codes such as WA remain unknown. Unqualified Remote remains unknown; explicit worldwide remote can match, while named-country/city remote restrictions are respected. Work rights, time zones and actual residence are not inferred.

## Verification and demonstration

Run `npm run test:matching`, `npx vitest run tests/matching-quality.test.ts`, `npm run typecheck` and `npm run build`. The full database suite and Playwright tests run in the repository's CareerFlow verification workflow. The browser journey expands the updated score explanation and extraction evidence before selecting a job and verifying downstream persistence.

For a repeatable offline demonstration, approve a fictional profile, start a new mission with fictional jobs, expand Evidence, gaps & source, inspect the preferred component and source excerpts, compare two jobs and select a target. For narrative-only job text, explain that skill requirements remain unknown. For ambiguous qualifications or Remote-only locations, show the unknown assessment instead of claiming eligibility.
