# Conversational profiles, career memory and reviewed expression

This increment implements CFS-59–63 locally. It extends the existing approved-profile and resume workflow; a conversation, memory or wording proposal does not silently replace an approved profile.

## Use the interface

1. Open **My career profile → Profile conversation → Start profile conversation**. The assistant asks about missing goals, skills, education, experience, dates and contributions. Give factual answers, allow the configured model to process this turn, and send. Saved conversations can be reopened after a reload. The normal form remains editable during processing.
2. Review each suggested field and its source quote. **Apply … to form** changes only that field. Manual edits made after a request take precedence; stale suggestions fail explicitly. Structured records retain their saved conversation/message citations. Review and approve the full profile through the existing approval controls.
3. **Save message as draft memory**, or enter a note or the STAR details you know (the result may remain unknown) in **Career memory & STAR stories**. Link it to an approved project/work record and optionally an application/mission. Confirm it explicitly before retrieval. Editing creates a correction draft; confirming it supersedes the old record. Deleting removes its contents from future retrieval. Previously approved documents/profiles and original conversation messages remain separate historical records.
4. **Find confirmed evidence** uses owner filtering, record/application associations and Unicode keyword matching, including CJK bigrams. General searches exclude application-specific memories; choose the application to include its evidence. Draft, superseded, deleted and other-user memories are excluded. Empty results are disclosed. Chat receives a bounded set of retrieved excerpts, and proposals citing a subsequently deleted/corrected memory cannot be applied.
5. In **Document library → Review resume wording**, select an approved resume and claim, generate a suggestion, inspect/edit it and accept or reject it individually. The guard retains source content, numerical tokens and contribution qualifiers, allowing conservative reordering and removal of first-person filler. Unsupported rewrites are blocked; unchanged text is marked `NO_CHANGE`. This is not a semantic truth detector. A final explicit review creates a distinct approved edition containing original `factText`, reviewed `text`, source hash and wording IDs. Original documents remain immutable. Download the new edition for manual upload; existing mission application packages retain their originally approved document.
6. In a mission's application panel, **Check application fields** and save reviewed application-only answers. Greenhouse public questions are read from a constructed official endpoint. Other sources show a baseline preparation checklist with the full schema explicitly unknown. Suggested contact data needs review; work rights, sponsorship, demographic and salary answers are never inferred. No application is sent.

## Persistence and boundaries

- `ProfileThread`: owned messages, working-form snapshot, field proposals, approved-profile version, optimistic revision and a bounded processing lease. User messages are stored before model calls; provider failure preserves the message, form and previous approval. Saved working forms restore only through an explicit action.
- `CareerMemory`: source kind/ID/quote, note or STAR text, confirmation state, applicable record/mission, correction predecessor and revision. A confirmed memory is user-attested, not externally verified. Draft correction creation does not retire the currently confirmed source until confirmation succeeds.
- `ResumeWording`: owned approved-resume ID, original hash and text, proposed expression, decision, model and timestamps. Accepted wording creates a new immutable `ApprovedResume`; it does not update profile facts or overwrite the original resume.
- Application answers and schema hashes are stored in the owned mission under `applicationReadiness`. Answers are kept only against the matching question/profile/job context. Unsupported select answers remain gaps. Schema changes require fresh review.
- All endpoints are behind the existing account/CSRF boundary. Ownership is checked server-side. User-row locks and revision checks serialize memory confirmation/deletion and dependent proposal application.

The initial guard is deliberately conservative: it may reject a valid synonym rather than risk adding a claim. Make a factual profile correction for genuinely new information. Old approved documents are retained as historical evidence; deletion of a memory does not silently rewrite them.

## Models, retrieval and configuration

No new key, database service, vector database, Mem0 or Letta account is required. Use the existing PostgreSQL connection and server `.env`. `PROVIDER_MODE=openai`, compatible `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_MODEL` enable live calls. Conversations use the existing light/text router; wording uses the text route. `fixture` mode gives labelled deterministic interview/wording behavior without model charges. Vision imports remain separate and require their existing consent.

The retrieval implementation is lexical retrieval-augmented generation, **not semantic/vector search**. Add multilingual embeddings only after recording concrete missed relevant evidence and comparing retrieval on an evaluation set. Preserve the same owner/status/application filters and source IDs if an embedding index is added. Do not send unconfirmed memories to an external embedding service by default.

Current bounds: 30 conversations/workspace, 30 user turns/conversation, ten recent user messages used for extraction, at most eight search hits and four bounded retrieved excerpts per model turn, 500 memory versions and 20 wording requests/hour. Model retries are explicit; no model can invoke arbitrary tools or approve facts.

## Official source boundaries

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): public GET job questions via `?questions=true`; application submission is a separate authenticated operation and is not implemented here.
- [Lever public postings API](https://github.com/lever/postings-api) and [Ashby public posting API](https://developers.ashbyhq.com/docs/public-job-posting-api): supported job discovery does not imply complete application-form access. This increment does not scrape hidden forms or infer their questions.

## Verification

Stop the running portable app before `npm run verify:local`. Start `PROVIDER_MODE=fixture JOB_SOURCE=fixtures npm run start:local`, then run `npm run test:e2e` against that one application. Do not start another database-connected app or test process against the portable instance. Restore normal `npm run start:local` afterward to use the private `.env` configuration.

Tests cover persistence, failed model turns, concurrent turn exclusion, manual-edit precedence, conversation-record provenance, owner isolation, memory confirmation/correction/deletion, stale-memory proposal invalidation, constrained wording, immutable reviewed editions, schema-bound application answers and unsupported public schemas. Live-provider smoke results are recorded separately from fixture regression results. No CI, commit, PR or deployment is implied by a local pass.

## Execution evidence — 29 October 2026, Australia/Sydney

- Final `npm run verify:local`: 121 Vitest tests, 6 original matching tests, TypeScript and production build passed. `npm run test:e2e`: all 20 browser tests passed. Screenshots were visually checked; the conversational-profile test also checks the 390px layout.
- Real Groq `openai/gpt-oss-120b`: saved a fictional conversation, proposed Melbourne as a location, asked four relevant follow-up questions and applied the reviewed suggestion to the working form without changing the approved profile version. A confirmed source-linked memory was retrieved through the lexical service.
- Real model wording was individually accepted and saved as a separate approved edition, preserving original `factText`; its PDF returned HTTP 200, a valid PDF header and 23,294 bytes. This is one synthetic smoke test, not a general language-quality or performance benchmark.
- A real Greenhouse Spaceship posting (`8119027`) returned 14 public fields, 8 required. The complete schema remained marked unknown because public questions do not establish every consent/conditional requirement. No application was submitted.
- The first live attempt exposed the SDK strict formatter rejecting optional non-nullable draft fields. Interactive profile/wording requests now use one bounded JSON-mode call with server-side schema validation; the existing five-agent mission tool gate is unchanged. Two provider regression tests cover partial-field output and invalid output without hidden retry.
- Ignored local evidence: `output/conversational-profile-20261029/verification-final-all.log`, `browser-delivery.log`, `live-smoke-final.log`, `live-smoke.json`, `conversation-memory.png` and `wording-edition.png`. The normal server was restored to real-provider mode. Credentials and database backups are not source deliverables.

Implementation is local on top of `004ffc28088a03c56439d8706863bdd0a92980d3`; no new commit, PR, remote CI or deployment is claimed for this increment.

## Chat-first entry after owner testing

My career profile now opens one conversation with grouped draft cards. The old six-step wizard, quick-notes builder and Australian autofill/download actions have been removed from this screen. Start by answering the chat; review suggested details once per turn and choose **Use these details in my draft**. Manual edits/imports and the memory library are secondary expandable tools. Conversation history restores the same owned draft on reload only if no intervening edit/version change raced the load.

Follow-up answers about the same title/organisation update its stable record, retaining source statements and citations. A reviewed turn applies atomically; a conflicting manual field rejects the update. Final profile approval remains separate. Review cards group a record's header and statements. Canonical structured education/experience replaces parallel legacy summaries in new facts and matching; old approved snapshots remain immutable.

Source handling in the chat path: omitted optional model fields never clear the working form. Missing scalar citations can be recovered only as exact user-authored clauses; ordinary negation/qualification checks still apply. A paraphrased record citation is replaced only by an actual cited, title-anchored user message before field/date validation. Source statements are retained under the named/focused experience and exclude assistant questions, other record sections and profile-wide preferences. Unknown results are retained without invented metrics. Model replies cannot claim that their suggestions have already been applied or approved.

## Explicit interview controls

Interview progress is persisted as an auditable state snapshot on assistant messages in the existing owned ProfileThread, rather than inferred anew by the model each turn. It records collecting/inventory/review phase, current experience, finished experience scopes, addressed/skipped question slots and the current question. The model extracts evidence and prepares suggestions; the server selects the next unaddressed, applicable slot. Finished experiences are excluded until explicitly reopened. Legacy stop requests/date answers are recognised without rewriting historical messages.

- **Finish this experience** retains content and pending suggestions, closes its scope and moves on.
- **Add another experience** closes the current scope and invites a different experience.
- **Finish interview & review** stops questions and opens a review path. Pending suggestions must be used or declined; nothing is automatically approved.
- **Skip this question** records the slot as addressed without inventing a value. Unknown dates/outcomes stay unknown.
- **Resume / Reopen this experience** explicitly resumes collection. Existing finished experiences otherwise stay closed.
- Natural requests such as “I think the content is enough now for this project” use the same control path without a model call; controls are excluded from career source material.
- A failed model turn keeps the saved answer and earlier pending suggestions. **Retry saved answer** reprocesses the same message ID; it does not duplicate the answer or start an unrelated question. Stop/finish controls work without an API key or provider call.

Routes: `POST /api/profile-threads/:id/controls` with `{currentProfile,revision,action,recordKey?}`. Actions: finish_experience, next_experience, finish_interview, skip_question, resume, keep_current_draft. Ownership, revision and in-flight processing guards apply. `POST .../:id/messages` optionally accepts `retryMessageId` for only the latest failed saved answer. All controls affect the working interview only; profile approval is unchanged.

Legacy recovery: the review stage detects finished experiences that exist in saved chat but have not reached structured draft records. **Prepare missing experience from saved answers** is an explicit, consented model action; it reads up to 30 complete user answers within an 18,000-character context budget and creates pending suggestions without restarting questions or approving data. The ordinary stop/skip/review controls remain provider-independent. `recoverSavedAnswers:true` on the messages route is allowed only in review and does not append a duplicate answer. Career source pages in conversations support 30 message citations; resume imports keep their existing ten-page limit.

Actual stored-error inspection during this increment found `builder.draft.experienceYears: expected number, received null` and a top-level array returned for a skip request. Unknown optional non-nullable draft fields are now omitted rather than blocking an otherwise valid turn. Skip/finish intents no longer call the model at all. Other malformed outputs remain rejected with the saved answer available for retry.

## Labelled interview answers and organised memory drafts (29 October)

New user messages retain the current `answerTag` and `experienceKey` alongside their original text. The planner includes background, personal responsibility, actions, outcomes, tools and optional reflection; education remains qualification-only. Existing historical messages are not relabelled as if those tags had been captured at the time.

`POST /api/profile-threads/:id/organise` accepts the current profile, revision, recordSection (`workExperiences` or `projects`), recordId and explicit model consent. Section plus record ID avoids ambiguity in legacy data with reused IDs. The model selects zero-based source indices into the one record's original details and groups them into fixed categories. The server constructs the displayed text from the originals, removing field-label prefixes only. This is source-preserving organisation, not free-form summarisation or resume polishing. Original details remain canonical selectable facts and remain expandable. The grouping is hidden if source answers change.

A successful organisation atomically adds a pending profile suggestion and a NOTE memory in DRAFT status, with owned conversation references where available. Identical repeated organisation reuses the same draft memory. Finishing an active structured experience with consent triggers this preparation; an explicit per-record recovery button is also available. The profile suggestion must be reviewed and adopted; memory confirmation is separate. Draft memories are excluded from RAG. No final profile approval, memory confirmation or application submission occurs automatically.

Complete labelled chat answers (`Title`, `Type`, `Organisation`, `Dates`, `Background`, `Personal responsibility`, `Personal actions`, `Team outcomes`/`Outcomes`, `Tools`, `Reflection`) also have a deterministic extraction path. Explicit dates and values map directly to one source-grounded work/project record; no additional generative extraction is needed for that complete format. Ordinary partial conversational answers still use the interview model. New complete-answer messages retain `fieldTags` in addition to the single active question's `answerTag`. This prevents an LLM from attaching a complete new volunteering answer to an older work record.

The conversational model receives a compact profile index, bounded recent user source messages with their original message numbers, and a small assistant history. Nested evidence and organised story copies are excluded from the provider request. Complete original messages, approvals and evidence stay stored locally; this is request compaction, not deletion or summarisation of the source library.

## Mission payload policy — approved profile only

Downstream career missions now send approved profile fact IDs/text once, without attached conversation/import/memory quotations or separate retrieved memories. Source validation and audit history stay on the server. Coach receives only the mission goal, approved facts and explicit analysis-refinement feedback when supplied. Resume preparation adds the selected job and resume feedback; interview generation adds the selected job/prior interview feedback; interview evaluation adds its questions and answers. Those task inputs are not candidate qualifications. The independent memory library and explicit profile-building/retrieval tools remain available, but `useConfirmedMemories` does not expand mission context. The profile UI states this policy instead of offering the previous broad mission-memory checkbox.

Each specialist Responses request is bounded: 1,024 maximum output tokens for the required context-tool handshake; structured output/correction is capped at 3,000 for Coach, 2,500 for Resume Tailor and 2,000 for other mission specialists. Coach is never given the attached audit quotation bodies. Error presentation distinguishes AI rate/size limits from job-source rate limits.

Groq free-tier refinement: Coach omits repeated section/record association metadata and sends `id`, `kind`, `text` per approved fact, in the existing record order. Record links stay on the server; resume headers are restored from the selected approved IDs. Coach structured output/correction is capped at 3,000 tokens; other specialist output remains 4,000, tool handshake 1,024. Actual Profile v5 retained all 77 IDs/texts in 12,287 context characters (95.77% smaller than the old 290,459-character representation). A fresh real mission completed analysis and official-employer matching at 2/12 calls and 7,274 recorded total tokens; old failed missions keep their consumed budgets and history.


Resume-stage size correction: all model-facing fact entries now contain only `id`, `kind`, `text`; section/record/header links remain on the server. The resume JSON schema no longer repeats the full eligible-ID enum. Its equivalent server-side membership validation still rejects unapproved/ineligible IDs, and record headers are restored server-side. Resume selection requests up to eight strong facts with short reasons. Interview questions use the approved resume's selected fact subset, and interview evaluation receives the job, questions and answers without retransmitting unrelated profile facts. This is task-specific minimisation, not deletion or truncation of the source profile.

## Structured resume composition from the approved profile

Resume drafting uses approved record identities and eligible contribution IDs, not conversational extraction. The model sees a compact approved-record index once so it can choose relevant experiences before statements. Experience headers and administrative Tools/Type/Dates lines are not eligible contribution selections. Server composition restores structured role/company/date context, fills legacy header-only selections with supported contribution statements, and retains structured education as baseline context. All source facts remain in the profile library.

`packages/contracts/src/resume-layout.ts` provides the shared document model and section assembly used by browser, DOCX, PDF and text export. Records carry only approved identity/date fields; selected claims supply the bullets. A targeted objective is derived from the chosen role and selected skill facts. Source labels and leading first-person filler are removed for display only; raw claim text, source references and Profile stay unchanged. Evidence IDs and selection reasons are in a collapsed review panel, not the resume document.

Wording review remains the existing separate, versioned workflow: approve the factual selection, review expression suggestions, and explicitly approve a wording edition. Its modified claim text is rendered by the same structured layout; it does not overwrite Profile facts. The default extractive preview is not a claim of completed AI wording refinement.
