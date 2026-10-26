# UC4 interface review — 26 October 2026

Prepared for Raphael Wang's R4 / UC4 work. This is an AI-assisted design review,
not an implemented redesign or a claim of independent team acceptance.

## Review scope

Reviewed the current local application at `http://localhost:8787`, the dedicated
04 Resume tailoring page with a fictional approved profile and fixture job,
the expanded review/revision controls, and the corresponding UI/workflow/export code.
The in-app browser viewport was 413 by 746 pixels. Existing desktop browser evidence
was also available. No live model or recruitment calls were needed.

## Observed issues

- Skills appear as repeated full-height claim blocks. Evidence labels interrupt
  reading the document; the output feels like a record list rather than a resume.
- The job title appears in the preview, but its company and relevant requirements
  are not kept alongside the review decision.
- The proposed-changes section repeats included claims. It is not a comparison
  against a previous draft and does not clearly communicate the effect of tailoring.
- Review confirmation, approval and revision feedback are below the long preview,
  particularly costly in a narrow viewport.
- Evidence labels use 10px text, some supporting copy is 11px, and much of it is pale.
- The global mission status is less specific than the resume's current state.
  Immediately after selecting a job, the queued screen can briefly ask the user
  to select a target again while the worker has not yet applied that decision.
- Current resume download is plain text. A printable preview or PDF/DOCX export
  would require additional implementation and verification.

## Recommended first increment

1. **Review workspace.** Keep the current navy navigation and numbered workflow.
   Use a two-column desktop layout: a grouped resume preview and a review inspector.
   On narrow screens, use Preview, Evidence and Review tabs with a compact action area.
2. **Document hierarchy.** Group existing facts into Skills, Experience and Education.
   Render skills compactly and keep factual wording unchanged. Do not invent contact
   details, dates, achievements, employers or a professional summary to fill the page.
3. **Target context.** Show the selected role, company, source label and profile version.
   Use existing job requirements and supported evidence for a concise relevance summary.
   Label unevidenced requirements honestly; do not introduce an invented ATS score.
4. **Evidence inspector.** Let a claim's source badge open its original approved fact,
   source/version and selection reason. Keep IDs and detailed activity available in
   the inspector rather than repeating them throughout the resume body.
5. **Review actions.** Make revision feedback easy to find. Offer relevant emphasis
   suggestions that still require user submission. Keep explicit approval, the
   two-revision limit and fresh confirmation after every changed draft.
6. **Resume-specific states.** Clearly distinguish preparing, ready for review, saving,
   saved, save failed and cancelled. A completed resume must remain visibly saved
   while the broader mission continues to interview preparation. Do not show a
   missing-target warning while a submitted job-selection decision is pending.
7. **Readable sizing.** Aim for 14–16px body text and 12–13px supporting text, stronger
   contrast, predictable wrapping and touch-friendly controls. Keep mobile content
   accessible above any persistent action area and on-screen keyboard.

## Follow-up work that needs additional behavior

- **Actual version comparison:** retain the previous draft's claims and ordering before
  offering a before/after view. Do not present the existing included/omitted list as a diff.
- **Printable/exported resume:** render only the exact approved version for final export.
  Clearly watermark any downloadable draft; test pagination, wrapping and evidence
  consistency before adding PDF or DOCX output.
- **More flexible wording:** any supported paraphrasing needs separate grounding checks
  and approval semantics. A visual refresh alone must not enable unrestricted factual edits.

## Acceptance criteria for implementation

- Selected-job and approved-profile context remain correct throughout the review.
- Grouping does not change claim text or break evidence-to-claim links.
- New draft hashes clear prior approval confirmation.
- Two revisions remain the limit, with explicit next steps at exhaustion.
- Save failures retain the exact draft and previous approved document; retry is idempotent.
- Cancellation cannot save an unapproved draft or overwrite a previous approved resume.
- Desktop and narrow-screen reviews can reach feedback and approval without excessive scrolling.
- A persistent action area does not cover content, keyboard input or focus targets.
- Existing fixture labels remain visible; no mock output is represented as live AI.

Live end-to-end provider validation is deliberately deferred at the user's request.
