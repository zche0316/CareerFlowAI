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

## The demo workflow

One story, in this order. Each step names the Quest page where it happens.

1. **Sign in** → Home.
2. **Build the profile** (My profile): chat or import a resume, review the STAR stories, approve version 1.
3. **Find roles** (Jobs, or Scout):
   - Jobs: a search or a pasted job link.
   - Scout: a sweep that ranks roles and lists leads.
4. **Choose one role** and read the fit and gap analysis.
5. **Resume team** (Quests → quest page, Battle log): Rewriter, Evidence Selector and Critic
   rounds, then the draft stops for review.
6. **Review** (Decision inbox / Party review): return once with a comment, then approve.
7. **Interview practice**: one round, finish early, read the feedback.
8. **Export** (My documents): PDF and DOCX.
9. **Applications**: record that you applied (applying stays manual).
10. **Scout lead**: open a SEEK lead, paste the ad, open the package (repeats steps 5–6 for that role).

Rehearse the whole route in fixture mode. Then run it once in live mode the day before the demo.

## Gaps for this goal

Ordered by demo risk. Each gap has a "done when" check.

| #   | Gap                                                                                                                                                                                                                                   | Done when                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Done 2026-11-11.** The classic interface is removed; every Playwright spec runs in Quest. `tests/e2e/demo-workflow.spec.ts` drives steps 1–9 and the Scout sweep through the Quest UI only, in fixture mode.                        | Met. Step 10 (pasted SEEK lead) needs live model search, so it stays a manual live check.                                                                     |
| G2  | **Walked by the ported specs; styling still mixed.** Every page and step in the checklist opens and works in Quest. The More-menu pages and parts of the quest steps still use the older panel styling inside the Quest shell.        | Each page uses Quest styling. That is a visual change, not a functional gap; the boxes below still need a manual run.                                         |
| G3  | **No demo reset.** A fresh account starts empty, and building a profile live takes several model calls.                                                                                                                               | One command or documented step gives a clean demo account with an approved fictional profile, without touching `.runtime/pglite` data the user wants to keep. |
| G4  | **Live route not re-run end to end.** Two Scout packages from the 2026-11-11 sweep have no recorded final state. Interview, export and applications have not been run live since the multi-agent work.                                | One live pass of the demo workflow, with model calls and time recorded in [READINESS.md](READINESS.md).                                                       |
| G5  | **Live failure points in Scout.** Job Matcher mapping fails schema validation about once per sweep and drops that role. Without model search the low-cost sources found 0–1 roles.                                                    | Mapping retries once before dropping a role. The demo uses model search or a pasted job link, and the empty state says what to do.                            |
| G6  | **Unexercised features.** Nobody has opened these in a browser: the Scout daily schedule, the LangSmith passthrough, the Battle log cost table, the S3 backup (it needs AWS credentials), the reminder calendar file and negotiation. | Each one either works in a local run or is hidden from the demo, with its note in the checklist.                                                              |
| G7  | **Missing-key messages.** It is not checked what a user sees when the Tavily, OpenAI or AWS keys are absent in live mode.                                                                                                             | Each missing key gives one plain message on the page that uses it, with no stack trace and no blank page.                                                     |

Next: G3, then G4. G5–G7 can be worked through during the G4 live pass.

### Found while doing G1 and G2

Fixed:

- At phone width the Quest top bar covered the new-quest form, so its close button could not be clicked.
- Home showed "Start your first quest." when the latest quest had failed. It now offers "Review and retry", or "Review saved results" once the model-call budget is spent. The Quest log uses the same labels.
- The completed-quest results page had no Quest header or route; it now has both.
- Stage buttons still said "Go to 03 Job matching" and "Go to 04 Resume tailoring". They now say "Go to the Shortlist" and "Go to the Review".
- The Applications step now explains that demo roles have no application link.

Still open:

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
| New mission uses profile search defaults     | Jobs       | Q agent-native             | [ ]     | [ ]  |
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

| Feature                                           | Quest page     | Auto                                                                 | Fixture | Live |
| ------------------------------------------------- | -------------- | -------------------------------------------------------------------- | ------- | ---- |
| Interview: answer all questions, receive feedback | quest page     | Q journey; Q quest page (opens only)                                 | [ ]     | [ ]  |
| Interview: stop, skip, finish early               | quest page     | Q interview-controls, journey; D                                     | [ ]     | [ ]  |
| Multiple interview rounds                         | quest page     | I integration                                                        | [ ]     | [ ]  |
| Export PDF and DOCX                               | My documents   | Q zero-resume; D                                                     | [ ]     | [ ]  |
| S3 cloud backup of an approved PDF (needs AWS)    | My documents   | I cloud-backups                                                      | n/a     | [ ]  |
| Applications: record and track                    | Optional tools | D (status only; needs a live listing link to prepare an application) | [ ]     | [ ]  |
| Negotiation helper                                | Optional tools | I negotiation, tools                                                 | [ ]     | [ ]  |
| Reminders and calendar file                       | Optional tools | I tools                                                              | [ ]     | [ ]  |
| Activity timeline                                 | Activity       | none                                                                 | [ ]     | [ ]  |
| Season event page                                 | Season         | Q page render                                                        | [ ]     | [ ]  |

### Recovery and safety

| Feature                                                  | Quest page  | Auto                                | Fixture | Live |
| -------------------------------------------------------- | ----------- | ----------------------------------- | ------- | ---- |
| Failed mission can be retried                            | quest page  | Q mission-recovery                  | [ ]     | [ ]  |
| Cancel a running mission                                 | quest page  | Q agent-native; Q quest page        | [ ]     | [ ]  |
| Reload mid-journey keeps decisions; future steps blocked | any         | Q guided-journey, journey-isolation | [ ]     | [ ]  |
| Nothing is sent to an employer                           | n/a         | by design                           | [ ]     | [ ]  |
| Missing live key shows a plain message                   | Scout, Jobs | none                                | n/a     | [ ]  |
