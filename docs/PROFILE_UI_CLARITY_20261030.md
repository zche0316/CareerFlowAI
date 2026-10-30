# Profile conversation and review clarity

The profile page previously presented the full draft, sharing settings, several interview controls and one organise button for every experience beside the conversation. This made the next step hard to identify, especially at the end of an interview.

The working page now has one conversation area and a compact profile overview. Full draft details, manual editing, sharing choices, extra interview controls, memory and recovery remain available through labelled disclosures. Experience organisation uses one labelled selector and one action; the request keeps both the record ID and section, so work and project records cannot be confused.

Preparing a draft opens a focused review layout with the complete existing profile summary and explicit confirmation before saving. The conversation stays mounted while hidden: returning to the draft preserves unsent text, local consent and conversation state. Keyboard focus moves to the review heading. Validation opens the manual editor so highlighted fields can be reached. Editing still invalidates the reviewed snapshot; failed saves and failed discards retain it.

The shared navigation uses a shorter navy header, quieter blue buttons and neutral panels. On narrow screens, both navigation rows scroll horizontally with readable names. The page itself does not overflow.

## Validation

- TypeScript check and Vite production build passed.
- All 23 browser cases passed across focused runs: profile conversation and memory, import, structured records, profile failure/race handling, zero-resume journey, interview controls and the full career journey.
- Added checks for preserving unsent chat and consent across focused review, and selecting the correct experience section with explicit model consent.
- Updated existing browser interactions to expand the newly collapsed controls before using them. Assertions for explicit approval and failure recovery are retained.
- Rechecked both mobile cases after the final navigation CSS change (390px width); both passed.
- Visually inspected desktop conversation, finished-interview and focused review states, plus the mobile layout.

Validation used fictional local accounts, an isolated portable database and the fixture provider. No live model request, paid service or production deployment was used. Backend schemas and workflow APIs are unchanged.

## Local preview

This review checkout uses http://localhost:8797 with an isolated local database on port 55448. Its private `.env`, local database, dependencies and generated browser artifacts are ignored by Git. Normal repository startup remains `npm run start:local`.

Branch: `ui/profile-workspace-clarity-20261030`, based on main `b3b146c` (the previously merged workspace navigation simplification).
