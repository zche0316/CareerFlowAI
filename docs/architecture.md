# Architecture and delivery decisions

## Scope

Stage 1 requirements R1–R5 are represented by Profile Builder, Career Coach, Job Matcher, Resume Tailor and Interview Coach. The orchestrator, queue, provider adapter and data services are supporting components, not additional specialist agents.

The first implementation is a modular TypeScript application: React/Vite client, Express API, PostgreSQL/Prisma domain persistence, pg-boss worker and LangGraph with PostgreSQL checkpoints. The worker can run in the API process for simple deployment or separately with `EMBEDDED_WORKER=false`. A page refresh or closed browser does not stop server work. A powered-off server cannot continue work.

The repository layout, shared schemas, HTTP endpoints, sample data and local commands are
specified in [API.md](API.md). The connected five-agent evidence matrix is recorded in
[INTEGRATION_ACCEPTANCE.md](INTEGRATION_ACCEPTANCE.md).

Request IDs, lifecycle transitions and the approved-profile handoff are specified in
[ORCHESTRATION.md](ORCHESTRATION.md). Quality budgets and their test mapping are recorded in
[QUALITY_CHECKS.md](QUALITY_CHECKS.md).

## Requirement traceability

- R1: `createDraft`, `approveProfile`, immutable `Profile` versions and manual form. Server-side review action, user ownership, date/salary validation and optimistic version checks prevent lost updates. Cancellation discards only the draft. Manual preparation works without a model.
- R2: Career Coach uses approved evidence to prepare strengths, gaps, directions and actions; strength evidence IDs are validated.
- R3: The original Member 3 matching algorithm, fixture jobs and regression tests are retained under `packages/matching`. The integrated workflow calls the pure comparison function rather than its unauthenticated file-backed API. Selected jobs are persisted in owned mission context. Optional job comparison preserves missing values and source disclosure.
- R4: Resume Tailor chooses and orders evidence IDs; rendering is extractive. Candidate claim text is copied verbatim from approved facts, not generated paraphrases. Unknown/duplicate evidence IDs are rejected. A hash binds explicit approval to the exact mission/profile/draft version. Drafts and approved resumes are separate, and revision never overwrites the previous approved document.
- R5: Selected-job and approved context produce validated, uniquely identified questions; edited answers are saved in question order. The server derives early completion from persisted answers, and provider failure retains answers. Feedback is practice context, not a new qualification. Subsequent missions can reuse prior feedback as advisory context. Optional O5 salary practice simulates one fictional recruiter reply and persists feedback separately from approved facts; only the user records an accept/decline practice choice.

## Agent workflow

Approved profile -> Career Coach -> Job Matcher -> interrupt for job selection -> Resume Tailor -> interrupt for exact-draft approval -> Interview Coach questions -> interrupt for saved responses -> Interview Coach feedback. A completed interview may then run an optional, single-round salary negotiation practice.

Resume revision branches back to selection/ordering of supported evidence, limited to two revisions. Provider work is capped at 12 model calls per mission. Live generation makes one authorised, argument-validated context tool call followed by a structured response; the complete specialist call has a 25-second timeout. No arbitrary web/terminal tools are exposed to the model.

Domain rows hold factual source versions and human approvals; checkpoints hold graph continuation state. PostgreSQL row locks, worker leases, current-version checks and task-state checks guard side effects. Cancelling or superseding a mission prevents late results from committing. Worker recovery re-enqueues queued work and expired leases. Generation/checkpoint recovery is idempotent at the business layer; this is not a claim that remote LLM billing is exactly once after an abrupt process crash.

## Authentication and privacy

Passwords use salted scrypt hashes. Sessions use random HTTP-only, SameSite=Strict cookies with hashed tokens stored in PostgreSQL. Mutations require the session CSRF token and validate supplied browser origins. All candidate data queries are scoped to the authenticated user. Models receive task context without login credentials or account email. Four downstream sharing permissions are captured in each approved profile; a full mission refuses to run if any required permission is absent.

The Operations/Activity views in this prototype cover the signed-in user's workspace, not a privileged cross-customer administration portal. Demo login is a shared fictional workspace and must be disabled for production. Production requires HTTPS and an explicitly permitted origin. This classroom prototype is not a production security certification.

## Honest modes and proof boundaries

`fixture` is a deterministic development provider, not a local LLM. Fixture jobs and their salary/growth data are labelled fictional; external jobs retain source and retrieval metadata. `openai` uses the Responses API, a controlled context tool and Zod structured outputs. Live mode never silently falls back to fixtures. Missing configuration or provider failures become recoverable mission failures and preserve approved data.

Live vacancy retrieval is implemented through supported official employer APIs and optional configured discovery/aggregator sources. Pasted listings remain unverified. Direct SEEK/Indeed API submission, browser auto-application, email/calendar connectors and hosted deployment are not claimed. See CURRENT_DELIVERY.md for the current evidence boundary. Model choice is configured with `OPENAI_MODEL`; deterministic fixtures and locally exercised live-provider paths are kept separate.

## Jira and ownership

CFS-34/35/36/37: contracts, persistence and orchestration. CFS-12–18: profile and analysis. CFS-20–22: integrated matching. CFS-24–28: factual resume and approval. CFS-30–32: mock interview. CFS-33: optional salary negotiation practice. CFS-39/40/41/42: checks, CI, journey and clean deployment. Existing Jira completion claims are not changed merely because scaffolding exists.

## Deployment

Container services bind published ports to loopback for local demonstration. Docker Compose is supplied; verify it with a running Docker daemon before treating container deployment as tested. The native PostgreSQL helper is development-only and owns `.runtime/postgres` on port 55432. No existing course databases are modified.

GitHub Enterprise Server installations may need an administrator-provided Actions runner and compatible versions of the checkout/setup-node/artifact actions. A committed workflow alone is not a successful CI run.

