# CareerFlow AI

CareerFlow AI narrows the information gap for people looking for technical roles across regions. It finds roles on official job boards and verifiable sources, shows what each region's roles actually ask for, rates your capability per skill from evidence you approve (including GitHub, certificates and contest profiles), and tailors an evidence-grounded resume for each role you pursue, with interview practice.

A team of agents (Profile Builder, Career Coach, Scout, Job Matcher, a resume team and Interview Coach) works on a long-lived workspace: approved profile versions, one quest per role, durable runs, human decisions and documents persist in PostgreSQL. Applying stays manual: nothing is sent to an employer.

Progress, acceptance evidence and defects are tracked in [Jira](https://careerflow-elec5620-group2.atlassian.net/jira/software/projects/CFS/boards/2).

## Documentation

- [Local run and demo guide](docs/LOCAL_DEMO.md): setup, demo account, demo workflow, live runs and the feature checklist.
- [Workspace model](docs/WORKSPACE_MODEL.md): design notes for roles, the role library, capability levels, recruiter view, profile sources and market insight.
- [Architecture](docs/architecture.md): components, agents and guarantees.
- [API](docs/API.md): every HTTP route, conventions and the data model.

Member 3 matching-source provenance is retained in [NOTICE.md](packages/matching/NOTICE.md).

## Run it locally

Requires Node.js 22.13+ (Node 24 recommended) and npm.

```sh
cp .env.example .env # first setup only; preserve an existing .env
npm ci
npm run start:local
```

Open **http://localhost:8787** and create an account, or run `npm run demo:account` in a second terminal for a ready account with a fictional graduate profile. VS Code F5 → **CareerFlow: database + app** runs the same startup.

The runner starts a persistent portable PostgreSQL (PGlite) under `.runtime/pglite`, applies migrations, builds the client and starts the API with its background worker. Ctrl+C stops both; restarting keeps your records. Portable mode uses one shared connection, so run one app process at a time.

### Docker

```sh
cp .env.example .env # first setup only
docker compose up -d --build --wait
```

Open **http://localhost:8787**. Data persists in the Compose volume; `docker compose down -v` deletes it. Set `APP_PORT`/`DB_PORT` in `.env` to move the default ports 8787/55432.

### Native PostgreSQL

With PostgreSQL 15+ and `DATABASE_URL` set: `npm ci && npm run db:migrate && npm run build && npm start`. `bash scripts/local-db.sh` starts a project-owned development database under `.runtime/postgres` on port 55432. With native PostgreSQL the worker can run separately (`EMBEDDED_WORKER=false`, then `npm run worker`).

## Configuration

See `.env.example`; never commit `.env`.

- **Mode:** `PROVIDER_MODE=fixture` (with `JOB_SOURCE=fixtures`) is deterministic, free and offline. `PROVIDER_MODE=openai` makes live model calls; a run keeps the mode it started in and never falls back to fixtures.
- **Job sources:** official employer boards (Greenhouse, Lever, Ashby) need no key; Adzuna and Tavily web discovery are optional. Scout's model web search needs `OPENAI_NATIVE_API_KEY`.
- **Profile sources:** GitHub works without a key; `GITHUB_TOKEN` raises the rate limit.

## Development workflow

- Each change starts from a Jira CFS issue; one commit per issue, with the issue key in the commit and branch.
- Commit locally until a module is complete, then push once and open a pull request; CI runs the full checks and every browser spec in parallel.
- Checks while iterating: `npm run verify:quick` and the browser spec for the page you changed (`npm run test:e2e:local -- tests/e2e/<spec>.spec.ts`). Before pushing, with the app stopped: `npm run verify:local` and `npm run test:e2e:smoke`.
- Browser tests run a fixture-mode app on a disposable database under `.runtime/pglite-e2e`; your records in `.runtime/pglite` are never opened. Set `PORT` and `LOCAL_DB_PORT` when the defaults are in use.
