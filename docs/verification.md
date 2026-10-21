# Local verification — 22 October 2026

## Verified implementation

- `npm run verify`: strict TypeScript checks, six original matching regression tests, twenty-one domain/API/workflow tests and the production client build passed against PostgreSQL 16.10.
- `npm run test:e2e`: ranked-job selection, full and early-exit interview journeys, and the mobile workspace check. Reviewable screenshots are stored in [docs/evidence](evidence).
- Workflow tests cover persisted human-intervention checkpoints, worker restart, exact resume approval, retained interview answers after provider failure, retry, cancellation, stale profiles, user isolation, sharing consent and CSRF enforcement.
- CFS-21 reruns verify descending scores, visible evidence/gaps/source details, and the selected job surviving into the resume step and activity record. See [ranked jobs](evidence/cfs-21-ranked-jobs.png) and [selected-job handoff](evidence/cfs-21-selected-job-handoff.png).
- CFS-35 runs a dedicated integration scenario that preserves both approved profile versions, isolates pending drafts by owner, rejects discarded drafts, and filters downstream context after consent is revoked.
- A live `deepseek-flash` run through the browser completed all five workflows, answered all three generated interview questions and persisted complete feedback in 8 model calls. See [the live completion evidence](evidence/cfs-31-deepseek-live.png), [full fixture interview](evidence/cfs-32-interview-complete.png) and [early-exit fixture interview](evidence/cfs-32-interview-early-exit.png).
- PostgreSQL 16.10 runs in a project-owned portable instance on port 55432. The application runs at `http://localhost:8787`.
- Desktop and 390-pixel mobile screenshots were visually inspected. The mobile check also asserts no horizontal overflow.
- `docker compose config --quiet` passed configuration validation.

## Remaining proof before release

- The eight job listings are fictional test data. No live vacancy ingestion or external application submission is implemented.
- Docker runtime deployment and hosted deployment have not been tested. Compose validation is not container execution.
- The CI workflow is supplied, but no remote Actions run has been observed.
- Rehearse installation from a clean source archive and have teammates review the requirements and acceptance criteria before declaring Jira stories complete.

Deployment and independent review remain separate from these local checks.
