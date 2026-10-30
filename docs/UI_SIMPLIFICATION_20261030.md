# Workspace usability update

Based on GitHub main `568b4f75543954b0292aff51699a833ba1095b01` (30 October 2026).

## What changed

The home page now starts with a single next action based on the approved profile and current mission. Four short cards explain the profile, job, resume and interview journey. Previous missions appear as rows with an action label rather than a grid of promotional cards.

Global navigation remains available for missions, profile, approvals, documents, applications, activity and optional tools. The five numbered stages appear beside the current work. The duplicate stage-progress strip, marketing hero and agent introduction cards were removed.

Opening a saved mission takes the user to job selection, resume review or interview feedback as appropriate. Starting a search opens Job matching, selecting a job opens Resume tailoring, and the existing explicit resume-approval handoff opens Interview practice. Empty search results offer an Adjust search criteria action. Search parameters, country/region filters, comparison, official job links, source labels and error/retry controls remain available.

Model usage, detailed search coverage and mission activity are expandable. Required profile and resume approvals remain explicit. No account, database, provider, scoring or approval API was changed.

## Demonstration route

1. Open My career profile and build or review a profile. Approve the exact draft.
2. Return to Career missions. Choose New career mission, a source, country/region and keywords.
3. Review the ranked jobs, expand source/evidence if needed and compare two jobs. Select one.
4. Review the resume, confirm the selected claims and approve. Export the approved document from Document library.
5. Complete interview practice and inspect feedback. Return home to reopen the saved mission at its relevant stage.
6. Open Applications for official-site handoff, or Optional tools for tracking, cover letters, reminders/calendar and negotiation. These retain the existing backend prerequisites.

## Validation in this environment

- Full project TypeScript check: `npm run typecheck` passed after generating the Prisma client.
- Production frontend build: passed.
- Five focused Vitest files: 30 tests passed, including seven new next-stage routing cases.
- Original matching suite: six tests passed.
- Diff whitespace check: passed.
- Existing browser acceptance selector updated for the Applications navigation label.

The Prisma startup error was caused by a missing generated client. Installation and `db:generate` now invoke a generation wrapper, and local startup generates the client before migrations. The wrapper supplies a local placeholder URL only for generation when none is configured; migrations and application database settings remain unchanged. Generation succeeded and the `PrismaClient` export was verified.

The sandbox rejected a local listener, so database integration, browser acceptance and visual acceptance have not been completed for this update. Run those checks in a normal local terminal before merging.

## Profile conversation follow-up

The profile interview previously exposed every saved experience as a separate button and showed
review, resume, skip, finish and history actions together. The follow-up keeps the conversation and
current answer as the main path:

- one compact experience selector and one `Organise selected experience` action;
- one contextual interview action instead of four equal-weight buttons;
- skip, finish-interview, resume and missing-experience recovery behind `More actions`;
- a short AI-consent label with a separate `What is shared?` explanation;
- one primary review action once the interview is finished.

This increment changes presentation and interaction hierarchy only. Conversation persistence,
approval, evidence checks, ownership and provider behavior are unchanged.

Validation on a native PostgreSQL test database:

- TypeScript check and production frontend build passed.
- 13 profile-conversation, interview-control and profile-playwright scenarios passed.
- The zero-resume end-to-end journey passed.
- Prettier and `git diff --check` passed.

## Run with the group backend

Install the upstream lockfile dependencies with `npm ci`, then use `npm run start:local` or the existing VS Code launch task. Use an isolated fixture database for `npm run verify:local` and `npm run test:e2e`; do not run tests against a portable database that the application is already using. Preserve the team's server-side environment file and never commit credentials.

This update contains the UI, navigation tests, frontend typecheck configuration, Prisma generation/startup repair and this document. No credentials or local database files are included.
