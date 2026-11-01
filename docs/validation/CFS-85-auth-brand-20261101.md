# CFS-85 — Authentication brand and demo removal

Validated locally on 1 November 2026.

The sign-in and registration screens share the CareerFlow wordmark, sans-serif typography, warm neutral surfaces and orange pill action. The promotional composition references BudgetMate AuthFrame with two career-stage illustrations, not selectable accounts. Mobile keeps the form accessible without horizontal scrolling.

Removed public demo sign-in, session demo flag, shared demo seed script/command, one-click fictional profile fill, workspace sample payload and obsolete deployment configuration. Fixture providers remain internal verification infrastructure. Existing user records and live AI behavior are preserved.

## Verification

- `npm run verify:local`: typecheck, six matching checks, 233 tests across 37 files and production build passed.
- `npm run test:e2e`: 45/45 browser tests passed, including the connected five-step journey, approval persistence, resume editing and mobile.
- Final focused authentication test passed after styling cleanup: registration, sign-out and sign-in using a disposable account; demo/sample controls absent; workspace omits sample data; retired endpoint cannot create a demo session.
- Final typecheck, production build and `git diff --check` passed.
- Desktop sign-in and 390px registration screenshots inspected: `output/auth-brand/sign-in-desktop.png` and `output/auth-brand/register-mobile.png`.

Browser checks used fixture AI/jobs and disposable test accounts. They do not assert a new live-provider evaluation. Normal local provider configuration is restored after verification. PR #19 remains a reviewable change, not a claim of merge or remote deployment.
