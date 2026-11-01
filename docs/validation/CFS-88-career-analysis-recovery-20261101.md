# CFS-88 — Career analysis recovery

## Observed failure

Mission `3359857e-ae37-4de0-a9f3-73cbd9eab359` failed three times after 25.031, 25.025 and 25.029 seconds. An instrumented fourth attempt returned a Zod validation error at 24.097 seconds and started correction at 24.098 seconds, leaving 902 ms before the shared 25-second deadline. The worker cancellation signal was false. Actual model route: native OpenAI `gpt-6-luna`. Original logs did not preserve invalid field paths.

## Repair

- Raise the mission model-call budget from 12 to 60 using one shared constant across mission reservation, job-link import, salary practice and workspace controls. Existing counts remain intact.
- Raise the specialist deadline default to 90 seconds, configurable up to 120 seconds. Interactive profile deadlines remain unchanged. Keep one bounded shared deadline and one correction attempt.
- Request concise Career Coach output with explicit required fields and exact evidence IDs. Keep schema and evidence validation intact.
- Log safe stage, model, elapsed time, validation paths/codes and cancellation metadata; do not log candidate content or credentials. Provide actionable timeout feedback.

## Validation

- `npm run verify:local`: 37 test files, 234 tests; six matching checks; typecheck and production build passed with the app stopped.
- Three intercepted browser regressions passed: 12 and 59 calls permit retry, 60 calls blocks retry.
- Real authenticated UI retry of the same failed mission succeeded, saved the career analysis and progressed through live job matching to `AWAITING_JOB`. Analysis displays all four sections; an expanded evidence explanation references approved work-experience fact IDs.
- Local service restored on port 8787. No commit, PR, merge or remote deployment claimed.
