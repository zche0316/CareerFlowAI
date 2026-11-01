# CareerFlow AI

A local career workspace with five specialist agents: Profile Builder, Career Coach, Job Matcher, Resume Tailor and Interview Coach. Approved profile versions, background missions, human decisions and evidence-grounded application documents persist in PostgreSQL.

Progress, acceptance results, defects and delivery evidence are managed in [Jira](https://careerflow-elec5620-group2.atlassian.net/jira/software/projects/CFS/boards/2). Repository documentation covers how to use, run and maintain the application.

## Documentation

- [User journey](docs/english-user-journey.md): fictional walkthrough with messages and expected user actions.
- [Product workflow](docs/PRODUCT_WORKFLOW.md): source material, approved profile and application version boundaries.
- [Architecture](docs/architecture.md): components, agent workflow, ownership and persistence.
- [API contract](docs/API.md): endpoints, schemas and repository boundaries.
- [Orchestration](docs/ORCHESTRATION.md): durable missions, lifecycle and approved context handoff.
- [Deployment playbook](docs/WEEK13_DEPLOYMENT.md): source packaging, clean installation and course demonstration.
- [Optional S3 backups](docs/AWS_S3_BACKUPS.md): private approved-PDF backup configuration and user flow.

Member 3 matching-source provenance is retained in [NOTICE.md](packages/matching/NOTICE.md).

## Local startup

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

## Docker

Start Docker Desktop and configure the private `.env`, then run:

```sh
docker compose up --build
```

Compose runs the app and PostgreSQL. Default published ports are 8787 and 55432; stop conflicting project services or adjust Compose ports first. The supplied configuration is intended for local use.

## Configuration

Use `.env.example` for supported settings; never overwrite a populated `.env` or commit credentials.

- **AI:** `PROVIDER_MODE=openai` uses the configured provider. Set the appropriate key, model and endpoint in `.env`; model routing can distinguish text, light text and vision tasks. A compatible model must support the tools and structured outputs used by the workflow. Resume vision processing requires explicit consent. Restart the app and any separate worker after changes.
- **Offline verification:** `PROVIDER_MODE=fixture` with `JOB_SOURCE=fixtures` uses labelled fictional data and deterministic outputs. This is not a local LLM or proof of live provider availability. A failed live mission does not silently switch to fixtures.
- **Recruitment:** official employer APIs, optional Tavily discovery and optional Adzuna use separate configuration. Pasted listings retain user-provided provenance. Search results expose source and missing information; a match score is not a hiring probability.
- **Cloud backup:** set `S3_BACKUP_BUCKET`, `AWS_REGION` and `AWS_PROFILE` as described in the [S3 guide](docs/AWS_S3_BACKUPS.md). A blank bucket disables cloud backup. Local DOCX/PDF downloads remain available independently.
- **Separate worker:** the API embeds a worker by default. With native PostgreSQL, set `EMBEDDED_WORKER=false`, start the API, and run `npm run worker` separately. Portable mode must retain a single app process.

Closing the browser does not stop a running server mission. A stopped server cannot continue work. Cancellation and profile-version changes guard against stale writes.

## Checks

With the portable app stopped:

```sh
npm run verify:local
```

This starts the database, applies migrations, runs type checking, source packaging checks (Python 3), matching/unit/integration tests and a production build, then stops the database.

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

Run `npm run package:source`, inspect its contents and follow the [deployment playbook](docs/WEEK13_DEPLOYMENT.md) for clean-source installation. Keep credentials, databases, dependencies, generated builds, logs and personal documents outside the source archive. Record submission and verification outcomes in Jira.
