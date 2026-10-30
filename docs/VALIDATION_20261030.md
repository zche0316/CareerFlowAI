# CareerFlow validation — 30 October 2026

## Executed checks

- `npm run verify:local`: 26 test files, 168 tests passed; six original matching checks passed; production build passed. The normal application was stopped before using its portable database and restarted afterwards.
- `npm run typecheck`: passed after narrowing the model context type to the fields actually sent.
- Live browser check: `PROVIDER_MODE=openai PLAYWRIGHT_BASE_URL=http://localhost:8878 npx playwright test tests/e2e/journey.spec.ts -g 'answers every interview question' --reporter=line`: one test passed in 23.4 seconds.
- Live means actual Groq Responses API calls using `openai/gpt-oss-120b`. Accounts, profile content, jobs and salary figures in that run were fictional. An isolated database and port 8878 protected existing user data.
- The live test covered profile approval, career analysis, job selection, resume generation/approval, automatic interview handoff, all three saved answers, feedback, optional salary negotiation and a persisted practice decision.
- Live screenshots: [interview](evidence/2026-10-30/interview-complete-live.png), [salary practice](evidence/2026-10-30/salary-negotiation-live.png). These precede the final removal of residual sage colours; they are functional evidence, not final visual parity evidence.

- Latest fixture browser regression: journey, conversation/memory, zero-resume and prototype-navigation suites: **10 passed in 51.2 seconds**. Includes 390px overflow checks and source-to-export journey.
- Final-colour feedback screenshot: [fixture visual check](evidence/2026-10-30/interview-final-colours.png).

## Repairs and review findings

- An invalid model-selected resume fact ID previously failed the entire step. Ineligible suggestions are now excluded; only supplied eligible facts can enter the extractive resume. An entirely invalid selection still fails visibly. This does not approve generated candidate claims.
- Salary practice no longer sends full fact provenance or the entire selected-job object. It sends fact IDs/types/text, role title/description and the explicit practice inputs. Its output instruction now specifies the complete concise feedback shape. The subsequent real run passed; the previous failure did not retain a precise diagnostic category, so its exact cause is not established.
- Added category-only server diagnostics for salary failures, without candidate text, model output or credentials.
- Career Coach had suggested invented example metrics in resume advice. The instruction now forbids invented candidate metrics or certifications. This is a prompt constraint, not proof that arbitrary generated advice is factually guaranteed.
- Visual screenshot review identified sage feedback text and service controls left behind by older CSS. Legacy green values were replaced with neutral surfaces/text; the brand orange remains #ff5a1f and explicit completion green remains #22c55e.

## Task evidence and remaining acceptance

- CFS-41: connected journey and real-provider rerun evidenced above. This does not establish independent team review or hosted deployment.
- CFS-33: optional salary practice and final user choice passed in the real-provider browser run.
- CFS-59–65: implementation exists across profile conversation, memory, evidence, application editions and validation. Do not infer current Jira status from this file; current board readback was unavailable in this session.
- Prototype fidelity: logo, locally bundled Inter, orange, five-stage navigation and page layouts are integrated. Full pixel parity is not established. The prototype's travelling dial ripple is not yet reproduced exactly; real data and additional approval/recovery states need page-by-page visual review.
- Retrieval: default remains scoped keyword retrieval. Local vector experiments are opt-in, with an uncalibrated threshold and a small synthetic evaluation. They are not production-quality recall evidence.
- Career Coach still runs before job selection. The post-selection evidence fit panel does not establish a redesigned post-job AI coaching flow.
- DOCX/PDF generation has automated coverage, but this live browser run did not download and visually inspect both files.
- Review, retrospective, team feedback and release decisions must link actual team activity; automated passes do not create that evidence.

Jira synchronisation was initially unavailable during this validation run. The evidence in this file
is intentionally independent of workflow status; a later Jira update must link the merged PRs and
must not treat automated checks as team review or retrospective evidence.
