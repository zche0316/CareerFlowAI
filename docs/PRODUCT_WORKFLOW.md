# CareerFlow product contract — zero-resume journey

Decision date: 29 October 2026, Australia/Sydney. Source: the project owner's explicit written direction in this working conversation. This is a product decision and implementation contract, not a claim of a team planning meeting.

## User outcome

A person without an existing resume or formal employment can discover usable experience, build a confirmed digital career profile, choose a job and approve a tailored application document. Existing resumes are optional source material. No user must upload a file, invent employment, fabricate a number or know how to write a resume before starting.

## Six stages

1. **Direction:** target role/direction, career stage, location and working preferences. Unknown preferences remain optional. The user can refine direction in conversation.
2. **Inventory:** paid work/internships, course projects, personal projects, volunteering and clubs. Keep category and dates explicit. Non-employment activities must not be presented as paid employment.
3. **Explore:** choose one experience and retain the complete source story. Ask about situation, responsibility, personal action and result. Save incomplete drafts; an unknown outcome stays blank. Confirmation requires meaningful context and personal action, not an invented metric.
4. **Confirm:** editable structured fields and source-linked facts. Applying a suggestion changes only a working form. Only explicit review/approval creates the next immutable profile version. Sharing permissions remain explicit.
5. **Target:** career guidance, real/disclosed fixture jobs, evidence/requirement gaps and the user's target selection. Use deterministic structured fields and owned confirmed evidence; lexical retrieval precedes an embedding service.
6. **Application:** select and order supported content, review expression separately from facts, approve a version tied to the job/profile/evidence, then export DOCX/PDF. Interview feedback can propose a draft learning/story update; it cannot automatically become a qualification.

## Three information layers

- **Source material:** complete conversation statements, original import text and complete story drafts. Preserve wording and provenance; do not shorten this layer to fit a resume.
- **Confirmed career profile:** structured identity, education, experience and explicitly confirmed facts. References point back to sources. Corrections have explicit replacement/version relationships.
- **Application editions:** job-specific selection/order and reviewed wording, template identity, approval and exports. Editing an edition never silently changes source facts or earlier approved editions.

## Definition of Ready

Before committing a feature, name the primary user, the user outcome and where it sits in the six stages. Specify observable acceptance and one negative case, source/approval boundaries, privacy scope and the evidence needed for verification. Identify optional dependencies. Confirm whether the story advances the no-resume path or only improves an alternative input route.

## Definition of Done

Evidence must cover the stated user outcome, persistence/ownership, explicit approval, preservation of previously approved data and relevant failure/manual paths. Link checks actually run and their fixture/live boundary. A local pass is not a merge, independent review, deployment or user acceptance. Code delivery does not establish that a review or retrospective meeting occurred.

## Scope control

Primary: one sustained conversation with grouped draft cards, complete evidence retention, reviewed facts, target-specific documents and feedback-driven learning. Secondary: import existing career material. Defer additional OCR providers, broad template marketplaces, auto-submission, embedding infrastructure and external memory platforms until a demonstrated user need and capacity decision exist.

Jira: CFS-59–63 implementation areas; CFS-64 product-contract/Definition-of-Ready action; CFS-65 end-to-end verification and retrospective follow-up. These newly recorded actions are uncommitted backlog, with provisional remaining-work estimates, not retrospective estimates of engineering effort.

## Chat-first interface consolidation (owner feedback, 29 October)

The six stages above describe the interview logic, not six competing form pages. The wizard and quick-notes UI have been retired. My career profile now has one conversation and grouped draft cards. Manual editing/import and memory tools are secondary. A reviewed conversation turn updates only the working draft; final approval is still explicit.

Structured education and experience are canonical when present. Legacy free-text summaries remain stored for compatibility/history but are not duplicated in new facts or matching. Absence markers such as none yet are intake answers, not qualifications. A record header and its source statements remain separately selectable internal evidence, while the interface groups them as one experience.

## Manual walkthrough (fictional data)

1. Create a disposable account and open My career profile. Answer the chat's direction question; consent to the configured model processing the supplied information.
2. Describe education and one course/personal/volunteer/club experience. Answer one follow-up at a time about context, responsibility, personal action and outcome. Unknown outcomes stay unknown.
3. Review Suggested profile update and choose Use these details in my draft. Later answers update the same experience. Grouped cards show the working draft. Edit profile details manually is an optional correction/failure path.
4. Choose sharing permissions, then Review profile draft. Review the grouped snapshot and explicitly approve. Refresh and confirm the version persists.
5. Find jobs using this approved profile. Choose a disclosed fixture source for repeatable tests or a configured live source for live discovery. Inspect requirements, evidence and gaps before selecting a job.
6. Select/order source statements, save, review and approve the resume. In Document library, review wording and save a separate edition; download DOCX/PDF.
7. Save actual interview feedback as a draft learning memory. It does not establish new employment, skills or results.

Reproducible checks: stop the local app before npm run verify:local. Then start with PROVIDER_MODE=fixture JOB_SOURCE=fixtures npm run start:local and run npm run test:e2e. Restore normal npm run start:local afterwards. Browser chat transport is scripted where labelled; API tests separately exercise model-mocked persisted proposals, grounding, atomic review and ownership. Fixture results are not live-provider availability evidence.

Resume approval now hands off directly to phase 05 Interview practice. While question generation runs, the user sees preparation status; ready questions receive focus. Already-approved missions expose Continue to interview practice. Practice responses stay separate from approved qualifications. Completion shows feedback and a return to full mission/optional practice; saving a feedback memory remains an explicit draft-only action.
