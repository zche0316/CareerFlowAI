# CFS-41 integrated five-agent acceptance record

This record maps the integrated journey to the evidence currently present in the repository. It does
not claim a hosted deployment or independent review.

## Acceptance mapping

| Requirement                                         | Evidence                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual provider calls where available               | The live `deepseek-flash` browser run completed 10 Responses API calls across Career Coach, Resume Tailor, Interview Coach questions, interview feedback and optional negotiation |
| Task perception and approved context                | The mission pins the approved profile version and selected job; the provider must call the allowlisted `read_approved_context` tool before returning structured output            |
| Agent decisions                                     | Job selection, exact resume approval, interview completion/early exit and negotiation decisions are persisted as human-confirmed state                                            |
| Internal interactions                               | LangGraph interrupts, PostgreSQL checkpoints, pg-boss work leases, Prisma domain writes, evidence validation and budget accounting are exercised by integration tests             |
| External interactions                               | The provider adapter performs real Responses API calls in live mode and makes no external AI call in fixture mode                                                                 |
| UC2 recommendations                                 | The browser journey renders Career Coach strengths, gaps, directions and next actions with evidence references                                                                    |
| Connected UC1–UC5 handoff                           | Approved v1 profile → Career Coach → Job Matcher → selected Business Intelligence Intern → approved evidence resume → three role-specific interview questions → complete feedback |
| Optional O5                                         | One fictional salary negotiation used the selected role and approved context, returned recruiter feedback and persisted the user's final practice decision                        |
| Static mock screens are not presented as working AI | Fixture mode is labelled as demo fixtures; live mode is labelled Live AI; provider failures do not fall back silently                                                             |
| Failure and recovery                                | Integration coverage includes provider failure with retained answers, retry, cancellation races, stale profiles, sharing denial, ownership checks and CSRF                        |
| Cross-platform test execution                       | `npm run verify` and `npm run test:e2e` pass locally against PostgreSQL 16.10; GitHub Actions runs the same checks                                                                |

## Current evidence

- PR: https://github.com/zche0316/CareerFlowAI/pull/2
- Full live journey screenshot: `docs/evidence/cfs-31-deepseek-live.png`
- Full and early-exit interview screenshots: `docs/evidence/cfs-32-interview-complete.png` and
  `docs/evidence/cfs-32-interview-early-exit.png`
- Selected-job handoff screenshots: `docs/evidence/cfs-21-ranked-jobs.png` and
  `docs/evidence/cfs-21-selected-job-handoff.png`
- Salary negotiation screenshots: `docs/evidence/cfs-33-salary-negotiation-live.png` and
  `docs/evidence/cfs-33-salary-negotiation-fixture.png`

## Explicit limitations

- Job advertisements and salary ranges are fictional fixtures.
- There is no live vacancy ingestion or automatic application submission.
- Deployment and independent review remain external acceptance gates.
