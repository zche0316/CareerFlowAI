# Sprint 1 — real job matching acceptance

This implementation follows the group lead's proposed Core Context & Jobs boundary. Existing resume/interview code remains available as a later-stage prototype; it is not proof of Sprint 2 acceptance. No Jira story is marked Done by this update.

## Adzuna setup

Register at https://developer.adzuna.com/signup. Use Adzuna-issued credentials, not Groq/OpenAI keys. Fill only the server `.env`:

```dotenv
JOB_SOURCE=adzuna
ADZUNA_APP_ID=your-app-id
ADZUNA_APP_KEY=your-app-key
ADZUNA_COUNTRY=au
```

Restart with `npm run start:local`. In 03 choose **Search Australian jobs**, select Adzuna, and optionally **Use approved profile search suggestions**. Review/edit keywords, state and city before starting. An empty city/region searches the selected country. Only keyword/location search terms and the Adzuna credentials go to the source; the full profile, name and contact details do not.

`JOB_SOURCE` and `ADZUNA_COUNTRY` are now actually read. The session endpoint exposes defaults and a boolean configured flag, never credentials. Without keys, Adzuna submission is disabled with a clear notice. `JOB_SOURCE=employers` keeps the currently working public company sources as an explicit alternative. There is no silent switch from failed Adzuna requests to company or fixture jobs.

## Acceptance evidence

| Criterion | Implementation / evidence |
| --- | --- |
| Title, company, location, description, original source link | Normalized source jobs enter existing ranking and target selection. Adzuna snippets and redirect links are disclosed. Missing company/location use Not supplied. |
| Source, retrieval time and missing salary | Cards expose source/time and Unknown salary. Predicted salary uses an explicit Provider estimate label. String `0` is not treated as an estimate flag. |
| Profile comparison and target handoff | Existing comparison and owner-scoped decision flow reused; database integration test intercepts only the external Adzuna transport and verifies scoring, deduplication and persisted selected URL. |
| Timeout, rate limit, empty and duplicates | Typed safe source errors; 429 Retry-After shown without secrets; no automatic retry storm; no-result state kept; duplicate IDs/URLs removed before ranking. Unit tests cover each path. |
| Failed API and fixture disclosure | Failed source remains failed with retry; no silent sample substitution. Offline fixtures require explicit selection. |

## Limits / pending live validation

The user has not yet applied for Adzuna credentials. Adzuna-specific tests use clearly mocked provider responses; this is not a successful live Adzuna integration claim. A final real search still requires credentials and verification of the account's access/rate limits. Public employer sources have separate real network verification from earlier work.

Only the first 30 Adzuna results are requested; provider total and dropped duplicate counts are surfaced separately. Vacancy publication or work eligibility is not independently verified through Adzuna; open the recruitment source to check details. Automatic application submission, additional integrations and Sprint 2 acceptance remain outside this change.

Official API reference: https://developer.adzuna.com/docs/search

## Verification completed on 19 October 2026

`npm run verify:local` passed migrations, type checking, 38 Vitest tests (29 unit tests and 9 database integration tests), six original matching tests and a production build: 44 tests total. The new database cases use mocked Adzuna HTTP responses and verify (1) normalized scoring/deduplication/target handoff and (2) visible 429 Retry-After failure followed by an explicit retry to an empty response without sample substitution.

The browser confirmed editable profile-derived `data analyst` / `Sydney` search terms, the Adzuna not-configured notice and disabled Start button while keys are missing. Real Adzuna response quality, account quota and actual source access are still pending credentials.
