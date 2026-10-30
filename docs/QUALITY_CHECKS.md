> Historical verification record. Counts, capabilities and measurements below apply to their stated revision. For current capabilities and release checks, start with [CURRENT_DELIVERY.md](CURRENT_DELIVERY.md).

# Integration and quality checks

This document records the practical test contract for CFS-39.

## Agreed local environment

- Windows 11 workstation
- Node.js 24.19.0
- PostgreSQL 16.10 on `127.0.0.1:55432`
- Dedicated `careerflow_test` database
- Chromium 156 installed through Playwright
- Fixture mode for deterministic functional tests; DeepSeek `deepseek-flash` for live evidence

The integration test named `propagates request IDs and meets local load/save latency budgets` prints
the latest measurements. The 22 October 2026 run recorded:

- workspace load maximum: 25.9 ms
- draft save: 45.8 ms
- approved profile save: 19.7 ms

## Budgets

| Measurement                   | Budget        | Implementation                                                                 |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Workspace/profile load        | <= 2 seconds  | Five owner-scoped `/api/workspace` reads after approving a profile             |
| Draft save                    | <= 2 seconds  | Create a profile draft through the API                                         |
| Approved profile save         | <= 2 seconds  | Append the reviewed draft through the approval endpoint                        |
| Provider response or fallback | <= 30 seconds | `PROVIDER_TIMEOUT_MS` defaults to 25 seconds and is validated to 10–30 seconds |

Latency checks use `performance.now()` around real HTTP requests against the disposable local
PostgreSQL database. Provider timeout behavior is covered with a deliberately stalled local fetch
transport and a shortened configured deadline.

## Quality matrix

| Criterion              | Coverage                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Ownership isolation    | Cross-user profile, mission, answer, decision and negotiation tests                           |
| Permitted data         | Sharing switches reject incomplete downstream permission; pending drafts never reach missions |
| Evidence and rationale | Coach and resume schemas/tests validate approved evidence IDs and reasons                     |
| Approval               | Explicit profile and exact resume approval tests                                              |
| Failed writes          | Forced unique-profile conflict proves transaction rollback                                    |
| Cancellation           | Late worker writes fail after mission cancellation                                            |
| Staleness              | Profile replacement marks unfinished missions stale and blocks decisions                      |
| AI failure             | Missing credentials produce a recoverable failure while approved data remains                 |
| Fallback honesty       | Fixture mode is explicit; live mode does not silently fall back                               |
| Browser regression     | Five Playwright tests cover profile, matching, interview, negotiation and mobile layout       |

## Commands

```powershell
npm run verify
npm start
# In another terminal:
npm run test:e2e
```

The CI workflow executes the same verification and browser checks with a PostgreSQL service
container.

