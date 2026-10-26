# Windows local UC4 validation — 26 October 2026

## Result

The application started locally with a persistent portable database. All 65 non-browser tests,
TypeScript checks, the production build and all 7 Playwright tests passed on this checkout.
The new UC4 checks exercise real database write rejection, safe retry, cancellation and revision approval.

## Environment

- Windows workstation; Node.js 24.15.0; npm 11.12.1.
- Source baseline: `acbfa497bf217601805d40e6081f38984f4770e9` (group main / PR #3).
- PGlite `0.5.11` and matching socket package `0.2.14`, pinned in the lockfile.
- Local database: loopback port `55462`; persistent files under `.runtime/pglite`.
- Application: `http://localhost:8787`; AI provider and job source explicitly set to `fixture` / `fixtures`.
- One app process owns the portable database. Stop it before running `verify:local`.
- Local `.env`, database, test accounts, generated screenshots and logs are ignored by Git.

## Changes verified

1. **CFS-27 / CFS-28 — failed resume persistence.** A temporary CHECK constraint rejects
   only the disposable test mission's approved-resume insert. The mission reports failure,
   retains the exact draft and approval decision, and leaves the earlier approved document
   unchanged. After the constraint is removed, retry saves exactly one new version of the
   same draft. A repeated approval is rejected. The constraint is removed in `finally`.
2. **Portable database recovery.** The original pinned packages produced a stuck RUNNING
   mission or an unexpected backend protocol message after the rejected write. The patch
   update resolves the regression in the targeted test and full local suite. Upstream
   context: [extended-query error synchronization fix](https://github.com/electric-sql/pglite/pull/1144).
   The approved-resume transaction remains atomic; driver errors are translated into a
   bounded, user-facing retry message before they reach workflow checkpoints.
3. **CFS-27 — cancellation.** Cancelling another unapproved resume retains the previous
   saved document and rejects subsequent approval/retry. The browser also verifies that a
   cancelled draft does not enter the document library after a reload.
4. **CFS-26 — revision limit.** After two revisions, the revision button is disabled with
   clear next steps. Each changed draft clears the earlier review confirmation; explicit
   approval of the current draft is still possible after reaching the revision limit.

## Commands and evidence

From the repository folder, configure `.env` from `.env.example` on first setup, preserving
any existing credentials. This run used `LOCAL_DB_PORT=55462` and `JOB_SOURCE=fixtures`.

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run verify:local
# After verification stops its database:
npm.cmd run start:local
# In another terminal, against the single running app:
npm.cmd run test:e2e
```

- `verify:local`: 6 original matching tests + 59 Vitest tests; typecheck and production build passed.
- Playwright: 7/7 passed in 44.2 seconds, including both new UC4 browser cases.
- Runtime evidence (local, ignored): `output/local-verification-20261026.log`,
  `output/browser-verification-20261026.log`, `playwright-report/index.html`.
- Screenshots (local, ignored): `output/acceptance/cfs-26-resume-revision-limit.png`,
  `output/acceptance/cfs-27-cancelled-resume-library.png`, `output/acceptance/local-app-ready.png`.

## Scope

This is local functional validation with fictional inputs. It makes no paid model calls.
It does not establish current live-provider compatibility, real job-source availability,
native PostgreSQL/Docker behavior for this patch, independent teammate acceptance, or Canvas
upload/download deployment. Jira acceptance, assignments and sprint state are separate team decisions.
