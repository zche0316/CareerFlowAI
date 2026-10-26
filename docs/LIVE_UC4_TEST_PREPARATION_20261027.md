# UC4 live-provider test preparation — 27 October 2026

Raphael Wang / R4 + UC4. AI-assisted preparation and bounded provider verification.

## Verified provider result

The account's billing page showed **Free / $0 / Current Plan**. A project test key
was created with user confirmation and expires on 3 November 2026. Its value is
stored only in the ignored local `.env`.

The first real provider smoke test passed: two Responses API requests, one
`read_approved_context` tool event, 851 input tokens, 404 output tokens and
1,241 ms elapsed. All four returned IDs referenced supplied fictional facts;
the returned reasons matched the SQL/Python reporting test vacancy. The rendered
candidate wording came verbatim from those facts. Local report:
`output/live-uc4-smoke-1793037891857.json`.

Configuration-only checks, missing-credential refusal, TypeScript checks and all
four existing mocked provider tests also passed. These checks are separate from
browser and database acceptance.

## Verified application rehearsal

The local app was started with Groq live mode and the existing persistent PGlite
database. A new mission used the approved fictional Alex Morgan profile and the
explicitly fictional Harbour Analytics Junior Data Analyst job. Existing fixture
missions and the previously approved profile were retained.

- Career analysis completed, then the user-facing job choice handed off to UC4.
- The real resume draft contained Python, SQL, education and the existing project.
  Approval was disabled without explicit review.
- One revision asked for SQL first and emphasis on the existing reporting project.
  Draft 2 placed SQL first and also selected the already-approved Excel/Git facts.
  No unsupported candidate fact was introduced. This is evidence selection and
  ordering, not unrestricted resume rewriting.
- Draft 2 required fresh consent. Approval persisted resume
  `3bbb17aa-aa18-4721-a4c8-9ab9a93470c2`. The saved screen survived page reload.
- The downloaded TXT matched the displayed grouped content and original facts.
- The broader mission reached Awaiting Interview with three generated questions;
  its activity showed **8 model requests and 7,690 tokens**. No answers or final
  interview feedback were tested during this rehearsal.

Local evidence: `output/acceptance/uc4-groq-live-draft-20261027.png`,
`output/acceptance/uc4-groq-live-saved-20261027.png`,
`output/acceptance/groq-free-plan-20261027.png`,
`output/uc4-groq-live-mission-20261027.txt` and
`output/uc4-groq-live-approved-20261027.txt`. Generated evidence and credentials
remain ignored by Git. The app is currently in live mode; new missions use Groq.
Old fixture missions retain their original mode.

Live vacancy retrieval, late-result cancellation, rate-limit recovery, full
interview completion and independent teammate acceptance remain unverified in this
increment. Earlier fixture tests remain separate evidence.

## Selected free-tier candidate

Groq Free plan with `openai/gpt-oss-20b`. Its documented Responses API supports
function calling and structured outputs through the existing OpenAI-compatible
endpoint. The API is beta; documentation alone does not establish compatibility.
The successful bounded calls and application rehearsal are recorded above.

Official references checked on 27 October 2026:

- [Responses API](https://console.groq.com/docs/responses-api)
- [Structured outputs](https://console.groq.com/docs/structured-outputs)
- [Free-plan rate limits](https://console.groq.com/docs/rate-limits)
- [Billing](https://console.groq.com/docs/billing-faqs)
- [Create a key](https://console.groq.com/keys)

The published free-plan table lists 30 requests/minute, 1,000 requests/day,
8,000 tokens/minute and 200,000 tokens/day for this model; the account's actual
limits take precedence. Excess usage returns HTTP 429. Stay on Free plan and
do not upgrade to Developer billing for this rehearsal.

## Local configuration and bounded smoke test

Keep secrets in the ignored local `.env`; do not paste a key into Jira, Git or chat.
The preparation leaves the app in fixture mode until a key is available.

```dotenv
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=your-local-groq-key
OPENAI_MODEL=openai/gpt-oss-20b
PROVIDER_MODE=fixture
```

Run `npm run test:live:uc4` to inspect only configuration, without a network call.
Run `npm run test:live:uc4 -- --run` to send a small fictional UC4 context through
the application's real provider adapter. Alternatively the smoke script accepts
`GROQ_API_KEY`; the application itself still uses `OPENAI_API_KEY`.

The smoke test uses no database or existing candidate record. It requires the
allowlisted context-tool exchange, validates structured selected fact IDs, and
renders original evidence wording. It permits at most three adapter requests
(normally two plus one correction), uses the existing 25-second shared deadline,
does not retry automatically and never silently falls back to fixtures.
Generated reports are ignored under `output/live-uc4-smoke-*.json`; they include
latency, token counts, tool events and fictional claims, but no credentials or raw
provider error payload. Human review of selection relevance is still required.

## Application rehearsal after the smoke test passes

1. Set `PROVIDER_MODE=openai`, stop the current app and restart once with
   `npm run start:local`. Keep the persistent local database. Do not run a second
   app or database-test process against that portable instance.
2. Use a fictional reviewed profile with explicit sharing permissions. Start a
   **new** mission: existing fixture missions retain their original mode.
3. Initially keep `JOB_SOURCE=fixtures` to isolate live-AI compatibility. This is
   real model inference against a fictional job, not live vacancy acceptance.
4. Review the activity/tool records, selected evidence, displayed resume, revision
   and fresh approval; explicitly approve, download and compare the saved text.
5. Check cancellation/late-result preservation and errors without overwriting old
   approved resumes. Record mission IDs, timings, screenshots and actual results.
6. Only then switch to `JOB_SOURCE=employers` and test a fresh real employer listing,
   its official source/link, and the same UC4 flow. Do not submit applications.
7. Test one scenario at a time. On 429, wait and retry manually rather than
   upgrading billing. Keep latency and rate-limit failures visible in the evidence.

The provider-only smoke test does not verify database persistence, browser behavior,
cancellation races, live job retrieval, final deployment or teammate acceptance.
