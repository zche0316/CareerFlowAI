# CareerFlow AI

A local career workspace with five specialist agents: Profile Builder, Career Coach, Job Matcher, Resume Tailor and Interview Coach. Approved profile versions, background missions, human decisions and evidence-grounded application documents persist in PostgreSQL.

Progress, acceptance results, defects and delivery evidence are managed in [Jira](https://careerflow-elec5620-group2.atlassian.net/jira/software/projects/CFS/boards/2). Repository documentation covers how to use, run and maintain the application.

## Documentation

- [User journey](docs/english-user-journey.md): fictional walkthrough with messages and expected user actions.
- [Product workflow](docs/PRODUCT_WORKFLOW.md): source material, approved profile and application version boundaries.
- [Architecture](docs/architecture.md): components, agent workflow, ownership and persistence.
- [API contract](docs/API.md): endpoints, schemas and repository boundaries.
- [Orchestration](docs/ORCHESTRATION.md): durable missions, lifecycle and approved context handoff.
- [Multi-agent plan](docs/MULTI_AGENT_PLAN.md): resume team, human review gates and the reverse job search roadmap.
- [Readiness for real users](docs/READINESS.md): what works end to end, latest live checks and remaining gaps.
- [Deployment playbook](docs/WEEK13_DEPLOYMENT.md): source packaging, clean installation and course demonstration.
- [Evaluation](docs/EVALUATION.md): labelled set, measured results and regression floors.
- [Optional S3 backups](docs/AWS_S3_BACKUPS.md): private approved-PDF backup configuration and user flow.

Member 3 matching-source provenance is retained in [NOTICE.md](packages/matching/NOTICE.md).

## Docker deployment from the submitted source

For the Week 13 on-site demonstration, download the submitted ZIP from Canvas, extract it into a new folder and open a terminal in the `CareerFlowAI` folder. Docker Desktop must be running. This path needs no host Node.js/npm installation.

```sh
cp .env.example .env # first setup only
# Edit the private .env with your model/job settings; keep it outside the submitted ZIP.
docker compose up -d --build --wait
docker compose ps
```

Open **http://localhost:8787** and create an account. The image installs locked dependencies and builds the app from source; startup applies migrations to PostgreSQL. Local data persists in the Compose volume. `docker compose down` stops services while retaining it; `down -v` deletes that deployment's database.

Default host ports are 8787/55432. Stop the old local instance before using them, or set `APP_PORT`/`DB_PORT` in the private `.env`; the browser origin follows `APP_PORT`. Use a distinct Compose project and fresh data volume for an independent rehearsal. Docker builds need access to the base image, OS packages and npm dependencies unless these have already been cached on the demonstration machine.

For deterministic offline verification, explicitly set `PROVIDER_MODE=fixture` and `JOB_SOURCE=fixtures`. For the actual AI demonstration, configure your provider in the private `.env`; native `OPENAI_NATIVE_*` settings are forwarded too. Internet access is required for live model/job requests and S3.

### Optional S3 inside Docker

Existing private S3 buckets can be reused. On your demo computer, add the following to the private `.env` (use the existing bucket's actual name):

```dotenv
S3_BACKUP_BUCKET=<existing-bucket-name>
AWS_REGION=ap-southeast-2
AWS_PROFILE=careerflow
COMPOSE_FILE=compose.yaml:compose.aws-profile.yaml
```

Then use the same normal startup command: `docker compose up -d --build --wait`. No Python session helper is required. The optional override mounts the host AWS config read-only and login cache read/write at runtime so the installed SDK can use and refresh the existing `aws login` session. It does not mount static credentials or copy credentials into source/image. This grants the local app access to the mounted login cache; use it only on your own trusted demo computer. A fully expired login still needs browser sign-in again. Optional `AWS_HOST_CONFIG` and `AWS_HOST_LOGIN_CACHE` select different absolute host paths; defaults use your home directory. The colon-separated `COMPOSE_FILE` example is for macOS/Linux.

The older `scripts/docker-aws-session.py` / `compose.aws.yaml` session-export route remains an alternative for hosts where cache mounting is unsuitable; do not combine both overrides.

Without AWS, leave `S3_BACKUP_BUCKET` blank, leave `COMPOSE_FILE` unset, and run only `compose.yaml`; local PDF/DOCX exports and the rest of the journey remain available. See the [deployment playbook](docs/WEEK13_DEPLOYMENT.md) and [S3 guide](docs/AWS_S3_BACKUPS.md).

## Optional local development

Requires Node.js 22.13+ (Node 24 recommended) and npm.

```sh
cp .env.example .env # first setup only; preserve an existing .env
npm ci
npm run start:local
```

Open **http://localhost:8787** and create an account. VS Code F5 → **CareerFlow: database + app** runs the same startup flow.

The runner starts persistent PGlite under `.runtime/pglite`, applies Prisma migrations, builds the frontend and starts the API with its background worker. Ctrl+C stops the app and database. Restarting preserves local records; deleting `.runtime/pglite` removes them.

Portable mode uses one shared PostgreSQL connection. Run one app process and stop it before testing; do not attach another app or test process to that instance. Use native PostgreSQL or Docker for concurrent deployments.

## Native PostgreSQL

Requires PostgreSQL 15+. Set `DATABASE_URL` in `.env` for your database, then run:

```sh
npm ci
npm run db:migrate
npm run build
npm start
```

Alternatively, `bash scripts/local-db.sh` starts the project-owned development database under `.runtime/postgres` on port 55432. It uses loopback binding and trust authentication for local development. Set `PG_BIN` if its binaries are not on PATH. It does not replace an existing PostgreSQL installation.

For frontend development, run `npm run dev:web` and open http://localhost:5173. `npm run dev` watches API changes.

## Configuration

Use `.env.example` for supported settings; never overwrite a populated `.env` or commit credentials.

- **AI:** `PROVIDER_MODE=openai` uses the configured provider. Set the appropriate key, model and endpoint in `.env`; model routing can distinguish text, light text and vision tasks. A compatible model must support the tools and structured outputs used by the workflow. Resume vision processing requires explicit consent. Restart the app and any separate worker after changes.
- **Offline verification:** `PROVIDER_MODE=fixture` with `JOB_SOURCE=fixtures` uses labelled fictional data and deterministic outputs. This is not a local LLM or proof of live provider availability. A failed live mission does not silently switch to fixtures.
- **Recruitment:** official employer APIs, optional Tavily discovery and optional Adzuna use separate configuration. Pasted listings retain user-provided provenance. New live missions use source-quoted LLM requirements mapped to approved facts, with inspectable code scoring and coverage for unknown categories. Fixture missions retain the original rule-based baseline. Search results expose source and missing information; a match score is not a hiring probability.
- **Cloud backup:** set `S3_BACKUP_BUCKET`, `AWS_REGION` and `AWS_PROFILE` as described in the [S3 guide](docs/AWS_S3_BACKUPS.md). A blank bucket disables cloud backup. Local DOCX/PDF downloads remain available independently.
- **Separate worker:** the API embeds a worker by default. With native PostgreSQL, set `EMBEDDED_WORKER=false`, start the API, and run `npm run worker` separately. Portable mode must retain a single app process.

Closing the browser does not stop a running server mission. A stopped server cannot continue work. Cancellation and profile-version changes guard against stale writes.

## Checks

With the portable app stopped:

```sh
npm run verify:local
```

This starts the database, applies migrations, runs type checking, source packaging checks (Python 3), matching/unit/integration tests and a production build, then stops the database.

For browser tests, with the app stopped:

```sh
npx playwright install chromium # first time only
npm run test:e2e:local
```

This starts a fixture-mode app on a disposable database under `.runtime/pglite-e2e` and runs both Playwright projects: `classic` (the group interface at `?classic=1`) and `quest` (the default interface). Your local records in `.runtime/pglite` are not opened.

With a dedicated native test database configured:

```sh
npm run verify
npx playwright install chromium
# Start the app against that test database, then run:
npm run test:e2e
```

Use disposable QA data and explicitly select fixture mode for offline checks. Clear live model keys when a check must not call an external provider. API tests clean their own records; browser tests may retain fictional QA records. Screenshots and reports belong in ignored `output/`, `playwright-report/` and `test-results/`, while results and delivery evidence belong in Jira.

The optional retrieval experiment uses synthetic labels from `tests/fixtures/career-retrieval.json`. `npx tsx scripts/evaluate-career-retrieval.ts` prints keyword results; `python3 scripts/evaluate-career-vectors.py` writes vector results under `output/retrieval-evaluation/`. The latter requires PyTorch/Transformers and downloads a public model on first use. Neither experiment establishes production retrieval quality.

## Source packaging

Use a clean checkout of a fixed, verified GitHub `main` commit, then run `python3 scripts/package-source.py` (or `npm run package:source`). The script includes the optional Docker/AWS configuration and records source-file hashes. Inspect the ZIP and rehearse from its extracted contents using the [deployment playbook](docs/WEEK13_DEPLOYMENT.md). Keep credentials, databases, dependencies, generated builds, logs and personal documents outside the source archive. Record submission and verification outcomes in Jira.
