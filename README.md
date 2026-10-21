# ELEC5620_Practical04_Group_2

## CareerFlow AI prototype

A connected five-specialist career workspace with versioned profiles, background missions, explicit approval, evidence-linked resumes and interview practice. All application UI is English.

### Quick start with local PostgreSQL

Requires Node.js 22.12+ (Node 24 LTS recommended), npm and PostgreSQL 15+.

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

Secrets stay server-side and `.env` is ignored. No model key is included. Fixture mode makes no external AI calls, and the UI labels it accordingly. The eight job advertisements remain fictional in both modes. Live AI mode does not silently switch to fixtures after an error. Previously approved profiles/documents and saved interview answers remain available.

### Groq through the OpenAI-compatible API

Configure `.env` as follows, insert your own Groq key, then restart the server (and a separate worker if used):

```dotenv
PROVIDER_MODE=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your-local-groq-key
OPENAI_MODEL=openai/gpt-oss-20b
```

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

See [architecture and requirement mapping](docs/architecture.md), the [API and repository contract](docs/API.md) and the [CFS-41 integration acceptance record](docs/INTEGRATION_ACCEPTANCE.md). Member 3 source provenance is documented in [packages/matching/NOTICE.md](packages/matching/NOTICE.md).
