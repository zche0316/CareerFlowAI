> Historical verification record. Counts, capabilities and measurements below apply to their stated revision. For current capabilities and release checks, start with [CURRENT_DELIVERY.md](CURRENT_DELIVERY.md).

# Local verification — 22 October 2026

## Verified implementation

- `npm run verify`: strict TypeScript checks, six original matching regression tests, thirty-one domain/API/workflow tests and the production client build passed against PostgreSQL 16.10.
- `npm run test:e2e`: explicit profile review, ranked-job selection, full and early-exit interview journeys, salary negotiation and the mobile workspace check. Reviewable screenshots are stored in [docs/evidence](evidence).
- Workflow tests cover persisted human-intervention checkpoints, worker restart, exact resume approval, retained interview answers after provider failure, retry, cancellation, stale profiles, user isolation, sharing consent and CSRF enforcement.
- CFS-21 reruns verify descending scores, visible evidence/gaps/source details, and the selected job surviving into the resume step and activity record. See [ranked jobs](evidence/cfs-21-ranked-jobs.png) and [selected-job handoff](evidence/cfs-21-selected-job-handoff.png).
- CFS-35 runs a dedicated integration scenario that preserves both approved profile versions, isolates pending drafts by owner, rejects discarded drafts, and filters downstream context after consent is revoked.
- CFS-34 is specified in [API.md](API.md) and [INTEGRATION_ACCEPTANCE.md](INTEGRATION_ACCEPTANCE.md), including repository boundaries, schemas, endpoints, sample data and run commands.
- CFS-13 verifies explicit review plus browser persistence and forces a profile-version write conflict to prove that failed approval rolls back the user pointer, previous approved data and draft status. See [review evidence](evidence/cfs-13-profile-review.png) and [approved v1 evidence](evidence/cfs-13-approved-v1.png).
- CFS-18 verifies evidence IDs and reasons across all Coach sections, correction with no profile, live-provider failure preservation, cross-user source rejection, and user feedback creating an independently owned refinement mission.
- CFS-37 adds propagated request IDs, documents lifecycle/stale/cancel behavior and verifies approved-context orchestration. See [ORCHESTRATION.md](ORCHESTRATION.md).
- CFS-14 verifies successful handoff, missing input, discarded edits and sharing denial, and proves that a pending unapproved profile is never used by a mission.
- CFS-39 records measured load/save budgets and a mocked provider deadline test enforcing a maximum 30-second configuration. See [QUALITY_CHECKS.md](QUALITY_CHECKS.md).
- CFS-33 / O5 exercises one fictional salary negotiation using role/offer context, persists provider feedback, and records the user's final accept/decline practice choice. See the [live salary practice](evidence/cfs-33-salary-negotiation-live.png) and [fixture salary practice](evidence/cfs-33-salary-negotiation-fixture.png).
- A live `deepseek-flash` run through the browser completed all five workflows, answered all three generated interview questions, practised one salary negotiation and persisted complete feedback in 10 model calls. See [the live completion evidence](evidence/cfs-31-deepseek-live.png), [full fixture interview](evidence/cfs-32-interview-complete.png) and [early-exit fixture interview](evidence/cfs-32-interview-early-exit.png).
- GitHub Actions completed successfully for both push and pull-request events on the verified branch.
- Docker Compose built and started the PostgreSQL and application containers. The healthy containerized app passed the complete five-test Playwright suite.
- A `git archive` source snapshot was extracted into an independent directory. Locked dependency installation, migration, `npm run verify`, Compose startup, health checks and all five browser tests passed from that clean snapshot.
- PostgreSQL 16.10 runs in a project-owned portable instance on port 55432. The application runs at `http://localhost:8787`.
- Desktop and 390-pixel mobile screenshots were visually inspected. The mobile check also asserts no horizontal overflow.
- `docker compose config --quiet` passed configuration validation.

## Remaining proof before release

- The eight job listings are fictional test data. No live vacancy ingestion or external application submission is implemented.
- Hosted deployment has not been tested. Final source submission and on-site deployment remain separate release gates.
- Independent review findings and resolved rework are still required before Jira stories can move to Done.
- The exact final archive must be rehearsed again after the release changes are merged and recorded with its checksum.
- Dependency auditing reported six package advisories in the container install output; assess these before public deployment.

Deployment and independent review remain separate from these local checks.

