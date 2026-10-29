# Tavily recruitment discovery

Implemented on 28 October 2026 following [Tavily agent setup, Path B](https://tavily.com/agent-setup/SKILL.md) and its [application best practices](https://github.com/tavily-ai/skills/tree/main/skills/tavily-best-practices). The backend uses Tavily REST; there is no dependency on a locally authenticated agent CLI.

## Configuration

Add the following to the existing private `.env`, preserving database and model settings:

```dotenv
TAVILY_ACCESS_MODE=api_key
TAVILY_API_KEY=your_private_tavily_key
JOB_SOURCE=employers
```

Restart with `npm run start:local`. Open Career missions → New career mission → Job source → **Tavily discovery · verified public job boards**. Choose country, optional city and keywords, then start. Set `JOB_SOURCE=tavily` only if it should become the default. Docker Compose forwards both Tavily variables.

Tavily dashboard login alone does not configure the application. Keys stay on the server; `/api/session` exposes only configuration availability and access mode. Do not paste keys into chat, source control or screenshots.

For an explicitly selected, limited trial, use `TAVILY_ACCESS_MODE=keyless`. Search uses Tavily's documented `X-Tavily-Access-Mode: keyless` header and sends no API key. Quotas and availability are controlled by Tavily. Invalid keys never cause an automatic fallback to keyless or fixture mode. Keep `api_key` for normal account-backed use.

## Workflow and boundaries

1. The Job Matching Agent sends only search keywords and geography to Tavily. It does not send profile text, resume evidence or account credentials.
2. One basic Search request discovers at most five links, restricted to Greenhouse, Lever and Ashby posting hosts. Answer generation and raw page content are disabled.
3. Posting identities are parsed and confirmed through fixed official ATS API endpoints. Arbitrary search-result URLs are never fetched. Search snippets never become job descriptions. Removed/unlisted postings are excluded; unavailable verification is reported.
4. Confirmed jobs use the existing geography and suitability filtering, profile version, mission persistence and ranking. Search coverage records discovered/verified counts and reported search credits.
5. Selection rechecks the official posting. Resume approval, interview practice and explicit user-controlled application preparation continue through the existing workflow. Nothing is submitted automatically.

Public Greenhouse GET, Lever postings GET and Ashby public posting-board GET need no API keys. A board identifier and public posting are still necessary; these APIs do not provide unrestricted global market search. Company labels currently use board identifiers; unconfirmed salaries remain unknown. Five indexed links are a small discovery sample and may include tangential results, removed jobs or no suitable jobs. Tavily access is independent of Groq/OpenAI model credentials and AI fixture/live mode.

## Verification evidence

A real, explicitly keyless search for `Canva software engineer jobs Australia` returned five indexed links, four officially verified postings and three Australian location matches, reporting one search credit. This included two Lorikeet roles and a Chainguard role; the query does not guarantee an exact employer match. See ignored local evidence `output/tavily-20261028/live-search.json`. A separate Sydney search returned removed Optiver postings, which were rejected by official APIs. The same bounded query was also verified using the user's configured account API key: authentication succeeded, with five links, four verified postings, three Australian matches and one reported search credit. Evidence: `output/tavily-20261028/account-search.json`. Results change over time.

Automated transport tests cover bounded search, server-only credentials, malicious/unsupported URLs, geography, duplicate postings, removal, canonical Greenhouse host aliases, Lever verification, Ashby unlisted records, cancellation and authentication/rate/credit failures. Full local verification passed: 94 Vitest tests, six original matching tests, TypeScript checking and production build. The existing DeepSeek mock test now explicitly clears the local OpenAI key to isolate credentials. Full verification results are recorded in `output/tavily-20261028/verification.log`; all 16 existing browser regression tests also passed (`output/tavily-20261028/browser-tests.log`).

Manual browser acceptance used the existing fictional Alex Morgan QA profile and real account-backed Tavily search. At the ordinary 40-point threshold, the three retrieved roles yielded no suitable matches. A separately labelled connectivity-only mission with threshold zero displayed three 20-point jobs; selecting Lorikeet's Forward Deployed Engineer Intern rechecked Ashby's official API and reached the existing evidence-grounded resume approval screen. The resume remains unapproved. AI remained fixture mode (zero model calls); these results validate Tavily and the handoff, not live Groq generation or employment suitability. Screenshots: `output/tavily-20261028/coverage.png` and `resume-handoff.png`.
