# CFS-86 — Approval inbox journey identity

## Diagnosis

Read-only inspection of the local account confirmed the latest Business Intelligence Analyst journey (6234659d) is COMPLETE. The sole pending inbox item is a separate, earlier technology search (1cc063b9) in AWAITING_JOB. The overview and inbox did not disagree on one persisted journey; the inbox failed to explain that it aggregates decisions across journeys.

## Change

Inbox rows identify latest/earlier journey, start date, goal or job and required decision. When the latest journey is complete, an explanation and direct results action distinguish it from older pending work. Opening a decision refreshes persisted state and routes a now-complete journey to read-only results. Users may cancel an unwanted pending journey without deleting its history. No existing account or mission records were changed during diagnosis.

## Verification

- Typecheck, production build and diff whitespace check passed.
- All 10 agent-native browser regressions passed, including two new cases: completed latest plus earlier pending identity/routing, state advancing before open, cancellation clearing pending state while retaining history.
- UI regressions use intercepted API fixtures; account diagnosis used a read-only database query while the local app was stopped.
- Normal OpenAI local service restored on port 8787 and API health checked.

PR #19 contains the change; merge and remote deployment are not asserted.
