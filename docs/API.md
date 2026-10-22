# CareerFlow AI API and repository contracts

This document is the implementation contract for CFS-34. It describes the current repository
layout, UI/service/data boundaries, shared schemas, HTTP endpoints, sample data and local run
commands. It describes the code in this repository, not a hosted deployment.

## Stage 1 names and implemented roles

| Stage 1 role | Implemented identity      | Main responsibility                                                |
| ------------ | ------------------------- | ------------------------------------------------------------------ |
| R1 / UC1     | Profile Builder           | Turn user-supplied information into a reviewed, versioned profile  |
| R2 / UC2     | Career Coach              | Ground strengths, gaps, directions and actions in approved facts   |
| R3 / UC3     | Job Matcher               | Rank disclosed jobs with evidence, gaps and source limitations     |
| R4 / UC4     | Resume Tailor             | Select approved evidence and generate an extractive resume draft   |
| R5 / UC5     | Interview Coach           | Prepare questions, save answers and return practice feedback       |
| Optional O5  | Interview Coach extension | Practise one fictional salary negotiation after interview feedback |

The Orchestrator, queue, provider adapter and data services are supporting components. They are not
additional specialist agents.

## Repository layout

```text
apps/
  api/src/
    app.ts             HTTP routes and middleware
    domain.ts          profile, mission and ownership operations
    interview.ts       saved-answer and completion rules
    negotiation.ts     optional O5 practice and user decision
    queue.ts           durable pg-boss/LangGraph execution
  web/src/
    main.tsx           React UI and interaction states
    style.css          responsive presentation
packages/
  agents/src/          LangGraph workflow, specialist prompts and provider boundary
  contracts/src/       shared Zod schemas, sample profile and agent metadata
  matching/            retained Member 3 matching algorithm and job fixtures
prisma/
  schema.prisma        persisted domain model
  migrations/          PostgreSQL schema history
scripts/               local database, demo seed and readiness helpers
tests/                 unit, PostgreSQL integration and Playwright E2E suites
docs/                  architecture, API, verification and evidence
```

## UI, service and data boundaries

### UI

`apps/web` is a React/Vite client. It renders persisted state and submits validated user actions. It
does not choose a work item, approve a profile or resume, or decide whether a workflow may advance.

### API and services

`apps/api` owns authentication, CSRF checks, user scoping, profile approvals, mission transitions,
interview answers, optional negotiation practice and resume downloads. `packages/agents` owns the
LangGraph workflow and model context handoff. `packages/matching` contains the deterministic matching
function and disclosed sample jobs. `packages/contracts` is the single source for shared Zod schemas.

### Data

PostgreSQL is the durable boundary:

- `User` stores the current approved `profileVersion`.
- `ProfileDraft` stores owner-scoped proposed profile data and facts with a base version and status.
- `Profile` stores append-only approved profile versions.
- `Mission` stores the pinned profile ID, workflow mode, human decisions, outputs, leases and activity.
- `ApprovedResume` stores immutable approved resume content.
- PostgreSQL checkpoint tables and pg-boss tables support durable workflow execution.

Approved facts and human decisions remain in domain rows. Model output is never silently promoted to
a verified fact.

## Shared input and output schemas

Schemas live in `packages/contracts/src/index.ts`:

| Schema                      | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `profileSchema`             | Required profile fields, salary/date cross-field rules and four sharing switches |
| `profileBuilderDraftSchema` | Partial LLM profile draft, follow-up questions and evidence-backed changes       |
| `coachSchema`               | Strengths, gaps, directions and actions with approved evidence IDs and reasons   |
| `resumePlanSchema`          | Ordered evidence IDs and relevance reasons; server renders approved fact text    |
| `questionsSchema`           | One to three unique role-specific interview questions                            |
| `answerSchema`              | One saved answer bound to a question in the current interview                    |
| `feedbackSchema`            | Non-empty strengths, improvements and next steps                                 |
| `negotiationInputSchema`    | Practice offer, target, three-letter currency and candidate response             |
| `negotiationOutputSchema`   | Recruiter reply plus structured practice feedback                                |
| `negotiationDecisionSchema` | User-owned `accept` or `decline` practice choice                                 |
| `decisionSchema`            | Discriminated job, resume and interview human decisions                          |

## HTTP endpoints

All paths are relative to `http://localhost:8787`. Mutations after authentication require the
`cf_session` cookie and the `X-CSRF-Token` returned by registration/login/demo.

### Public and session

| Method | Path                 | Purpose                                              |
| ------ | -------------------- | ---------------------------------------------------- |
| GET    | `/api/health`        | Process readiness and current provider mode          |
| GET    | `/api/session`       | Current user or anonymous state                      |
| POST   | `/api/auth/register` | Create an owned workspace and session                |
| POST   | `/api/auth/login`    | Sign in                                              |
| POST   | `/api/auth/demo`     | Fictional demo session when `ENABLE_DEMO_LOGIN=true` |
| POST   | `/api/logout`        | Delete the current session                           |

### Profile

| Method | Path                               | Body                         | Purpose                                                |
| ------ | ---------------------------------- | ---------------------------- | ------------------------------------------------------ |
| POST   | `/api/profiles/prepare`            | `{ notes, currentProfile? }` | Produce an editable profile-builder draft              |
| POST   | `/api/profiles/drafts`             | `profileSchema`              | Persist a new owner-scoped draft                       |
| POST   | `/api/profiles/drafts/:id/approve` | `{ reviewed: true }`         | Append the reviewed draft as the next approved version |
| DELETE | `/api/profiles/drafts/:id`         | -                            | Discard an unapproved draft                            |

Approval only succeeds after the reviewed draft has been persisted. A stale or already-used draft
cannot replace another version.

### Missions and decisions

| Method | Path                          | Body                                                                               | Purpose                                                               |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/workspace`              | -                                                                                  | Approved profile, owned missions, approved resumes and agent metadata |
| POST   | `/api/missions`               | `{ goal, minScore?, analysisFeedback?, sourceMissionId?, simulateSourceFailure? }` | Queue an owned career mission                                         |
| GET    | `/api/missions/:id`           | -                                                                                  | Read an owned mission and its persisted state                         |
| POST   | `/api/missions/:id/decisions` | `decisionSchema`                                                                   | Select a job, approve/revise a resume or finish interview input       |
| POST   | `/api/missions/:id/cancel`    | `{}`                                                                               | Cancel unfinished processing while preserving approved data           |
| POST   | `/api/missions/:id/retry`     | `{}`                                                                               | Retry a recoverable failed step                                       |

Mission statuses include `QUEUED`, `RUNNING`, `AWAITING_JOB`, `AWAITING_APPROVAL`,
`AWAITING_INTERVIEW`, `COMPLETE`, `FAILED`, `STALE`, `CANCELLED` and `NO_MATCHES`.

### Interview and optional negotiation

| Method | Path                                     | Body                        | Purpose                                      |
| ------ | ---------------------------------------- | --------------------------- | -------------------------------------------- |
| PUT    | `/api/missions/:id/answers`              | `answerSchema`              | Save or replace one answer in question order |
| POST   | `/api/missions/:id/negotiation`          | `negotiationInputSchema`    | Simulate one fictional salary negotiation    |
| PUT    | `/api/missions/:id/negotiation/decision` | `negotiationDecisionSchema` | Record the user's final practice decision    |

Negotiation is available only after the mission is `COMPLETE`, has a selected job and has interview
feedback. The model cannot accept an offer or record the final decision.

### Resume

| Method | Path                        | Purpose                                                    |
| ------ | --------------------------- | ---------------------------------------------------------- |
| GET    | `/api/resumes/:id/download` | Download the owner's exact approved evidence-linked resume |

## Errors

Domain errors return JSON with `code` and `error`. Validation errors return `422 VALIDATION_ERROR`
and field details. Important correction codes include `PROFILE_REQUIRED`, `SHARING_REQUIRED`,
`STALE_DRAFT`, `DRAFT_USED`, `INVALID_JOB`, `STALE_APPROVAL`, `ANSWER_REQUIRED`,
`INVALID_QUESTION`, `BUDGET_REACHED`, `STALE_PROFILE` and `NEGOTIATION_NOT_READY`.

Every response includes `X-Request-ID`. A valid caller-supplied value is echoed; otherwise the API
generates a UUID. JSON error bodies include the same value as `requestId`.

## Sample data

- `sampleProfile` in `packages/contracts/src/index.ts` is a fictional candidate used by the UI and tests.
- `packages/matching/jobs.json` contains eight fictional job advertisements with source and salary metadata.
- `packages/matching/profile.json` is the retained Member 3 matching fixture.
- Tests create disposable `@careerflow.test` accounts and remove their workflow rows.

The jobs, salary values and provider-mode feedback are disclosed fixtures. They are not live vacancies
or market estimates.

## Local run commands

Prerequisites: Node.js 22.12+, npm, PostgreSQL 15+ and a writable local checkout.

```powershell
Copy-Item .env.example .env
# Set DATABASE_URL to the local PostgreSQL database.
npm ci
npm run db:migrate
npm run build
npm start
```

Open `http://localhost:8787`.

For macOS/Linux with PostgreSQL binaries on `PATH`:

```sh
cp .env.example .env
npm ci
bash scripts/local-db.sh
npm run db:migrate
npm run build
npm start
```

Verification:

```powershell
npm run verify
npm start
# In another terminal, after npx playwright install chromium:
npm run test:e2e
```

Use `PROVIDER_MODE=fixture` for deterministic tests. Live mode requires a server-side key and a model
that supports tools and structured Responses API output; credentials must never be committed.
