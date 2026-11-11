# Readiness for real users

Reviewed 2026-11-11 at `main` `eb3d103` (PR #24 merged). This page lists what a real user can do
today, the live checks behind that, and what is still missing before someone outside the team
can use CareerFlow end to end. Jira was not reachable from the review environment (the
Atlassian connector points at another host), so this page also carries the latest test record
for CFS-41 until it is copied there.

The short-term goal is a reliable local demo; its workflow, gaps and feature checklist are in
[LOCAL_DEMO.md](LOCAL_DEMO.md).

## What works end to end today

On a computer running the app (`npm run start:local` or Docker), with live model keys:

1. Create an account, build or import a profile, approve it.
2. Find roles: official boards and Tavily (low cost), or model web search (finds most).
3. Scout ranks new roles, starts one resume team per shortlisted role and stops at draft review.
4. A lead on a site the server may not read (SEEK, LinkedIn, Indeed) can be opened by the user,
   pasted back, scored and tailored.
5. Review, return or approve the draft; practise the interview; export PDF or DOCX.

Nothing is sent to an employer; applying stays manual by design.

## Live checks on 2026-11-11

Local QA account, live mode, configured native OpenAI model. The QA profile is the fictional
sample profile, so match scores are low by construction.

### Scout sweep with model web search

Search: graduate data analyst, Sydney.

| Step             | Result                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model web search | 14 searches, 15 page opens by the model, 15 roles reported                                                                                                   |
| Server check     | 3 pages checked, 11 leads, 1 rejected (a SEEK list page without the company)                                                                                 |
| Leads            | 7 on sites whose robots.txt forbids automated reading, 4 pages Tavily could not read                                                                         |
| Scoring          | 3 checked roles scored, 2 shortlisted: FDM Group "Project Grace: Data Analyst Graduate Program" (34), Synogize "Graduate Consultant - Data & Analytics" (30) |
| Packages         | both resume teams started; their final state was not recorded                                                                                                |
| Cost             | 4 traced model calls, 266,723 input and 21,282 output tokens, 4.9 minutes                                                                                    |

Found in this sweep: 4 of the 11 leads linked to a board search results page rather than the
job. Fixed afterwards: such links are never read as postings and the lead says to find the
role by title.

### Pasted lead with a real SEEK advertisement

- **Lead:** Transit Systems West, "Graduate Performance Analyst", SEEK job 95737299, opened in a browser.
- **Pasted text:** 2,743 characters of the advertisement, typed into the paste box (the browser pane's clipboard did not carry text between tabs).
- **Record:** rebuilt from the pasted text. Work rights are "right to work", quoting "Applicants must have full working rights in Australia."; level is graduate. Arrangement and salary are empty because the ad does not state them.
- **Score:** 30. The Gap Analyzer found approved evidence for 5 of 16 requirements.
- **Resume team:**
  - Round 1: the Critic returned one issue, "put Excel ahead of SQL and Python".
  - Round 2: the Evidence Selector re-selected and the Critic passed.
  - The draft stopped at review and appeared in the sweep's batch review.
- **Cost:** 10 model calls, about one minute. The draft was left for the user; it was not approved.

### Checks run before and after

- **`verify:local`:** 318 tests.
- **Playwright:** 52 tests, classic and quest.
- **CI on PR #24:** passed after one timing fix in the journey browser test.
- **Evaluation:** discovery comparison, eval results and the measurement method are in [EVALUATION.md](EVALUATION.md).

## Gaps before real users can use it end to end

### Blocking

1. **No hosted deployment.** The app runs only on a computer that starts it locally or with
   Docker. A shared instance needs:
   - a public HTTPS host and domain;
   - managed PostgreSQL with backups (S3 currently backs up approved PDFs only);
   - server-side secret storage for model and Tavily keys;
   - a worker that keeps running for queued missions and the daily schedule.
2. **No account recovery.** There is no password reset or email verification, so a user who
   forgets a password loses access to their data.
3. **No per-user spending limit.** Missions have a model-call budget and Scout allows six sweeps
   a day, but nothing caps tokens or money per user. One model-web-search sweep used about
   267k input tokens. The daily schedule would repeat that cost every day. A real deployment
   needs a per-user daily cost cap and an operator view of spend.
4. **Daily schedule not observed firing.** Only manual sweeps have been run live.

### Important

5. **Few roles without model web search.** The low-cost sources found 1 and 0 roles in the two
   comparison searches. Model web search needs the native OpenAI route. Most entry-level roles
   are on SEEK, so they arrive as leads that need a manual paste.
6. **Tracked roles are never re-checked.** Closed roles and stale leads stay on record as if open.
7. **One interface.** Resolved 2026-11-11: the classic interface was removed and every browser
   test runs in Quest. See [LOCAL_DEMO.md](LOCAL_DEMO.md).
8. **Extraction accuracy.** Rule extraction is about 88% field accuracy on held-out ads, with
   arrangement the weakest field. The live Job Matcher mapping fails schema validation about
   once per sweep, and that role is left out.
9. **Terms and privacy not reviewed.**
   - SEEK's terms of use: the app does not read SEEK pages itself, and the user pastes the text.
   - A privacy notice and an account-deletion path for real users.

### Later

10. Outreach drafts (cover letter, referral message) are not built.
11. Supervisor, ask-human and live timeline milestones (M3–M5) are designed but not wired.
12. Some features are built but not exercised: the LangSmith passthrough and the Battle log cost table have not been checked in a browser.
13. Maintainability:
    - the web bundle is about 600 kB;
    - `apps/web/src/main.tsx` is about 3,300 lines;
    - the Jira connector configuration needs correcting.

## Suggested order

Start with items 1–4, which turn the local app into a usable hosted service. Then item 6, so
users do not apply to closed roles. Items 5 and
8 can improve in parallel using the evaluation floors to measure each change.
