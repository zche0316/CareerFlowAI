# Yuting Yang: R1 / UC1 acceptance - 27 October 2026

This record covers CFS-12, CFS-13, CFS-14 and CFS-56. It builds on group main commit `acbfa49` and the existing implementation; it does not reattribute earlier teammates' commits. Implementation, test execution and documentation in this increment were AI-assisted for Yuting's assigned scope.

## Requirement and task mapping

| Task | Stage 1 behavior | Implemented and verified in this increment |
| --- | --- | --- |
| CFS-12 | Enter/edit the career profile, correct field errors, retain manual completion | Real profiles start blank with sharing disabled; corrections invalidate old review; accessible field names remain stable after errors; failed discard retains the exact draft; manual editing survives late AI responses. |
| CFS-13 | Review, explicitly approve, validate and persist versions without damaging previous approved data | Approval atomically claims the owned DRAFT before version changes; approval and discard cannot both win; save errors retain the review copy; persistence locks the form; existing rollback/reload/ownership/version checks remain covered. |
| CFS-14 | Test success, missing data, failed saves, cancellation and permitted approved-only handoff | Added notes-only API, owner-isolated preparation, provider failure followed by manual completion, and approval/discard contention cases; existing approved-only handoff, permission, stale-version and transaction rollback cases pass. |
| CFS-56 | Organise supplied facts, ask follow-up questions, show supported changes, reject unsupported output, never auto-approve | Removed fictional defaults; bound evidence to actual source values and fields; reject token fragments, irrelevant citations and common negative/future claims; hide rejected changes from review metadata; guard stale responses; retain editable manual fallback. |

The core path remains input -> AI assistance or manual completion -> user review -> explicit approval -> validation/persistence -> confirmed saved version. AI preparation does not approve or persist a profile.

## Actual execution results

Executed locally on 27 October 2026, Node.js `v24.19.0`, using the repository's locked dependencies and a new, project-owned PGlite `0.5.10` development database. This is the project's portable PostgreSQL-protocol mode, not a claim of a native PostgreSQL 16 run. No existing personal/team database was overwritten.

| Check | Result |
| --- | --- |
| `npm run verify:local` | Passed migrations, TypeScript, 6 original matching tests, all 79 Vitest tests, and the production build. |
| Final UI `npm run typecheck` and `npm run build` | Passed after the accessible-label correction. |
| `npm run test:e2e` against the running built app | All 16 passed: 5 existing real API/database fixture journeys and 11 controlled-transport Profile UI cases. |
| Independent review | Separate AI-assisted static review, findings and readbacks in [UC1_REVIEW_20261027.md](UC1_REVIEW_20261027.md). This is not a human teammate or GitHub approval. |

The 18 new focused unit checks are included in the 79 Vitest total, not additional to it. Four added API cases are also included in that total. The new API cases use isolated authentication limiters without changing production rate limits.

Raw successful command output is retained in [verification.txt](evidence/uc1-20261027/verification.txt) and [browser-tests.txt](evidence/uc1-20261027/browser-tests.txt). Initial failed runs were investigated before the final successful runs: the added API accounts exhausted the shared test limiter, and two browser locators exposed field labels changing after errors. Test isolation and stable accessible labels were corrected; production authentication limits remain enabled.

## Demonstration evidence

All screenshots contain fictional QA data. Captions distinguish the test layers; a browser-injected response is not represented as a real model response.

| Evidence | What it establishes |
| --- | --- |
| [Profile requires review](evidence/uc1-20261027/cfs-13-profile-review.png) | Real local API/database journey: approval remains disabled until exact-draft review. |
| [Approved v1 after reload](evidence/uc1-20261027/cfs-13-approved-v1.png) | Real local API/database journey: the approved profile persists after browser reload. |
| [Correction and fresh review](evidence/uc1-20261027/cfs-12-correction-review-gate.png) | Controlled API browser case: an edited draft needs a fresh review; date errors can be corrected. |
| [Failed discard retains draft](evidence/uc1-20261027/cfs-12-failed-discard-retains-draft.png) | Controlled failure browser case: cancellation failure preserves the reviewed draft and permits retry. |
| [Failed save retains review](evidence/uc1-20261027/cfs-13-failed-save-retains-review.png) | Controlled failure browser case: saving locks the form; failure leaves the draft and review available. |
| [Supported builder response](evidence/uc1-20261027/cfs-56-builder-supported-draft.png) | Controlled API browser case: returned fields, follow-up questions and cited changes are shown without automatic persistence. |
| [Late response preserves edits](evidence/uc1-20261027/cfs-56-late-ai-edit-preserved.png) | Controlled timing browser case: newer manual input survives an old AI response. |
| [Manual fallback](evidence/uc1-20261027/cfs-56-manual-fallback.png) | Controlled provider-failure browser case: the form remains editable and can enter manual review. |

Backend grounding, isolation, contention and rollback are established by the unit/API tests, not by screenshots alone. The real API fallback test deliberately fails missing model configuration and then completes a manually approved v2.

## Limits and Jira closure

- No live paid/model provider call was made in this increment. Fixture and controlled transport cases are labelled as such. A configured live-provider rehearsal remains a separate environment-dependent check.
- Evidence filtering is conservative lexical/common-negation checking, not proof of real-world truth or complete language understanding. Human review, validation and explicit approval remain necessary.
- At the 27 October Jira readback, all four tasks were Review & Test. CFS-12 and CFS-56 had no visible upstream blocker. CFS-13 was blocked by CFS-35, which was blocked by CFS-34; CFS-14 was blocked by CFS-13. CFS-34/35 remained with Ziqing Xu. This increment does not close or reassign those teammates' tasks.
- A source ZIP attached for review is a candidate snapshot. It is not a claim of the final Canvas upload/download or final on-site deployment rehearsal.

## Short manual walkthrough for the module owner

1. Open My career profile: a new account has empty career facts and disabled sharing.
2. Enter real information or deliberately select the labelled fictional example.
3. In configured AI mode, prepare suggestions and inspect their evidence; use manual completion if the provider is unavailable.
4. Correct invalid dates/required fields, then prepare the review draft.
5. Confirm review of the exact draft and approve; reload to verify the saved version.
6. Change a field: a new review is required. Discarding an unsaved update preserves the previous approved version.
7. Start a mission only with the required authorised sharing; downstream tasks use the pinned approved profile, never a pending draft.
