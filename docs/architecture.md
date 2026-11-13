# Architecture

CareerFlow is one TypeScript application: a React/Vite client (the Quest interface), an Express
API, PostgreSQL through Prisma, a pg-boss queue with a worker embedded in the API process, and
LangGraph graphs with PostgreSQL checkpoints. Routes are listed in [API.md](API.md); feature
design notes are in [WORKSPACE_MODEL.md](WORKSPACE_MODEL.md).

## Layout

```text
apps/api/src/        Express routes and domain services (one module per feature area)
apps/web/src/        React client; apps/web/src/quest/ holds the Quest pages
packages/agents/     LangGraph workflow, specialists, provider adapter, Scout graph
packages/contracts/  Zod schemas and pure rules shared by API and client
packages/recruitment/ job sources (official ATS boards, Adzuna, web discovery, links)
packages/documents/  resume layout, PDF/DOCX export, PDF text extraction
packages/matching/   the rule-based matching baseline used in fixture mode
prisma/              schema and migrations
scripts/             local run, portable database, demo account, e2e runner
tests/               vitest unit and integration tests; tests/e2e/ Playwright specs
```

## Workspace model

- **Profile**: append-only approved versions. Everything an agent sees comes from the approved
  version; drafts, imports, conversations and external sources become facts only after approval.
- **Application**: one role the user pursues, kept across runs and profile versions. A role found
  by Find roles, Scout or a pasted link is the same application when the role library resolves it
  to the same identity (posting id or cleaned link, else employer, title, city and a similar
  description).
- **Run** (`Mission` row): one durable workflow on a role or a search: budget of 60 model
  requests, human gates, save points, trace spans.
- **Coach**: workspace-level advice per profile version plus rule-based next steps across roles.
- **Capability**: per-skill levels 0–4 computed on read from approved records, stories and
  verified evidence; role requirements become required levels and gaps.

## Agents

The main graph for a run:

```text
Career Coach (skipped when advice for this profile already exists)
  -> Job Matcher (requirement mapping with quoted excerpts, evidence-based score)
  -> choose a role (human; skipped for a run started on a saved role)
  -> resume team: Gap Analyzer -> Evidence Selector -> Rewriter -> Critic (at most two returns)
     -> human review: approve, or return to a named specialist (at most two per run)
     (skipped for a practice-only run, which reuses the role's approved resume)
  -> Interview Coach questions -> answers with per-answer evaluation -> feedback
```

Scout is a separate checkpointed graph: collect roles for the saved search, skip roles already
seen or on the board, rank new ones, then put the shortlist on the board ("New from Scout") or,
when the user opts in, start one resume team per role in parallel.

Live specialists use the OpenAI Responses API with one authorised context-tool call and a Zod
structured result; fixture mode returns deterministic outputs. No web, shell or file tools are
exposed to models, except the opt-in model web search in Scout.

## Guarantees

- **Evidence**: every resume line cites an approved fact; requirement mappings must quote the
  listing, and an unquotable item is dropped, never accepted.
- **Human decisions**: role choice, evidence answers, draft approval and profile approval are explicit and bound to
  the exact version shown (hash or revision checks).
- **Durability**: PostgreSQL row locks, worker leases and checkpoint replay let a run survive a
  reload or a worker restart; cancelled or superseded runs cannot commit late results.
- **Privacy**: scrypt password hashes, hashed session tokens, CSRF on every mutation, owner
  scoping on every query. Models never receive credentials or the account email. Nothing is sent
  to an employer: applying stays manual.

## Running it

- Local: `npm run start:local` (portable PostgreSQL in `.runtime/pglite`, one app process at a
  time) or Docker Compose. See [LOCAL_DEMO.md](LOCAL_DEMO.md).
- Checks: `npm run verify:quick` while iterating, `npm run verify:local` and
  `npm run test:e2e:smoke` before pushing; CI runs the full checks and every browser spec in
  parallel on each pull request.
