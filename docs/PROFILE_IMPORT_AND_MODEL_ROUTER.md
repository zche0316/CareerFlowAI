# Structured profiles, resume import and model routing

Implemented 29 October 2026 in the group checkout. UI remains English and retains the navy numbered 01–08 workflow. Existing accounts, historical profile versions and approved resumes remain valid.

## User workflow

1. Open **My career profile**. Add separate Work experience, Projects and Education records. Each record has a stable ID, title, organisation, location, start/end month, Current/Present, contribution lines, technologies and optional public link. Current education can also state an expected completion month. Legacy free-text fields are retained for old profiles and additional context. Dates do not automatically become professional experience years; overlapping jobs and projects must not be added together.
2. Optionally choose a PDF, UTF-8 TXT, PNG or JPEG under **Import an existing resume**. The file limit is 4 MB; PDFs may have at most ten pages. Text extraction runs on the backend without an external model call. Saved imports can be reopened after navigation/restart.
3. Inspect the page text and its reading order. A deterministic Router suggests vision for short or corrupted extraction. Select up to three pages and explicitly permit external processing before **Recognize selected pages with Qwen**. You may also select a page with incorrect column ordering. Images are bounded to 16 megapixels; page rasterization is bounded to 1800 pixels along the longest side.
4. **Organize extracted text into records** sends only this import's extracted text to the configured text model. It does not send other profiles or the account password. There is a 16,000-character organization limit. Records must cite real page quotes, copy their factual fields from those quotes and normalize only explicit month/year dates. Unsupported proposals are omitted and reported. AI does not certify that the source document is true.
5. Compare proposed records with source excerpts and add them to the editable form. Correct details, fill missing fields and review the complete profile draft. Only explicit profile approval creates a new version. Import operations cannot approve profiles, submit applications or update existing mission decisions.
6. Start a mission against the approved profile. Structured records become separately identified evidence; work, project and education section metadata survive resume claim selection. Review and approve the exact resume. **Document library** and resume screens provide TXT, editable DOCX and searchable PDF exports of the persisted approved snapshot. Exporting an older resume never uses new, unapproved profile edits.

## Router and models

The Orchestrator, file routing, ownership, budget and approval gates run in code. A model never chooses arbitrary tools or bypasses a review.

```dotenv
PROVIDER_MODE=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your_private_groq_key
OPENAI_MODEL=openai/gpt-oss-120b
TEXT_MODEL=
LIGHT_TEXT_MODEL=
VISION_MODEL=qwen/qwen3.8-27b
VISION_BASE_URL=https://api.groq.com/openai/v1
VISION_API_KEY=
```

Blank `TEXT_MODEL` uses `OPENAI_MODEL`; blank `LIGHT_TEXT_MODEL` uses the same primary text model. Set `LIGHT_TEXT_MODEL=openai/gpt-oss-20b` to evaluate economical profile organization. Other career specialists continue to use the primary text model. Blank `VISION_API_KEY` reuses the main key only when text and vision endpoints have the same origin, such as two Groq endpoints. Keys are not silently forwarded between providers. Supply a separate vision key when the primary endpoint belongs to another provider. Existing deployments need no model renaming.

`PROVIDER_MODE=fixture` retains offline career workflows and real local extraction, but explicitly refuses external import organization/vision. It never inserts fictional parsed records. Restart the app and any separate worker after changing configuration. Docker Compose forwards these variables.

Every import reserves its call budget before external work, supports at most eight model requests, has no hidden SDK retries, and records successful model/token usage. Failed calls still consume reserved attempts. A failed or timed-out operation keeps the source text and any successfully completed pages, reports failure, and requires an explicit retry. A processing record older than two minutes can be retried after a server interruption. Failed responses whose output cannot be parsed may lack token details. Imports are scoped to the signed-in user; page evidence from another user's import cannot be attached to a profile draft. Uploads and mutations retain existing authentication/CSRF gates. Ten new files per user per hour are permitted.

Original files, extracted page text, proposals and activity are stored in PostgreSQL `ProfileImport`. They contain private resume data; keep database backups private. Raw file bytes and credentials are not returned by import/session APIs. Source quotes are retained with approved evidence. Model failures do not silently choose another provider, credential or fixture mode.

## Verification

- Real Groq GPT-OSS 120B organization of the fictional test resume retained all three expected records (work, project, education), with zero grounding rejections.
- Real Qwen3.8-27B transcription recovered the fictional candidate name, record headings, responsibility lines and dates from a generated scan. A missing optional uncertainties array was normalized to empty; the transcription remains unverified until human review. Early requests hit rate limits; explicit later requests succeeded.
- The same text evaluated with GPT-OSS 20B also retained three records without grounding rejections. This is a narrow fixture comparison, not a general quality benchmark. The default remains 120B.
- Searchable PDF generation and extraction, real DOCX generation, page rasterization, independent record dates, stable evidence identities, grounding, ownership, consent, draft approval and snapshot exports are covered by tests. Both PDF and DOCX were rendered and visually inspected using synthetic content.
- Final local checks passed: 105 Vitest tests, six original matching tests, type checking and production build. All 17 Playwright browser tests passed, including structured records, local import, approval and persistence after reload.
- Local evidence is under ignored `output/profile-workflow-20261029/`, including verification logs, browser logs, model results and rendered exports. Run the explicitly live synthetic probe with `npx tsx scripts/verify-resume-models.ts`; this sends only its built-in fictional resume to configured providers and consumes API quota. It does not approve a profile or modify credentials.

The export template is a single-column English business resume. It does not promise ATS acceptance, OCR accuracy, automatic professional translation, signature verification or suitability for every occupation. Textual claims remain verbatim from approved facts; free-form AI rewriting is deliberately not introduced here. Heavy decorative templates and automatic applications are outside this change.

## Portable database recovery performed locally

After dependency installation, the installed PGlite engine expected PostgreSQL 18 while this local database used PostgreSQL 17. Before recovery, the entire old directory was copied to `.runtime/backups/pre-profile-20261029`. A separate older engine exported all schemas to `.runtime/backups/pre-profile-20261029.sql`; the new engine restored to a separate directory. All 24 table counts and content hashes matched (632 rows) before switching directories. The original directory remains `.runtime/pglite17-preserved`; no account/profile/mission data was discarded. Evidence: `database-migration.json`. This was a local recovery, not a production database deployment.

The local private configuration now enables `PROVIDER_MODE=openai` for new requests. Text remains GPT-OSS 120B; Qwen is a separate vision route, and the optional 20B override remains blank. Existing fixture missions retain their captured mode. The real browser acceptance uploaded the synthetic scan, called Qwen and then 120B (two requests total), reviewed the three proposed records, explicitly approved QA Profile v2, and reopened the same saved import and structured records after refresh. No real applicant credentials or employment claims were used. An additional integration journey checks those structured record IDs, dates, original quotes and section metadata through job selection, resume approval and interview handoff.

After the final credential-origin guard and corrupted-text router fix, ten targeted router/profile/provider tests and type checking passed. The browser suite also checked comma-separated technology entry and the structured profile at a 390px mobile viewport.
