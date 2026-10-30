# Minimal SaaS presentation refactor — 30 October 2026

Raphael Wang. AI-assisted implementation and verification, following the user's
explicit visual brief. Source baseline: main `b3b146c` (PR #8).

## Delivered presentation

- A single sticky, translucent light global header, exactly 56px high. Existing
  global navigation, mode disclosure, account initials and sign-out remain.
- A compact workspace strip places the existing title, lifecycle status, return
  action, cancellation, search/retry and run details together, followed by the
  existing five-step workflow. Narrow screens wrap utilities and show the current
  step name alongside the numbered steps. Navigation remains keyboard accessible.
- Inter and JetBrains Mono are bundled locally through Fontsource. Only the two
  normal Latin variable-font files are emitted; the UI does not request a font CDN.
- Slate-50 canvas, white bordered cards, restrained shadows, indigo primary actions
  and emerald success/agent accents. Display/serif typography is overridden in all
  application views, including login, modals and the resume preview.
- Decorative overlines and repeated page descriptions are visually suppressed.
  Consent, validation errors, source evidence and provider mode remain available.
  Existing control labels, aria-label/data-testid values and placeholder text are
  preserved. No API route, navigation handler or form binding was changed.
- Profile conversation and composer share a compact panel with an embedded consent
  footer; the grouped profile card is sticky on desktop. Existing skills use pills.
- Existing native details remain keyboard-operable bordered accordions. Analysis
  evidence uses inline disclosure badges; opening a badge reveals its full reason.
  Agent indicators respect reduced-motion preferences.
- Equal-height job cards retain their existing scores and ordering. Badge colors
  are presentation-only: >=75 emerald, >=50 indigo, otherwise amber; text scores
  remain visible, so color is not the only signal.
- Resume review retains the exact checkbox, disabled-state rules and approval hash.
  A sticky bottom dock keeps approval and revision controls reachable. The native
  revision disclosure opens above it on narrow screens.
- Document selection uses two columns on desktop and one on narrow screens.
  Consent/action rows are grouped, and the existing TXT/DOCX/PDF links are grouped
  without changing their destinations. Exported document generation is unchanged.

## Verification

- TypeScript: `npm run typecheck` passed.
- Existing workspace-navigation unit tests: 7/7 passed.
- Frontend production build passed, including both local font assets.
- `npm run test:e2e`: **23/23 passed** in the final full local run (1.1 minutes).
  This includes the 21 existing scenarios and two new presentation checks.
- New coverage verifies 56px sticky-header geometry; no horizontal document
  overflow at 390px; split-pane profile layout; disabled approval before consent;
  first-row job visibility and equal heights; keyboard citation disclosure;
  mobile revision-panel bounds; resume approval and interview handoff; two-column
  document selection; and unchanged export-link labels.
- Existing coverage exercises profile conversation/import, stale/delayed updates,
  failed save/discard, retained manual changes, interview controls, full/early
  feedback, wording editions and a candidate without a prior resume.
- The old mobile smoke test assumed the shared demo account had no approved
  profile. On this persistent local database it already did. The test now creates
  its own account through the existing helper; its profile and overflow assertions
  remain intact. Application behavior was not changed to satisfy that assumption.
- Desktop and narrow-screen images were visually inspected during iteration.
  Generated evidence is under ignored `output/saas-review/`.

## Boundaries

This increment changes frontend presentation and test setup only, plus font
dependencies and documentation. The legacy stylesheet remains the structural
fallback; `apps/web/src/saas.css` owns the new visual layer. Backend/domain code,
database schema, model/provider configuration, authentication, approvals and
workflow transitions were not edited. Local checks used fixture AI, fictional
candidate/job data and the existing persistent PGlite server. No live-provider,
production, deployment or independent teammate acceptance claim is made here.

## Readability follow-up — 30 October 2026

Following the user's live review, small supporting text is generally increased
from 10–11px to 12px, with profile/job descriptions at 13px and citation labels
at 11px. Consent text, skills, document metadata, navigation and resume review
controls use the larger sizes on narrow screens as well. Pale secondary text is
darkened. The mobile approval buttons share equal available width and can wrap
their unchanged labels. Search coverage keeps its existing structure and spacing;
no search coverage-specific rule or component was changed.

This follow-up changes CSS and this note only. The production build, both existing
focused SaaS browser scenarios and `git diff --check` passed after the final
adjustment. Desktop Profile and 390px resume output were visually inspected.
The full 23-scenario suite above belongs to the preceding refactor; it was not
rerun for this typography-only follow-up.
