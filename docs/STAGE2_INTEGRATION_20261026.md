# Stage 2 desktop integration — 26 October 2026

## Scope and baseline

Integrated the desktop CareerFlowAI Stage 2 changes onto group main commit 110a3098ed51800466077a70bf73b581812affec. This is a combined integration, not replacement with the older standalone prototype. Retained the group Profile Builder draft/follow-up implementation, career-analysis refinement, consent/ownership guards, interview completion, salary negotiation, request IDs, provider deadlines and existing quality documents/tests.

Added the navy 01–08 workspace navigation; real employer/Greenhouse/optional Adzuna retrieval within Job Matching; country/region/keyword search; source provenance and official links; vacancy recheck; transparent fictional/manual-source labels; deterministic explanation and selected-job handoff; approved-resume official-site application preparation; optional cover-letter/progress/reminder tools; Australian resume draft assistance; portable local database with VS Code startup; source packager and assessment preparation documents.

No SEEK/Indeed automated submission is implemented. Manual listings remain unverified; application completion is self-reported. No external credentials or local data are included. Real AI and Adzuna require user-provided credentials and were not exercised here.

## Integration fixes

- Preserve remote analysis feedback and source-mission fields alongside jobSearch. Refinement keeps the original search configuration.
- Preserve new workArrangement/companySize/industry fields in Australian profile drafts.
- Keep existing model-backed salary negotiation available in mission overview/feedback stage, alongside the added optional tools.
- Force fixture AI and fixture job retrieval during verify:local and CI; live-source transport integration tests are explicitly mocked.
- Retain native PostgreSQL and Docker paths. Portable mode shares one connection; do not run app/tests concurrently against its database.
- PLAYWRIGHT_BASE_URL supports isolated test ports.

## Verification on merged code

- Clean npm ci from prepared cache succeeded; new portable database migrated successfully on isolated port55452.
- Typecheck passed; 6 original matching tests plus 57 Vitest tests passed (63 total), including database/API/workflow, group profile/analysis/interview and recruitment handoffs.
- Production frontend build passed and server started at isolated port8792 in fixture mode.
- In-app browser rendered the login page. A separate 127.0.0.1 origin was rejected as expected when APP_ORIGIN was localhost; this was not used as workflow success evidence.
- Automated browser suite could not run: initially browser binary absent; after installing it into a workspace cache, Chromium exited at launch with sandbox/macOS process restrictions (SIGTRAP/EPERM), before assertions. Five browser cases remain unverified in this environment. CI is configured to install Chromium; its result must be checked on the PR.
- No Docker, live AI, real Adzuna, Canvas upload/download or final team acceptance is claimed by this integration.

## Documentation chronology

Earlier dated desktop notes and group verification records are retained as historical evidence with their own scope. Read this file for merged-source checks; do not treat old blockers, test counts, templates or proposed meetings as current completion evidence. Agile meetings still require actual participants, decisions and follow-up records.

## Local use

Copy .env.example to .env on first setup, npm ci, then npm run start:local; open http://localhost:8787. VS Code F5 offers CareerFlow: database + app. Stop the app before npm run verify:local. Do not replace an existing .env.
