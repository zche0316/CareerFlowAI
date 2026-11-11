# Local demo readiness

Short-term goal (set 2026-11-11): CareerFlow runs on one computer and every product feature
works for a live demo, in the default Quest interface, along one clear workflow. Hosted
deployment is out of scope for now; the longer list is in [READINESS.md](READINESS.md).

## Demo setup

| Item           | Choice                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Start          | `npm run start:local`, open http://localhost:8787. The embedded worker runs missions and the Scout schedule in the same process. |
| Rehearsal mode | `PROVIDER_MODE=fixture`: deterministic, free, no keys. The top bar shows the fixture badge.                                      |
| Demo mode      | Live keys in `.env`. Model web search in Scout needs `OPENAI_NATIVE_API_KEY` and `OPENAI_NATIVE_TEXT_MODEL`.                     |
| Mode rule      | A mission keeps the mode it was created in. After switching mode, create a new mission.                                          |
| Data           | Portable database in `.runtime/pglite`. One app process at a time.                                                               |

## Demo account

With the app running, one command creates a ready account:

```sh
npm run demo:account                                  # app on http://localhost:8787
npm run demo:account -- --url http://localhost:8797   # another port
```

The profile is Jordan Ellis, a fictional Data Science graduate. The person, university, employers and
contact details are invented; the structure and level follow typical Australian graduate resumes:

- a degree with a WAM, coursework and a Dean's List line;
- a twelve-week data analyst internship;
- a part-time customer service job during study;
- a team capstone, a course project and a personal project;
- a club role and volunteering.

Each result is stated modestly ("I did not measure time saved"), so the resume team has real evidence
to select and the Gap Analyzer still finds real gaps. The source is `scripts/demo-profile.mjs`.

The account skips step 2 of the workflow below. To demo profile building as well, create a second
account by hand.

## The demo workflow

One story, in this order. Each step names the Quest page where it happens.

1. **Sign in** → Home.
2. **Build the profile** (My profile): chat or import a resume, review the STAR stories, approve version 1.
3. **Find roles** (Quests → Find roles, or Scout):
   - Find roles: official job boards, a pasted listing, or demo roles in fixture mode.
   - Scout: a sweep that ranks roles and lists leads.
4. **Choose one role** and read the fit and gap analysis. Save a second role to the Quest log for
   later.
5. **Resume team** (Quests → quest page, Battle log): Rewriter, Evidence Selector and Critic
   rounds, then the draft stops for review.
6. **Review** (Decision inbox / Party review): return once with a comment, then approve.
7. **Interview practice**: one round, finish early, read the feedback.
8. **Export** (My documents): PDF and DOCX.
9. **Applications**: record that you applied (applying stays manual). The role moves to Applied in
   the Quest log.
10. **Tailor a saved role** (Quest log → Tailor resume): a new run starts at the resume team.
11. **Coach** (Home): next steps across all roles; Refresh advice makes one model call.
12. **Scout lead**: open a SEEK lead, paste the ad, open the package (repeats steps 5–6 for that role).

The Quest log lists roles, not searches: each role keeps every resume and practice run made for
it (see [WORKSPACE_MODEL.md](WORKSPACE_MODEL.md)).

Rehearse the whole route in fixture mode. Then run it once in live mode the day before the demo.

## Gaps for this goal

Ordered by demo risk. Each gap has a "done when" check.

| #   | Gap                                                                                                                                                                                                                                                                                                     | Done when                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Done 2026-11-11.** The classic interface is removed; every Playwright spec runs in Quest. `tests/e2e/demo-workflow.spec.ts` drives steps 1–9 and the Scout sweep through the Quest UI only, in fixture mode.                                                                                          | Met. Step 10 (pasted SEEK lead) needs live model search, so it stays a manual live check.                                             |
| G2  | **Walked by the ported specs; styling still mixed.** Every page and step in the checklist opens and works in Quest. The More-menu pages and parts of the quest steps still use the older panel styling inside the Quest shell.                                                                          | Each page uses Quest styling. That is a visual change, not a functional gap; the boxes below still need a manual run.                 |
| G3  | **Done 2026-11-11.** `npm run demo:account` creates a fresh account through the app's API with the fictional graduate Jordan Ellis approved as profile v1 and three confirmed career memories. No model calls; existing accounts are untouched.                                                         | Met. Each run makes a new account; sign-in details go to `.runtime/demo-account.json`.                                                |
| G4  | **Done 2026-11-11.** One live pass of the whole route with the demo account; numbers in [READINESS.md](READINESS.md). It found the Critic loop below (fixed).                                                                                                                                           | Met. Repeat the day before a demo.                                                                                                    |
| G5  | **Partly open.** Live Scout with model search returned only SEEK and LinkedIn leads for "data analyst", so nothing was checked or packaged; two leads were senior roles. The low-cost search found 2 roles. Job Matcher mapping did not fail in this run.                                               | For the demo, use a quest with the low-cost search, or a pasted lead. Still open: filter leads by level; retry a failed mapping once. |
| G6  | **Partly checked.** Battle log cost table: works with live data. Not checked: the daily schedule (needs a 07:00 run), LangSmith (no key configured). S3 backup, reminders and negotiation were removed in CFS-108.                                                                                      | Hide or skip the unchecked ones in the demo.                                                                                          |
| G7  | **Checked with every key blank.** A quest stops with "Live AI requires either the compatible-provider key/model settings or the native OpenAI override settings" and keeps saved data. Scout used to report "0 fetched" with no reason; it now says web pages are skipped because no Tavily key is set. | Met for quests and Scout. The quest message is still technical wording.                                                               |

G1–G4 are done; G5–G7 are partly open, as listed.

### Found while doing G1 and G2

Fixed:

- At phone width the Quest top bar covered the new-quest form, so its close button could not be clicked.
- Home showed "Start your first quest." when the latest quest had failed. It now offers "Review and retry", or "Review saved results" once the model-call budget is spent. The Quest log uses the same labels.
- The completed-quest results page had no Quest header or route; it now has both.
- Stage buttons still said "Go to 03 Job matching" and "Go to 04 Resume tailoring". They now say "Go to the Shortlist" and "Go to the Review".
- The Applications step now explains that demo roles have no application link.

Still open:

- Live interview practice generated a single question for this role (fixture mode always has three).
- In the profile builder conversation, the layout shifts by 1px every frame (headless Chromium; it also happens with the stylesheets from `main`). Two clicks in `interview-controls.spec.ts` skip Playwright's stability wait because of it. The cause is not found yet; deleting any one of several unrelated CSS rules stops it, so it looks like a layout feedback loop.
- A Scout sweep run after a quest skips the roles that quest already saw. With the demo roles this can leave no new role above the minimum match, so no package starts. For the demo, run Scout before the quest or lower the minimum match.

## Feature checklist

How to read the columns:

- **Auto** names the existing automated check. Q = Quest Playwright spec, D = the demo-workflow
  spec, I = API or integration test.
- **Fixture** and **Live** are ticked during a manual run in the Quest interface. Leave a box
  empty until it has been seen working.

### Account and workspace

| Feature                                                 | Quest page   | Auto                              | Fixture | Live |
| ------------------------------------------------------- | ------------ | --------------------------------- | ------- | ---- |
| Register, sign in, sign out                             | sign-in page | Q auth-brand; D                   | [ ]     | [ ]  |
| Home overview: recent journeys, level/XP, waiting count | Home         | Q page render; Q agent-native     | [ ]     | [ ]  |
| Phone width without sideways scroll                     | all          | Q page render (7 pages); Q mobile | [ ]     | [ ]  |

### Profile

| Feature                                                    | Quest page | Auto                                     | Fixture | Live |
| ---------------------------------------------------------- | ---------- | ---------------------------------------- | ------- | ---- |
| Profile conversation, saved across reload                  | My profile | Q profile-conversation                   | [ ]     | [ ]  |
| Import resume text or pages, with consent                  | My profile | Q profile-import                         | [ ]     | [ ]  |
| Structured records: education, experience                  | My profile | Q profile-records, profile-workbench     | [ ]     | [ ]  |
| STAR stories with unknown outcomes allowed                 | My profile | Q profile-conversation                   | [ ]     | [ ]  |
| Organise experiences, polish wording                       | My profile | I profile-assistant; Q profile-workbench | [ ]     | [ ]  |
| Review then approve a version; failed save keeps the draft | My profile | Q profile, profile-workbench; D          | [ ]     | [ ]  |
| Career memories: add, edit, delete                         | My profile | I integration; Q agent-native            | [ ]     | [ ]  |
| Character sheet from the approved profile                  | Character  | Q page render                            | [ ]     | [ ]  |

### Finding roles

| Feature                                      | Quest page | Auto                       | Fixture | Live |
| -------------------------------------------- | ---------- | -------------------------- | ------- | ---- |
| Find roles uses profile search defaults      | Quests     | Q agent-native             | [ ]     | [ ]  |
| Save a role for later; tailor it later       | Quests     | D; I applications          | [ ]     | [ ]  |
| Role status and history across runs          | Quests     | D; I applications          | [ ]     | [ ]  |
| Coach next steps and refreshed advice        | Home       | D; I coach                 | [ ]     | [ ]  |
| Ranked jobs, compare, choose one             | Jobs       | Q journey; D               | [ ]     | [ ]  |
| Paste a job link into a reviewable candidate | Jobs       | Q agent-native; I job-link | [ ]     | [ ]  |
| Job availability check                       | Jobs       | I recruitment              | [ ]     | [ ]  |
| Fit and gap analysis                         | quest page | I job-fit                  | [ ]     | [ ]  |
| World page: country rules                    | World      | Q page render              | [ ]     | [ ]  |

### Scout

| Feature                                                | Quest page | Auto                   | Fixture | Live |
| ------------------------------------------------------ | ---------- | ---------------------- | ------- | ---- |
| Settings: keywords, source tier, minimum score         | Scout      | I scout                | [ ]     | [ ]  |
| Manual sweep → ranked shortlist → one package per role | Scout      | Q Scout batch; I scout | [ ]     | [ ]  |
| Model web search tier (native OpenAI only)             | Scout      | I agent-discovery      | n/a     | [ ]  |
| Leads listed with reason and "Open to check"           | Scout      | I agent-discovery      | [ ]     | [ ]  |
| Paste the ad → scored → package → open at draft review | Scout      | I scout (pasted lead)  | [ ]     | [ ]  |
| Batch review of the sweep's drafts                     | Scout      | Q Scout batch          | [ ]     | [ ]  |
| Daily schedule fires                                   | Scout      | none                   | [ ]     | [ ]  |
| Sweep trace and cost line                              | Scout      | I scout                | [ ]     | [ ]  |

### Resume team and review

| Feature                                                    | Quest page              | Auto                                        | Fixture | Live |
| ---------------------------------------------------------- | ----------------------- | ------------------------------------------- | ------- | ---- |
| Resume team rounds stop at draft review                    | Quests → quest page     | Q quest page; I resume-agent; D             | [ ]     | [ ]  |
| Battle log: agent steps and the cost table                 | Battle log              | Q quest page (log only); D                  | [ ]     | [ ]  |
| Party roster and party review                              | Party                   | Q page render, quest page                   | [ ]     | [ ]  |
| Return with a comment → Rewriter runs again                | Party review            | Q quest page; D                             | [ ]     | [ ]  |
| Manual edit and suggestions need a fresh review            | quest page              | Q agent-native                              | [ ]     | [ ]  |
| Restore an earlier draft; save points and branch           | Save points             | I integration, resume-agent                 | [ ]     | [ ]  |
| Approve the draft                                          | Decision inbox / review | Q agent-native; Q Scout batch; D            | [ ]     | [ ]  |
| Decision inbox: pending vs latest, cancelling clears badge | Decision inbox          | Q agent-native                              | [ ]     | [ ]  |
| Resume wording: per-line review and finalise               | My documents            | Q profile-conversation                      | [ ]     | [ ]  |
| Application answers and readiness check                    | quest page              | I profile-assistant; Q profile-conversation | [ ]     | [ ]  |
| Feedback memory from a review                              | quest page              | I integration                               | [ ]     | [ ]  |

### Interview, output and follow-up

| Feature                                           | Quest page   | Auto                                                                 | Fixture | Live |
| ------------------------------------------------- | ------------ | -------------------------------------------------------------------- | ------- | ---- |
| Interview: answer all questions, receive feedback | quest page   | Q journey; Q quest page (opens only)                                 | [ ]     | [ ]  |
| Interview: stop, skip, finish early               | quest page   | Q interview-controls, journey; D                                     | [ ]     | [ ]  |
| Multiple interview rounds                         | quest page   | I integration                                                        | [ ]     | [ ]  |
| Export PDF and DOCX                               | My documents | Q zero-resume; D                                                     | [ ]     | [ ]  |
| Applications: record and track                    | Quests       | D (status only; needs a live listing link to prepare an application) | [ ]     | [ ]  |
| Activity timeline                                 | Activity     | none                                                                 | [ ]     | [ ]  |
| Season event page                                 | Season       | Q page render                                                        | [ ]     | [ ]  |

### Recovery and safety

| Feature                                                  | Quest page  | Auto                                | Fixture | Live |
| -------------------------------------------------------- | ----------- | ----------------------------------- | ------- | ---- |
| Failed mission can be retried                            | quest page  | Q mission-recovery                  | [ ]     | [ ]  |
| Cancel a running mission                                 | quest page  | Q agent-native; Q quest page        | [ ]     | [ ]  |
| Reload mid-journey keeps decisions; future steps blocked | any         | Q guided-journey, journey-isolation | [ ]     | [ ]  |
| Nothing is sent to an employer                           | n/a         | by design                           | [ ]     | [ ]  |
| Missing live key shows a plain message                   | Scout, Jobs | none                                | n/a     | [ ]  |
