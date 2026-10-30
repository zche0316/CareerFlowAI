# Current delivery and release verification

Prepared 30 October 2026 against main aeed3f75c2bbd5e77ced04103639bfc23e455870. This branch adds matching quality fixes and release evidence. Use the final PR check and commit, not an older test count, for acceptance.

## Capabilities

The approved-profile → career analysis → job matching/selection → reviewed resume → interview journey uses owned, versioned context and durable human decisions. Live AI and recruitment are separate configurations. Employer APIs, optional configured Tavily discovery and Adzuna, manual listings and explicitly fictional jobs have distinct provenance. SEEK/Indeed direct API search or submission is not implemented. Application handoff opens the official destination; user-reported submission is not API verification.

## Matching changes

Missing experience requirements now remain null and receive neutral half-credit rather than full credit. Explicit zero years receives full credit. Common experience ranges and plus-years are recognised. Known degree levels are compared without treating a master-data project as a qualification; unknown requirements retain neutral treatment. Australian city/state forms are normalised without treating different cities or region-limited remote jobs as equivalent. Weights remain 45/15/10/15/15; scores are heuristic and not calibrated hiring probabilities. Preferred skills remain descriptive, not a separate score. Skill mentions in unstructured adverts remain low-confidence inference. Degree subject equivalence and work-rights eligibility are not inferred.

## Checks performed for this branch

- TypeScript check and production build passed locally.
- Six original matching regressions passed.
- Five focused test files passed 25 tests: matching quality, document export, resume layout, recruitment and search suggestions.
- The application exporter generated a fictional one-page resume as PDF and DOCX. Both were rendered and visually inspected: headings, target, dates and unknown outcome were readable without clipping or overlap. These are exporter checks, not browser-download acceptance.
- Official Spaceship board response was observed on 30 October with Product Builder, Sydney, posting 8119027; its official single-job API was also checked and returned the same ID/title/link. A saved response can be replayed through normalisation, comparison and export using `node --import tsx scripts/export-review.ts --snapshot`. This is snapshot replay, not an authenticated mission or a guarantee the vacancy remains open.
- Full local verify could not bind the portable database port in the execution sandbox (EPERM). Full integration and browser acceptance must be taken from the new PR's final CI result, not inferred from the base commit.

Artifacts are under ignored output/release-review/. No candidate data or credentials are included. Reproduce the fictional exporter sample with `node --import tsx scripts/export-review.ts`.

## Final source rehearsal

Stop other portable app processes. From the exact source archive in a clean directory, preserve/configure a private .env, run npm ci, npm run verify:local and npm run start:local. Walk all five use cases, download both approved formats, open official links and inspect Activity. Record archive SHA256, source commit, commands, actual outcome and reviewer. Rehearse the exact Canvas download after submission. Neither a prior CI pass nor this document substitutes for that event.

See VALIDATION_20261030.md for earlier real Groq execution; that live run predates this branch. Recheck the configured model and selected vacancy on demonstration day. Keep an explicitly labelled fictional fallback available.
