# CareerFlow API

The HTTP API that the Quest interface uses. Every route below is checked against the code by
`tests/api-docs.test.ts`: a route added without a row here, or a row left after a route is
removed, fails the test. Design notes for each feature are in [WORKSPACE_MODEL.md](WORKSPACE_MODEL.md);
the components behind the routes are in [architecture.md](architecture.md).

## Conventions

- **Session**: `POST /api/auth/register` or `/api/auth/login` sets an HTTP-only, SameSite=Strict
  `cf_session` cookie and returns a `csrf` token. Every route except health, session and the two
  auth routes needs the session; every mutation also needs the `X-CSRF-Token` header.
- **Ownership**: every query is scoped to the signed-in user. Another user's record answers
  `404 NOT_FOUND`, never `403`, so ids cannot be probed.
- **Errors**: JSON `{ code, error, requestId }`. Validation errors are `422 VALIDATION_ERROR` with
  `fields`. Version guards answer `409` (`STALE_PROFILE`, `STALE_APPROVAL`, `RUN_ACTIVE`, ...).
  Every response carries `X-Request-ID`.
- **Runs**: a run (stored as a `Mission` row) is one durable agent workflow. Routes that start or
  resume one answer `202` and the browser polls `GET /api/missions/:id`.
- **Modes**: `PROVIDER_MODE=fixture` is deterministic and free; `openai` makes live model calls.
  A run keeps its mode; live mode never falls back to fixtures.

## Account and workspace

| Method | Path                 | Purpose                                                            |
| ------ | -------------------- | ------------------------------------------------------------------ |
| GET    | `/api/health`        | Liveness, provider mode and agent list                             |
| GET    | `/api/session`       | Current user and CSRF token, recruitment configuration             |
| POST   | `/api/auth/register` | Create an account and sign in                                      |
| POST   | `/api/auth/login`    | Sign in                                                            |
| POST   | `/api/logout`        | End the session                                                    |
| GET    | `/api/workspace`     | Approved profile, recent runs, approved resumes and the role board |

## Profile

Drafts are proposals; a profile version exists only after explicit approval.

| Method | Path                                             | Purpose                                                      |
| ------ | ------------------------------------------------ | ------------------------------------------------------------ |
| POST   | `/api/profiles/prepare`                          | Profile Builder draft from free notes (no approval)          |
| POST   | `/api/profiles/drafts`                           | Save a reviewed draft                                        |
| POST   | `/api/profiles/drafts/:id/approve`               | Approve that exact draft as the next profile version         |
| DELETE | `/api/profiles/drafts/:id`                       | Discard a draft                                              |
| GET    | `/api/profiles/imports`                          | List resume imports                                          |
| POST   | `/api/profiles/imports`                          | Import resume text or pages, with consent                    |
| GET    | `/api/profiles/imports/:id`                      | One import with its pages                                    |
| GET    | `/api/profile-threads`                           | Profile conversations                                        |
| POST   | `/api/profile-threads`                           | Start a conversation                                         |
| GET    | `/api/profile-threads/:id`                       | One conversation with its pending suggestions                |
| POST   | `/api/profile-threads/:id/messages`              | Send a message; the builder replies and may suggest edits    |
| POST   | `/api/profile-threads/:id/controls`              | Skip a question, finish an experience or the interview       |
| POST   | `/api/profile-threads/:id/proposals`             | Turn the conversation into a profile proposal                |
| POST   | `/api/profile-threads/:id/proposals/:proposalId` | Accept or decline one proposal                               |
| POST   | `/api/profile-threads/:id/organise`              | Group a record's details into STAR story suggestions         |
| POST   | `/api/profile-threads/:id/polish`                | Suggest clearer wording for selected lines                   |
| POST   | `/api/profile-sources/:kind/preview`             | Read a public source into a proposal (see below)             |
| GET    | `/api/capabilities`                              | Capability levels 0–4 per skill with confidence and evidence |

`:kind` is `github`, `certificate`, `linkedin`, `website`, `codeforces`, `stackoverflow` or
`leetcode`. The preview returns `{ proposal, merged }`; nothing is saved until the browser posts
`merged` as a draft and approves it.

## Career memory

| Method | Path                       | Purpose                                      |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | `/api/career-memories`     | STAR stories and notes                       |
| POST   | `/api/career-memories`     | Add a memory (draft until confirmed)         |
| PATCH  | `/api/career-memories/:id` | Edit or confirm a memory                     |
| DELETE | `/api/career-memories/:id` | Delete a memory                              |
| GET    | `/api/career-evidence`     | Search approved facts and confirmed memories |

## Roles (applications)

An application is one role the user is pursuing. Runs, resumes and practice for that role hang
off it.

| Method | Path                             | Purpose                                                         |
| ------ | -------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/applications`              | The role board: stage, runs, resumes, level gaps                |
| POST   | `/api/applications`              | Add a role from a public link or a pasted advertisement         |
| POST   | `/api/applications/recheck`      | Re-check tracked listings not checked in the last 20 hours      |
| PATCH  | `/api/applications/:id`          | Record a status (saved to closed) or notes, with history        |
| DELETE | `/api/applications/:id`          | Remove a role that has no runs                                  |
| POST   | `/api/applications/:id/runs`     | Tailor a resume for the role with the current profile           |
| POST   | `/api/applications/:id/practice` | Interview-only run with the role's approved resume              |
| POST   | `/api/missions/:id/saved-roles`  | Save a role from a run's shortlist to the board                 |
| GET    | `/api/insights`                  | Market insight for `country` and role `family` from found roles |
| GET    | `/api/coach`                     | Coach advice for the profile version and next steps             |
| POST   | `/api/coach/refresh`             | Ask the Coach again, optionally with what to revisit (one call) |
| GET    | `/api/estimates`                 | Expected model calls and tokens per run kind (live mode only)   |

## Runs

| Method | Path                                         | Purpose                                                                                                     |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| POST   | `/api/missions`                              | Find roles: start a search run                                                                              |
| GET    | `/api/missions/:id`                          | Run state, results and events                                                                               |
| POST   | `/api/missions/:id/decisions`                | Human decision: choose a role, answer the evidence question, approve or return a draft, finish an interview |
| POST   | `/api/missions/:id/cancel`                   | Cancel a run                                                                                                |
| POST   | `/api/missions/:id/retry`                    | Retry a failed step                                                                                         |
| GET    | `/api/missions/:id/save-points`              | Checkpoints of the run                                                                                      |
| POST   | `/api/missions/:id/branch`                   | Start a new run from a save point, reusing saved results                                                    |
| GET    | `/api/missions/:id/trace`                    | Model-call spans: agents, tokens, time                                                                      |
| POST   | `/api/missions/:id/job-link`                 | Read a public job link into the run's shortlist                                                             |
| GET    | `/api/missions/:id/jobs/:jobId/availability` | Recheck a vacancy with its source                                                                           |
| GET    | `/api/missions/:id/job-fit`                  | Requirement-by-requirement fit for the chosen role                                                          |
| POST   | `/api/missions/:id/resume-agent`             | Ask the resume agent for an edit to the draft                                                               |
| POST   | `/api/missions/:id/resume-agent/manual`      | Apply a manual edit (needs fresh review)                                                                    |
| POST   | `/api/missions/:id/resume-agent/restore`     | Restore an earlier line                                                                                     |
| POST   | `/api/missions/:id/resume-selection`         | Choose which approved resume version the run uses                                                           |
| POST   | `/api/missions/:id/feedback-memory`          | Keep review feedback as a career memory                                                                     |
| PUT    | `/api/missions/:id/answers`                  | Save an interview answer                                                                                    |
| POST   | `/api/missions/:id/interview/rounds`         | One evaluated interview round, with at most one follow-up                                                   |
| GET    | `/api/missions/:id/application`              | Application package for the chosen role                                                                     |
| POST   | `/api/missions/:id/applications`             | Record an official-site handoff or that you applied                                                         |
| GET    | `/api/missions/:id/application-readiness`    | Employer questions and readiness for the role                                                               |
| POST   | `/api/missions/:id/application-readiness`    | Save answers to employer questions                                                                          |

## Resumes

| Method | Path                                | Purpose                                                         |
| ------ | ----------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/resumes/:id/download`         | Download an approved resume as `pdf`, `docx` or `txt`           |
| GET    | `/api/resumes/:id/recruiter-check`  | Recruiter view: PDF read-back, keywords, knock-outs, level gaps |
| GET    | `/api/resumes/:id/wording`          | Wording suggestions for an approved resume                      |
| POST   | `/api/resumes/:id/wording`          | Ask for a factual rewrite of one line                           |
| PATCH  | `/api/resume-wordings/:id`          | Accept or reject one suggestion                                 |
| POST   | `/api/resumes/:id/wording/finalize` | Approve the accepted wording as a new resume version            |

## Scout

| Method | Path                                    | Purpose                                                     |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/scout`                            | Settings, recent sweeps, recorded roles with board stage    |
| PUT    | `/api/scout/settings`                   | Search, roles per sweep, minimum match, opt-in resume teams |
| POST   | `/api/scout/sweeps`                     | Send Scout out now                                          |
| POST   | `/api/scout/roles/:fingerprint/save`    | Save a recorded role to the board                           |
| POST   | `/api/scout/leads/:fingerprint/package` | Paste a lead's advertisement and start its resume team      |

## Data model

| Table                                      | Holds                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `User`, `Session`                          | Accounts, hashed session tokens, current approved profile version     |
| `ProfileDraft`, `Profile`                  | Drafts and append-only approved versions with their facts             |
| `ProfileImport`, `ProfileThread`           | Imported pages and builder conversations                              |
| `CareerMemory`                             | STAR stories and notes, draft until confirmed                         |
| `Application`                              | One role: job snapshot, source, status and history, posting key, mode |
| `Mission`                                  | One run: workflow state, decisions, results, budget, `applicationId`  |
| `ApprovedResume`, `ResumeWording`          | Approved resume versions and wording suggestions                      |
| `TrackedJob`, `ScoutSetting`, `ScoutSweep` | Every role a search showed, Scout settings and sweeps                 |
| `CoachReview`                              | Coach advice per profile version and mode                             |
| `TraceSpan`                                | One row per model call                                                |

LangGraph checkpoint tables and pg-boss tables live in the same database.
