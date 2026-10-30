# Sprint 2 product-direction learning record and retrospective input

Recorded: 29 October 2026, Australia/Sydney. Related retrospective: [CFS-49](https://careerflow-elec5620-group2.atlassian.net/browse/CFS-49).

**Record type:** evidence-based preparation for the Sprint 2 retrospective, plus an actual written owner-feedback event. It is not a completed team retrospective. Sprint 2 is active with a planned end of 30 October 2026 at 12:00 Sydney. Actual team attendees, discussion time, consensus and action acceptance remain unrecorded. No Sprint 1 ceremony is reconstructed.

## Observations and impact

- The owner clarified that the intended user starts without a resume. The existing profile interface placed import above conversation, so the visible product entry did not communicate that outcome.
- Recent feedback centred on PDF page counts, source/date exclusions and compressed details. Import extraction explicitly requested at most three concise detail lines; all-or-nothing grounding excluded whole records for optional-value mismatches. These are observable implementation decisions, not evidence of a user's lack of experience.
- The STAR contract required all four sections before saving even a draft. This prevented incremental capture and risked pressuring users to supply a result before they knew it.
- Sources, confirmed profile facts and job-specific expression had separate storage, but the user-facing workflow did not explain when to retain a long account and when to produce concise application wording.
- Fixture regression checks passed while a later live run exposed an optional-field SDK formatter incompatibility. The failure was preserved, diagnosed and fixed with bounded JSON requests and server validation; it illustrates why fixture evidence and live-provider evidence need separate labels.

The practical impact was rework and unclear next steps. No time-loss total, team contribution percentage or measured conversion improvement is asserted because those measurements were not collected.

## What helped

Specific owner questions and screenshots exposed workflow mismatches. Versioned approvals, owner checks and retained source material protected approved data while fixes were made. Regression tests and a real-provider smoke provided different, complementary evidence. Existing DOCX/PDF export infrastructure can support the desired outcome without another service.

## Contributing factors — hypotheses to discuss

The Definition of Ready did not make the first-user/no-resume scenario explicit. Technical acceptance focused on parsing and source safety before a shared product outcome and source-versus-document distinction were written down. Safeguards were initially expressed as blanket rejection rather than recoverable field-level review. These are process hypotheses supported by the observations; they are not attributed to a particular teammate or claimed as team consensus.

## Decision and experiments

The owner has authorised the six-stage journey in PRODUCT_WORKFLOW.md. Make native guided building the primary entry, keep imports secondary, retain complete source stories and permit unknown results. Job-specific selection and expression occur after profile confirmation and target selection.

- **CFS-64 — Define the zero-resume product contract and Definition of Ready.** Coordination owner: Zun Chen. Proposed team-review checkpoint: 30 October 2026. Evidence: PRODUCT_WORKFLOW.md and explicit confirmation or requested revisions. Success means new stories identify a user outcome, stage, approval/source boundary, negative case and verification method before commitment. Team adoption is still to be confirmed.
- **CFS-65 — Verify the zero-resume journey and evaluate retrospective actions.** Coordination owner: Zun Chen. Proposed checkpoint: the next Sprint 2 review/retrospective on 30 October. Evidence must demonstrate no-upload onboarding, a non-employment experience, an unknown-outcome story, explicit profile approval, selected-job evidence/gaps and an approved downloadable edition. Measure the actual run and record failures/rework. Do not infer success from an issue's status.

These tasks were created after sprint activation and remain uncommitted backlog. Their 1- and 2-point estimates are provisional remaining review/verification work; they are not team planning poker, completed effort or a velocity claim. No sprint scope, assignee of an existing task or historical burndown was rewritten.

## Feedback loop and next retrospective

Actual owner feedback → documented product decision → linked implementation/verification actions → run the no-resume scenario → capture observations and rework → evaluate CFS-64/65 at the next retrospective. For each action record adopted/rejected/partly effective, why, evidence and the next owned step.

Earlier Sprint 1 retrospective actions have no verified completed record in this audit. Their effectiveness is **unknown**, not automatically successful or failed. CFS-47 remains a separate historical evidence gap. The team must add actual participants, discussion and action agreement before CFS-49 can represent a completed ceremony.

## Executed verification and learning — 29 October

- Final local verification: 127 Vitest tests across 18 files, 6 original matching tests, TypeScript checks and production build passed. Evidence: `output/zero-resume-20261029/verify-complete.log`.
- Full browser suite: 22 passed, including the no-upload course-project journey, unknown result, story correction, profile approval, target/content selection, reviewed wording/PDF export and feedback draft. Evidence: `output/zero-resume-20261029/browser-final.log`; rendered edition: `native-edition.png` in the same folder. API coverage additionally checks DOCX/PDF downloads, ownership and stale approval hashes.
- Actual rework: the first full browser run passed 21/22. Editing a story before its confirmation response returned could let the response restore stale saved state. Story input is now locked during its own save/confirm operation; the corrected full suite passed. Earlier checks also exposed JSONB story ordering, now explicitly situation/task/action/result.
- Test boundary: fictional data and deterministic fixture providers. These results establish local workflow behavior, not a fresh live-provider availability check, independent review, release or team acceptance.
- CFS-65 now has executable evidence for its technical scenario. CFS-64 team adoption and CFS-65 effectiveness at the next real retrospective remain pending discussion. No ceremony is marked completed, and no historical sprint chart is rewritten.

## Follow-up owner feedback — chat-first consolidation

The owner tested the delivered main flow and reported that the layered forms were confusing. The review presented a record header and each statement as separate EXPERIENCE rows, retained `none yet` as an experience claim, and showed both legacy education text and structured education. Adding a six-step wizard above the older builders had increased competing entry points. The previous automated pass demonstrated executability, not usability or product coherence.

Action: replace the wizard and quick-notes entry with one persistent interview conversation and grouped draft cards; keep manual edits/imports and memory management secondary. Ask one question per reply. Apply a reviewed turn to the working draft together, then retain final version-specific profile approval. Canonical records take precedence over legacy summaries for new facts and matching; absence markers are not qualifications. Preserve existing approved snapshots and user data.

Effectiveness criteria: a new user can answer the conversation without touching the manual editor; subsequent answers update the same experience; a project is one card with its statements; education appears once; no `none yet` claim is exported; manual edits and stale-version protections survive. Technical checks and the owner's subsequent usability feedback must remain separate evidence. A real team retrospective and agreement are still pending.

### Implementation learning during chat-first verification

Live fictional-data testing exposed a difference from scripted browser transport: the model sometimes returned empty optional legacy fields, omitted scalar citations, paraphrased evidence quotes or condensed/omitted source details. Initial live runs failed rather than establishing acceptance. Repairs now treat empty optional identity/goal/stage entries as omitted updates, locate citations only in actual user clauses, validate title-anchored source messages and preserve complete user-authored story statements within the correct experience. Assistant questions and other experiences are excluded. Unanchored or unsupported values remain rejected. Unknown outcomes remain explicitly unknown.

One real first-answer test confirmed a direction-only answer can produce a follow-up without inventing a name. A separate successful real two-turn run retained exactly one education and one project, added a presentation detail to the same project, retained original SQL statements and left the profile unapproved. Evidence: output/chat-first-20261029/live-first-answer.json and live-result.json. Earlier failure logs remain in that folder. These are fictional QA records, not personal resume data or a team usability study.

### Chat-first technical evidence

- Final local verification: 134 Vitest tests across 19 files, 6 original matching tests, TypeScript checks and production build passed (verify-complete.log in output/chat-first-20261029).
- Full updated browser suite: 17 passed (browser-delivery.log). Seven tests specific to the removed quick-notes interface were retired; replacement chat conflict/failure checks cover the new entry, while approval/save/discard protections remain tested. This is not a claimed increase in UI coverage from counting old and new scenarios together.
- Source-capture tests cover named/focused experience association, complete original statements, exclusion of assistant/user questions, different records and global profile preferences. A regression caught a location preference incorrectly entering a focused experience; that was corrected and the final suite passed.
- Real-provider evidence uses fictional data: direction-only first answer and two conversational turns updating a single project, one education, zero parallel legacy claims, and profile still awaiting explicit approval. Earlier failures are retained. A final browser regression separately verifies a paraphrased question in model prose is not displayed as a second competing prompt.
- Existing Jira states and assignees stay unchanged. This is local implementation/verification and owner feedback, not an independent review, deployment, team ceremony or usability acceptance.
