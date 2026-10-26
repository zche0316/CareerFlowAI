# Local database startup repair — 19 October 2026

## Cause

The Mac has no system PostgreSQL installation on PATH. The downloaded native development runtime cannot allocate its small System V shared-memory segment in the execution environment (`shmget: Operation not permitted`). No system limits or permissions were changed.

## Working local path

Run `npm run start:local`, or VS Code F5 → **CareerFlow: database + app**. The runner starts a project-local persistent PGlite database, applies the existing Prisma migrations, builds the client and launches the existing server/embedded worker on localhost:8787. Local data is in `.runtime/pglite`; Git ignores it. Ctrl+C stops both app and database.

The runner overrides `DATABASE_URL` and `DEV_DATABASE=portable` only for its children. It does not replace `.env`, copy keys or alter an existing native database. Startup refuses a database port in use rather than attaching to an unknown database. Do not run multiple app instances or parallel test processes against this development database.

PGlite provides one PostgreSQL session. Separate connection pools caused prepared statements from different consumers to collide. Portable mode now shares a single `pg.Pool` (max 1) between Prisma, pg-boss and the LangGraph PostgresSaver. Transactions retain exclusive pool ownership. The worker uses polling instead of a separate LISTEN session. The existing native PostgreSQL and Docker paths retain separate pools and concurrent deployment behavior; production rejects portable mode.

## Verification

`npm run verify:local` starts/stops its own database and passed all steps: migrations; TypeScript; 6 original matching tests; 29 Vitest tests, including all 7 PostgreSQL-backed integration tests; production build. Total: 35 tests.

Browser checks on the group app confirmed demo login, save/review/approval of the fictional Alex Morgan profile, background matching against four real Australian employer boards (12 jobs), visible official application links, and persisted profile/session/mission data after a full app/database stop and restart. The service health route returned HTTP 200 / ok. These checks used local fixture AI; no live model or application submission was involved.

The database and app were left running at http://localhost:8787. The older standalone prototype on 8791 is separate. No GitHub push, independent review or production PostgreSQL concurrency validation is claimed.

References: [PGlite socket documentation](https://pglite.dev/docs/pglite-socket), [PostgreSQL kernel resource documentation](https://www.postgresql.org/docs/17/kernel-resources.html).
