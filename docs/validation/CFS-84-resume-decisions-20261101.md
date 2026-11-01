# Resume handoff and editing — 1 November 2026

- Matching with a selected target now presents Review your resume (including a preparation message while the draft is pending). The unrelated primary new-search action is hidden after selection. Queued decisions retain their preparation stage; earlier deliberate review still does not force navigation.
- Final approval is a sticky bar above the resume preview and agent layout, rather than the bottom of the long sidebar. It keeps the explicit review checkbox and exact draft hash. No approvals were performed on the user's existing mission.
- Edit wording yourself supports direct statement editing without a model call. Applying edits updates the same reviewable draft with highlighted Before/After and Keep original. Unsaved manual text blocks agent rewrites, restore and approval; applying/discarding requires fresh review. New facts must first be added to the main profile.
- Manual endpoint enforces ownership, current approved profile, AWAITING_APPROVAL state, current draft hash and existing fact identity in a database transaction. Conservative wording guardrails reject unsupported claims. Profile facts remain unchanged. UI input has explicit accessible names.

Validation: full exclusive local check passed 233 tests across 37 files, six matching checks, typecheck and production build. Extended resume-agent integration covers grounded manual wording, stale hash rejection, unsupported claims and no extra model calls. Focused browser case passed (1.2 seconds): matching continuation, visible approval, manual change, preview update, renewed confirmation and mobile approval visibility. Full browser regression result is recorded in Jira after completion.

Screenshot: output/agent-native/resume-visible-approval.png (local ignored artifact). Browser transport is mocked in the focused editing case; factual/state safeguards are separately exercised by database integration tests. No merge/deployment claim is implied by local checks.
