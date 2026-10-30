# ELEC5620_Practical04_Group_2

## CareerFlow AI prototype

Latest presentation: [30 October minimal SaaS refactor](docs/UI_SAAS_REFACTOR_20261030.md) — compact 56px header, locally bundled fonts, responsive profile/review workspace and preserved workflow controls.

Latest integration: [26 October source integration and validation](docs/STAGE2_INTEGRATION_20261026.md). Earlier dated notes below describe historical snapshots; use the latest record for this branch.

Assessment preparation: [Stage 1 interview](docs/STAGE1_INTERVIEW_MEMBER3.md) · [Quick review](docs/STAGE1_QUICK_REVIEW.md) · [Week 13 readiness audit](docs/WEEK13_READINESS.md) · [Deployment rehearsal](docs/WEEK13_DEPLOYMENT.md) · [Contribution template](docs/CONTRIBUTION_STATEMENT_TEMPLATE.md). Create a source candidate with `npm run package:source`; review it before Canvas upload.

A connected five-specialist career workspace with versioned profiles, background missions, explicit approval, evidence-linked resumes and interview practice. All application UI is English.

### Quick start in VS Code — no PostgreSQL installation required

```sh
cp .env.example .env   # first setup only; preserve an existing .env
npm ci
npm run start:local
```

Open **http://localhost:8787**. In VS Code, F5 → **CareerFlow: database + app** does the same. Startup creates a persistent PGlite development database under `.runtime/pglite`, applies existing Prisma migrations, builds the frontend and starts the existing API/worker. Stop with Ctrl+C. Restarting preserves profiles, missions, approved documents and sessions. No administrator access or system PostgreSQL settings are required.

This uses the PostgreSQL protocol and existing Prisma, pg-boss and LangGraph schemas. Because PGlite has a single PostgreSQL session, the portable mode shares one connection across all three consumers to preserve prepared-statement and transaction isolation. Run one app process; stop it before tests. This is for local development/course demo, not a substitute for concurrent native PostgreSQL deployment. `.runtime/` is ignored by Git; deleting it removes your local database. An existing native database is neither imported nor overwritten.

Run the full local checks with the app stopped:

```sh
npm run verify:local
```

It starts the local database, applies migrations, runs type checking, matching/unit/database integration tests and a production build, then stops the database. It refuses to attach to a port already in use. `npm start` / `npm run dev` and Docker retain the native PostgreSQL workflow below.

### Quick start with local PostgreSQL

Requires Node.js 22.13+ (Node 24 LTS recommended), npm and PostgreSQL 15+.

```sh
cp .env.example .env
npm ci
bash scripts/local-db.sh
npm run db:migrate
npm run build
npm start
```

Open **http://localhost:8787**. Choose **Open demo workspace**, then **My career profile → Use fictional example → Review profile draft → confirm review → Approve & save profile**. Start a career mission, choose a job, review and approve the evidence-linked resume, save an interview answer and request feedback. After feedback, you may optionally practise one fictional salary negotiation and record your own final practice choice.

The local database helper uses only `.runtime/postgres`, port 55432 and database `careerflow`. It does not use the existing PostgreSQL instance on port 5432. Set `PG_BIN` if PostgreSQL binaries are not on PATH. The helper uses local trust authentication and loopback binding for development only.

If you already run your own PostgreSQL, configure `DATABASE_URL` instead of using the helper. For client hot reload run `npm run dev:web` in another terminal and open http://localhost:5173. Use `npm run dev` to watch API changes.

### Docker alternative

```sh
cp .env.example .env
docker compose up --build
```

This uses PostgreSQL in a container and the same UI port. Stop the native project database on 55432 before using Compose, or change the Compose database port. Start Docker Desktop first. Demo defaults are intended for a local course demonstration; do not expose this setup publicly as-is.

### Live AI

Set these values in your local `.env`, then restart the application:

```dotenv
PROVIDER_MODE=openai
OPENAI_API_KEY=your-local-key
OPENAI_MODEL=an-available-model-supporting-tools-and-structured-outputs
```

Secrets stay server-side and `.env` is ignored. No model key is included. Fixture mode makes no external AI calls, and the UI labels it accordingly. Job sources are selected independently from AI mode: real Greenhouse company jobs, Adzuna country search (credentials required), or eight explicitly selected fictional offline jobs. Live AI mode does not silently switch to fixtures after an error. Previously approved profiles/documents and saved interview answers remain available. `PROVIDER_TIMEOUT_MS` controls the shared provider deadline and defaults to 25 seconds; it is validated within a maximum of 30 seconds.

### Groq through the OpenAI-compatible API

Configure `.env` as follows, insert your own Groq key, then restart the server (and a separate worker if used):

```dotenv
PROVIDER_MODE=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your-local-groq-key
OPENAI_MODEL=openai/gpt-oss-120b
```

For an optional Groq Qwen preview comparison, change only `OPENAI_MODEL` to
`qwen/qwen3.8-27b`; use the same Groq key and base URL. This is configuration
support, not a claim that this model has passed the application's live workflow.
Keep the production baseline available until tool calls, structured results,
evidence grounding, response times and failure handling have been checked.
Do not overwrite a populated `.env` with `.env.example`.

`openai` denotes the compatible protocol; the endpoint above sends requests to Groq. The selected model must support function calling and strict structured outputs. This adapter normally uses two requests, separating tool execution from the structured final response, and permits one schema-correction request when a compatible provider returns an invalid field. Groq Responses API is beta; local transport tests do not establish live provider compatibility or account access. Missing credentials produce a recoverable error, not fixture output. Leave `OPENAI_BASE_URL` blank to return to the default OpenAI endpoint. Docker Compose forwards this setting too.

### DeepSeek through the Responses API

DeepSeek exposes an OpenAI-compatible Responses API at `https://api.deepseek.com`:

```dotenv
PROVIDER_MODE=openai
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash
DEEPSEEK_API_KEY=your-local-deepseek-key
```

DeepSeek enables thinking mode by default. CareerFlow explicitly sends
`reasoning.effort: none` for the DeepSeek endpoint because its thinking mode does not support the
required context-tool choice used by the specialist workflow. Keep the key server-side and never
commit it.

### Background worker

The server includes a worker by default. To run it independently, set `EMBEDDED_WORKER=false`, start `npm start`, and run `npm run worker` in another terminal. Checkpoints and tasks persist in PostgreSQL. Closing the browser does not stop work while these services are running. Cancellation and profile-version changes invalidate later writes.

### Verification

```sh
npm run verify
npx playwright install chromium
# Start npm start in another terminal before the browser tests.
npm run test:e2e
```

Tests use disposable QA accounts in the configured database; use a dedicated test database for repeated team/CI runs. API tests clean their own accounts and workflow records. Browser tests retain fictional QA evidence locally. Browser screenshots/reports are written to ignored `output/acceptance` and `playwright-report` directories.

The supplied CI workflow requires a supported GitHub Actions runner; check your university GitHub Enterprise configuration. Container deployment and Canvas on-site deployment must be verified separately before submission. Local live-provider evidence is recorded in `docs/verification.md`.

### Source archive rehearsal

Exclude `.git`, `node_modules`, `.env`, `.runtime`, `output`, `dist`, browser reports and test results. In a clean extracted folder configure `.env`, install locked dependencies, migrate an empty database, build and start. Verify all five workflows and declared fixture/live mode before uploading. Source submission is due **1 November 2026 at 23:59 Australia/Sydney**; 2 November work is post-submission verification and demonstration readiness.

See [architecture and requirement mapping](docs/architecture.md), the [API and repository contract](docs/API.md), [orchestration and profile handoff](docs/ORCHESTRATION.md), [integration quality checks](docs/QUALITY_CHECKS.md) and the [CFS-41 integration acceptance record](docs/INTEGRATION_ACCEPTANCE.md). Member 3 source provenance is documented in [packages/matching/NOTICE.md](packages/matching/NOTICE.md).


### Structured profiles and model router (29 October 2026)

Profiles now support multiple dated employment, project and education records, optional contact details, and source-backed resume imports. PDF/TXT text extraction runs locally; Qwen vision and text organization require explicit consent and live mode. Approved resumes export as TXT, DOCX or searchable PDF. See [setup, workflow, model routing and verification boundaries](docs/PROFILE_IMPORT_AND_MODEL_ROUTER.md). Defaults retain GPT-OSS 120B text with a separately configurable Qwen vision branch and optional economical 20B organizer.

### Tavily discovery (28 October 2026)

Tavily is now an optional job source inside the existing mission workflow. See [configuration, usage and verification boundaries](docs/TAVILY_INTEGRATION.md). Configure `TAVILY_ACCESS_MODE=api_key` and `TAVILY_API_KEY` in the private `.env`, restart, then select **Tavily discovery · verified public job boards**. The backend discovers up to five links and confirms postings through public Greenhouse, Lever or Ashby APIs before matching. Public ATS reads need no keys; Tavily account-backed search needs its own key. Explicit limited `keyless` mode is supported separately. Adzuna remains optional legacy support and is omitted from `.env.example`.

### Desktop integration: real recruitment

Create a career mission and choose **Job source**, **Job country**, **State / region**, optional city and keywords. Matching retrieves vacancies in the existing Job Matching Agent workflow; selected jobs continue into resume tailoring and interview preparation. Greenhouse searches one company board (default `spaceship`), not all employers. Adzuna searches the selected country with optional region/city; results are limited to its first 30 listings. Eight countries are supported: AU, NZ, GB, US, CA, SG, DE, FR. Leaving region empty includes all regions covered by that source. No results is a valid outcome.

Source failures use the existing failed mission/retry flow and never silently substitute sample jobs. Select **Fictional demo jobs** explicitly for an offline demonstration. AI fixture mode and live recruitment are independent; live recruitment needs network access. Extracted skills from unstructured descriptions are heuristic, low confidence; scores are suitability indicators, not hiring predictions.

After selecting a real job and approving the resume, **Prepare your real application** shows the exact approved document and official destination. Download the resume and open the listing to apply. Recording a completed submission requires explicit user confirmation and is labelled user-reported, never API-verified. Direct SEEK/Indeed search or submission is not implemented; partner authorization would be required. No credentials were transferred from any older project.

Optional Adzuna server environment:

```dotenv
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
```

Open this folder in VS Code using `CareerFlowAI.code-workspace`. Tasks provide build, checks and startup. PostgreSQL is still required by the group's existing application architecture.


### Integration verification (2026-10-19)

Type checking, production build, six original matching tests and ten domain/provider/recruitment unit tests passed. PostgreSQL initialization in the Codex execution environment failed with `could not create shared memory segment: Operation not permitted`; database integration and browser journey tests have not been validated for this change. Run the Quick start in a normal VS Code terminal with PostgreSQL installed, or use Docker Desktop. The local `.env` contains no copied model credentials; configure keys manually if live AI is needed.


### Today's feature and interface migration

The numbered 01–08 workflow navigation now opens the existing account and mission workspace. PostgreSQL, approved profile versions, LangGraph tasks, explicit review gates and the existing API remain in use. Optional tools include self-reported application progress, a fact-grounded cover letter with reviewed download, persistent reminders/calendar export and scripted salary negotiation practice. Their data lives in the owning mission's JSON and updates transactionally. The dashboard counts one current self-reported status per mission, so separate missions for the same job can count separately.

In the new mission form choose **SEEK / Indeed · paste a listing** to supply a listing URL and description manually. Only supported official listing URL patterns are accepted. This does not fetch a private website or verify that a vacancy is still open; cards label that distinction. API-retrieved Greenhouse/Adzuna jobs remain separate choices. Both kinds can continue to approved resume preparation and official-site handoff.

VS Code: open `CareerFlowAI.code-workspace`, run **Terminal → Run Task → CareerFlow: database** (PostgreSQL must be installed), then press F5 and choose **CareerFlow: run group API**. The group app opens on port 8787. This is distinct from the old prototype on 8791. Keys must be entered manually in this repository's `.env`; none were transferred.

Validation for this migration: typecheck, production build, 16 domain/provider/recruitment/tools unit tests and six original matching tests passed. PostgreSQL-backed integration tests and the complete real AI browser journey still require validation in an environment where PostgreSQL can start. The previous source was backed up separately before this update; Git history is preserved and no remote push was performed.


### 03 Job Matching — Australian live employer search (19 October 2026)

New missions default to **Official employer boards · multiple companies**, **Australia**, all regions. Search concurrently reads published Greenhouse job boards for Spaceship, VGW, GoFundMe and MongoDB, keeps Australian locations, deduplicates official application URLs and ranks jobs using the existing approved-profile comparison. This curated set is not a nationwide census of all vacancies; Adzuna remains available with separate credentials for broader search. Employer failure is displayed, and all-source failure asks for retry without fixture substitution.

Every card now shows retrieval time, vacancy status and an immediately visible official application link. **Recheck availability** calls the job-specific official API, rather than guessing from a webpage returning HTTP 200. Selection rechecks Greenhouse jobs before queuing the human decision; removed vacancies are rejected and transient source errors leave selection unchanged. This checks publication at a point in time, not guaranteed future availability or eligibility. Adzuna and pasted listings remain explicitly unverified by this recheck.

**My career profile → Autofill Australian resume draft** reuses the signed-in user's approved evidence, sets Australia and AUD, resets approval and lets the user edit. Without approved facts, qualifications and experience stay blank and sharing stays disabled. **Download current resume draft** produces an editable text draft with missing contact/work-rights fields clearly marked. Actual application resumes still pass the existing evidence-linked approval workflow.

Local verification: `npm run typecheck`, `npm run build`, 22 Vitest unit tests and 6 original matching tests passed (28 total). A real network check retrieved 12 Australian vacancies across all four boards and independently rechecked the first four via official single-job APIs. See `docs/REAL_AUSTRALIA_VERIFICATION.md`. Database-backed integration/browser validation remains blocked by the previously recorded PostgreSQL environment restriction; no complete deployed app or real AI journey is claimed.


### Database startup repair verified — 19 October 2026

The earlier shared-memory startup blocker is resolved for local development using the project-owned portable database. `npm run verify:local` passed: type checking, 29 Vitest tests (including all seven database integration tests), six original matching tests and production build — 35 tests total. The browser also successfully opened the group app, saved/approved a fictional demo profile and persisted a live Australian matching run with 12 source vacancies. AI mode remained explicitly local fixtures; no live model call or real application submission is claimed. Prior notes describing database tests as blocked are historical and superseded by this verification.


### Screenshot-based interface baseline

The group application now uses the navy header and horizontal 01–08 workflow tabs from the supplied prototype screenshot. Each tab presents its own stage rather than scrolling through the entire mission. Account, approvals, library and mission overview remain available as workspace utilities. Missing prerequisites are explicit: Resume tailoring directs the user to select a target in 03; Interview practice requires an approved resume; Real applications requires a real job and approved document. 03 includes a direct Search Australian jobs action. The existing server-side decisions, approved evidence and database are unchanged.


### Sprint 1 Adzuna matching improvements

See [setup and acceptance evidence](docs/SPRINT1_JOB_MATCHING.md). Recruitment defaults now read `JOB_SOURCE` and `ADZUNA_COUNTRY`; Adzuna availability is shown without exposing keys. 03 can suggest editable keywords/location from the approved profile, sending only search terms to the job source. Normalization now deduplicates records, preserves missing salary, distinguishes estimated salaries and shows provider total/page limits. Rate limits, Retry-After, rejected credentials and timeouts have explicit safe messages. The user has not applied for Adzuna credentials yet: live Adzuna validation remains pending and mocked transport tests are labelled accordingly.

Sprint 1 update verification: `npm run verify:local` passed all 44 tests, type checking, migrations and production build. This includes mocked Adzuna scoring/handoff and rate-limit retry integration tests. It does not claim real Adzuna access without credentials.
