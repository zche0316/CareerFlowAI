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
    recruitment.ts     owner-scoped application package and self-reported history
    tools.ts           optional status, reminder, cover-letter and role-play tools
  web/src/
    main.tsx           React UI and interaction states
    recruitment.tsx    real-job application preparation, history and availability UI
    tools.tsx          optional application dashboard and reminder UI
    style.css          responsive presentation
packages/
  agents/src/          LangGraph workflow, specialist prompts and provider boundary
  contracts/src/       shared Zod schemas, sample profile and agent metadata
  matching/            retained Member 3 matching algorithm and job fixtures
  recruitment/src/     employer/Greenhouse/optional Adzuna retrieval and normalisation
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
interview answers, optional negotiation practice, resume downloads, application preparation,
self-reported application history and optional local tools. `packages/agents` owns the LangGraph
workflow and model context handoff. `packages/matching` contains the deterministic matching function
and disclosed sample jobs. `packages/recruitment` retrieves and normalises current employer-board
records and optional Adzuna results. `packages/contracts` is the single source for shared Zod schemas.

### Data

PostgreSQL is the durable boundary:

- `User` stores the current approved `profileVersion`.
- `ProfileDraft` stores owner-scoped proposed profile data and facts with a base version and status.
- `Profile` stores append-only approved profile versions.
- `Mission` stores the pinned profile ID, workflow mode, human decisions, outputs, leases and activity.
- `ApprovedResume` stores immutable approved resume content.
- PostgreSQL checkpoint tables and pg-boss tables support durable workflow execution.

Approved facts and human decisions remain in domain rows. Model output is never silently promoted to
a verified fact. Optional status, reminders, cover letters and practice negotiation state are stored
inside the owner-scoped mission document. Application records are stored in mission history and are
labelled as user-reported unless they represent only an official-site handoff.

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
| `jobSearchSchema`           | Job-source provider, country, region, keyword and optional manual listing        |

`apps/api/src/tools.ts` defines the API-local discriminated `toolCommand` schema.
`apps/api/src/recruitment.ts` defines `applicationRecordSchema`. These schemas are validated on the
server before any persisted update.

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

| Method | Path                          | Body                                                                                           | Purpose                                                               |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/workspace`              | -                                                                                              | Approved profile, owned missions, approved resumes and agent metadata |
| POST   | `/api/missions`               | `{ goal, minScore?, analysisFeedback?, sourceMissionId?, simulateSourceFailure?, jobSearch? }` | Queue an owned career mission; `jobSearch` follows `jobSearchSchema`  |
| GET    | `/api/missions/:id`           | -                                                                                              | Read an owned mission and its persisted state                         |
| POST   | `/api/missions/:id/decisions` | `decisionSchema`                                                                               | Select a job, approve/revise a resume or finish interview input       |
| POST   | `/api/missions/:id/cancel`    | `{}`                                                                                           | Cancel unfinished processing while preserving approved data           |
| POST   | `/api/missions/:id/retry`     | `{}`                                                                                           | Retry a recoverable failed step                                       |

Mission statuses include `QUEUED`, `RUNNING`, `AWAITING_JOB`, `AWAITING_APPROVAL`,
`AWAITING_INTERVIEW`, `COMPLETE`, `FAILED`, `STALE`, `CANCELLED` and `NO_MATCHES`.

`jobSearchSchema` accepts `provider` (`employers`, `greenhouse`, `adzuna`, `fixtures` or `manual`),
`board`, `country`, `region`, `location` and `keyword`. A `manual` search also accepts a `listing`
object with `url`, `title`, `company`, `location` and `description`. Search criteria are editable and
are sent to a job source without the approved profile, user identity or career evidence. Missing
Adzuna credentials produce a configuration error instead of fixture substitution.

### Optional tools and reminders

These routes require an authenticated `cf_session` and are limited to missions owned by the current
user. `POST` requires the same `X-CSRF-Token` as every other mutation.

| Method | Path                                               | Body          | Purpose                                               |
| ------ | -------------------------------------------------- | ------------- | ----------------------------------------------------- |
| GET    | `/api/tools/dashboard`                             | -             | Summarise owned application status and reminders      |
| POST   | `/api/missions/:id/tools`                          | `toolCommand` | Persist a status, reminder, local letter or role-play |
| GET    | `/api/missions/:id/reminders/:reminderId/calendar` | -             | Return an iCalendar document for one owned reminder   |

`toolCommand` is a discriminated union:

```json
{ "kind": "status", "status": "applied" }
{ "kind": "reminder", "title": "Follow up", "category": "follow-up", "dueAt": "2026-10-30T09:00:00.000Z" }
{ "kind": "letter" }
{ "kind": "negotiation", "offer": "Fictional offer context", "response": "Candidate practice response" }
```

Allowed statuses are `applied`, `interview`, `rejected` and `offer`. Reminder categories are
`application`, `interview` and `follow-up`; `dueAt` must be an ISO date-time. Every tool command
requires a selected target job on the owned mission and rejects a mission based on a stale approved
profile.

`GET /api/tools/dashboard` returns:

```json
{
  "applications": [
    {
      "missionId": "uuid",
      "title": "Data Analyst",
      "status": "interview",
      "updatedAt": "ISO-8601"
    }
  ],
  "total": 1,
  "interviewCount": 1,
  "rejected": 0,
  "interviewRate": 1,
  "rejectionRate": 0,
  "recurringGaps": [["Python", 2]],
  "reminders": [
    {
      "id": "uuid",
      "missionId": "uuid",
      "title": "Follow up",
      "category": "follow-up",
      "dueAt": "ISO-8601",
      "createdAt": "ISO-8601",
      "jobId": "source-id"
    }
  ],
  "limitations": ["Self-reported status limitation"]
}
```

The dashboard contains only the current user's missions. Status values are self-reported, not
employer-verified. Missing rates are `null`; offers count as having reached an interview.

`POST /api/missions/:id/tools` returns the tool result that was persisted. A status result is
`{ value, at }`; a reminder result is the reminder object; a letter result contains verbatim approved
facts and `mode: "local-template"`; the local role-play result contains `reply`, `feedback` and
`limitations`. No optional-tool endpoint contacts an employer or sends an external message.

`GET /api/missions/:id/reminders/:reminderId/calendar` returns:

```json
{ "filename": "careerflow-reminder.ics", "content": "BEGIN:VCALENDAR\r\n..." }
```

The response is JSON containing calendar text, not a `text/calendar` file response. Calendar text is
escaped and includes a 15-minute reminder alarm. A missing mission or reminder returns
`404 NOT_FOUND`. Tool requests require a selected target and may return `409 STALE_PROFILE` or
`409 TARGET_REQUIRED`.

### Application preparation and availability

These endpoints are owner-scoped. `GET` uses the authenticated session; `POST` additionally requires
`X-CSRF-Token`.

| Method | Path                                         | Body                      | Purpose                                                 |
| ------ | -------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| GET    | `/api/missions/:id/application`              | -                         | Build the approved application-review package           |
| POST   | `/api/missions/:id/applications`             | `applicationRecordSchema` | Record an official-site handoff or self-reported submit |
| GET    | `/api/missions/:id/jobs/:jobId/availability` | -                         | Recheck one job from the mission's current matches      |

`GET /api/missions/:id/application` returns:

```json
{
  "missionId": "uuid",
  "jobId": "source-id",
  "company": "Employer",
  "title": "Data Analyst",
  "destination": "https://official.example/job/123",
  "approvedResumeId": "uuid",
  "profileVersion": 2,
  "contextHash": "sha256-hex",
  "resumeText": "Persisted approved resume text",
  "submissionSupported": false,
  "notice": "No application is sent here."
}
```

The mission must pin an approved resume and a real API-retrieved or supported user-pasted external
listing with a valid HTTPS destination. Fictional fixture jobs are rejected with
`409 REAL_JOB_REQUIRED`. A changed current profile returns `409 STALE_PROFILE`; an invalid
destination returns `422 INVALID_DESTINATION`.

`applicationRecordSchema` accepts:

```json
{
  "status": "opened_official_site",
  "contextHash": "sha256-hex",
  "confirmed": false,
  "reference": ""
}
```

or the same body with `status: "submitted_self_reported"` and `confirmed: true`. The server derives
and compares `contextHash` with the current prepared package. A stale package returns
`409 STALE_APPLICATION`; an unconfirmed self-reported submission returns
`422 CONFIRMATION_REQUIRED`. The response is the persisted record:

```json
{
  "id": "uuid",
  "status": "submitted_self_reported",
  "contextHash": "sha256-hex",
  "jobId": "source-id",
  "company": "Employer",
  "title": "Data Analyst",
  "approvedResumeId": "uuid",
  "reference": "Candidate reference",
  "at": "ISO-8601",
  "verification": "User-reported; not API-confirmed"
}
```

A repeated self-reported submission for the same context returns the existing record rather than
creating a duplicate. This API never submits an application.

`GET /api/missions/:id/jobs/:jobId/availability` first verifies mission ownership and that `jobId`
exists in the persisted match results. For Greenhouse jobs it performs a bounded official API
recheck. Possible successful responses include:

- `{ status: "published_at_check", checkedAt, method }` for a confirmed current Greenhouse vacancy;
- `{ status: "closed_or_removed", checkedAt, method }` when the official API returns 404/410;
- `{ status: "unverified", checkedAt, reason }` for sources without a direct recheck.

A missing mission or job returns `404 NOT_FOUND`. An upstream source failure currently falls through
the generic error boundary as `500 INTERNAL_ERROR`; it does not mutate selected-job or approved data.
Selection uses a stricter flow and returns `503 VACANCY_CHECK_UNAVAILABLE` or
`409 VACANCY_CLOSED` before persisting a choice.

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
`INVALID_QUESTION`, `BUDGET_REACHED`, `STALE_PROFILE`, `NEGOTIATION_NOT_READY`,
`TARGET_REQUIRED`, `REAL_JOB_REQUIRED`, `INVALID_DESTINATION`, `STALE_APPLICATION`,
`CONFIRMATION_REQUIRED`, `VACANCY_CHECK_UNAVAILABLE` and `VACANCY_CLOSED`.

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

### Structured profile records and resume import (29 October 2026)

`profileSchema` additionally accepts optional `workExperiences`, `projects`, `educations` arrays and `contact`. Each record has a stable client ID, title, organisation, location, independent YYYY-MM dates, Current/Present, optional expected completion month, details, technologies, URL and original import page quotes. Legacy free-text fields remain compatible. The existing draft/review/approval endpoints remain the only way to approve a profile.

Authenticated import endpoints (mutations require the existing CSRF token):

- `POST /api/profiles/imports`: `{filename,mime,base64}`; PDF/TXT/PNG/JPEG, maximum 4 MB, ten PDF pages. Performs local extraction only and persists an owner-scoped import. Does not return raw file bytes.
- `GET /api/profiles/imports`: the current user's latest ten imports.
- `GET /api/profiles/imports/:id`: saved page previews, proposed records, status, errors, router/model availability and usage events.
- `POST /api/profiles/imports/:id/recognize`: `{consent:true,pages?:number[]}`; recognize up to three selected pages with the configured vision model. Without an explicit list, the first three pages suggested for vision are used.
- `POST /api/profiles/imports/:id/structure`: `{consent:true}`; organize up to 16,000 extracted characters through the configured text model and filter unsupported proposals against actual source-page quotes.

Model operations require `PROVIDER_MODE=openai`; fixture mode never creates fake import records. Eight calls per import are reserved before requests; repeated/overlapping operations are rejected. Failures retain source data and require explicit retries. A processing record older than two minutes can be retried after a server interruption. No model output controls ownership or approval.

`GET /api/resumes/:id/download?format=txt|docx|pdf` exports the current user's persisted approved snapshot, with TXT as the backwards-compatible default. DOCX is editable and PDF retains searchable text. Unsupported formats return validation errors; another user's resume remains unavailable. Imports and model configuration are documented in `docs/PROFILE_IMPORT_AND_MODEL_ROUTER.md`.
# Conversational profile and evidence endpoints

All routes below require the existing signed-in account; mutations require its CSRF token.

- `GET/POST /api/profile-threads`, `GET /api/profile-threads/:id`: owned saved conversations and working-form snapshots.
- `POST /api/profile-threads/:id/messages`: `{text,currentProfile,revision,consent:true}`. A model failure is represented as a saved failed assistant turn, with no field changes.
- `POST /api/profile-threads/:id/proposals/:proposalId`: `{decision:"apply"|"reject",currentProfile,revision}`. Returns one field patch; does not approve a profile.
- `GET/POST /api/career-memories`: list or create a draft note/STAR with source, record/application scope and optional `supersedesId`.
- `PATCH /api/career-memories/:id`: `{revision,reviewed:true}` confirms the draft and atomically supersedes its predecessor.
- `DELETE /api/career-memories/:id`: `{revision}` purges memory content from future retrieval.
- `GET /api/career-evidence?q=...&recordId=...&missionId=...`: confirmed owner-scoped lexical evidence with scores, source IDs and explicit insufficient-recall state.
- `GET/POST /api/resumes/:id/wording`: list/propose wording for `{factId,consent:true}`.
- `PATCH /api/resume-wordings/:id`: `{decision:"accept"|"reject",reviewed:true,after?}` reviews one expression without changing original facts.
- `POST /api/resumes/:id/wording/finalize`: `{reviewed:true}` creates an idempotent separate approved edition; original content and the mission's existing application packet remain unchanged.
- `GET/POST /api/missions/:id/application-readiness`: fetch supported public questions or save `{hash,answers,reviewed:true}` against the current schema. Preparation only; no external submission.

See [CONVERSATIONAL_PROFILE.md](CONVERSATIONAL_PROFILE.md) for scope, model configuration, limits and manual testing.

## Zero-resume application workflow

- Profile records retain full source statements; facts expose separate record headers and individually selectable statements. `recordHeaderId` preserves context when selecting statements.
- STAR drafts accept incomplete stories. Confirmation requires situation, task and personal action; an unknown result remains empty. Confirming a correction retires the preceding draft chain and its last confirmed source atomically.
- Optional `careerStage` and `useConfirmedMemories` belong to the approved profile. Memory context is opt-in; retrieval never authorises new resume claims.
- `POST /api/missions/:id/resume-selection`: `{draftHash,orderedFactIds}` selects/orders approved facts for the current awaiting-approval draft. Required record headers are included. The new hash invalidates the previous approval; source profiles remain unchanged.
- `POST /api/missions/:id/feedback-memory`: `{saveAsDraft:true}` retains actual interview feedback as a draft learning note. Feedback cannot become a qualification through grounding.

See [PRODUCT_WORKFLOW.md](PRODUCT_WORKFLOW.md) for the source/profile/application separation and the six-stage user outcome.

### Chat-first profile review

`POST /api/profile-threads/:id/proposals` accepts `{currentProfile,revision,reviewed:true}` and applies all pending suggestions to the owned working draft in one transaction. A changed field, stale thread/profile or corrected memory rejects the whole update. It never approves a profile. Field equality ignores JSON object-key order because PostgreSQL JSONB does not preserve that order. Existing per-proposal routes remain compatible.

Conversational replies expose a short reply and one follow-up question. Grounded later answers merge into the same title/organisation record with stable ID and retained source citations. New profile facts suppress absence markers and use structured education/experience instead of parallel legacy summaries. Historical approved documents remain unchanged.

### Interview progression and recovery

`POST /api/profile-threads/:id/controls` accepts `{currentProfile,revision,action,recordKey?}`. Actions: finish_experience, next_experience, finish_interview, skip_question, resume, keep_current_draft. Controls use ownership and revision/CAS guards, preserve working content and pending suggestions, and never call the model or approve a profile. Interview state is persisted on assistant-message metadata: phase, closed scopes, active scope, addressed question slots and inventory baseline.

`POST .../:id/messages` optionally supports `retryMessageId` for the latest failed saved answer, or `recoverSavedAnswers:true` in review stage to prepare pending data from saved history. Both avoid duplicate user messages. Recovery keeps the interview finished. Conversation sources can cite up to 30 complete user messages within an 18,000-character context budget; commands are excluded from candidate evidence. Resume-import page limits remain unchanged.

`POST /api/profile-threads/:id/organise`: body `{currentProfile, revision, recordSection: "workExperiences" | "projects", recordId, consent: true}`. Generates labelled source-index story groups, atomically saves a pending profile suggestion and DRAFT career memory, and returns `{memoryId, revision}`. GET the owned thread to review the new suggestion. Does not apply the suggestion, confirm memory or approve a profile. Concurrent/stale updates return 409; unsupported/empty sources return 422; provider failures return 503 with originals unchanged. Current records must include the selected section and ID. New complete labelled chat answers map to records without a second generative extraction; free-form answers continue through the conversational model.
