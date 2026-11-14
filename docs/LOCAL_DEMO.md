# Local run and demo guide

CareerFlow runs on one computer. It narrows the information gap for technical roles across
regions: it finds roles, shows what each region's roles ask for, rates capability per skill from
evidence you approve, and tailors an evidence-grounded resume for each role you pursue. Hosted
deployment is not in scope yet (see "Before real users" below).

## Demo setup

| Item           | Choice                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Start          | `npm run start:local`, open http://localhost:8787. The embedded worker runs missions and the Scout schedule in the same process. |
| Rehearsal mode | `PROVIDER_MODE=fixture`: deterministic, free, no keys. The top bar shows the fixture badge.                                      |
| Demo mode      | Live keys in `.env`. Model web search in Scout needs `OPENAI_NATIVE_API_KEY` and `OPENAI_NATIVE_TEXT_MODEL`.                     |
| Mode rule      | A run keeps the mode it was created in; the role board shows the current mode's roles only.                                      |
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
2. **Build the profile** (My profile): chat or import a resume, review the STAR stories, approve
   version 1. Optionally add evidence from GitHub, certificates, a LinkedIn export, a personal
   site, Codeforces, Stack Overflow or LeetCode (Character → Add evidence), then approve.
3. **Capability levels** (Character): levels 0–4 per skill with confidence and evidence.
4. **Market insight** (World): what roles in the chosen country ask for.
5. **Coach** (More → Coach): career advice for the approved profile with the reason and evidence
   behind each point; ask it to revisit a point and refresh.
6. **Find roles** (Quests → Find roles) and choose one; save another for later. Scout can run a
   sweep that puts new roles on the board as "New from Scout". A search run shows Shortlist,
   Review, Practice and Apply; a run on a saved role starts at Review.
7. **Resume team** (quest page, Battle log): Gap Analyzer, Evidence Selector, Rewriter and Critic,
   then the draft stops for review. Return once with a comment, then approve.
8. **Interview practice**: answer, finish early, read the feedback.
9. **Recruiter view and export** (My documents): read-back, keywords, knock-outs, level gaps; PDF
   and DOCX.
10. **Record applied** on the role card (applying stays manual).
11. **Tailor the saved role** or **Practise interview** from its card; the Coach tile on Home
    shows the next steps across all roles.

Each role keeps every resume and practice run made for it ([WORKSPACE_MODEL.md](WORKSPACE_MODEL.md)).
Rehearse in fixture mode, then run once in live mode the day before a demo.

## Known limits

- Live interview practice sometimes generates one question (fixture mode always has three); the
  2026-11-13 run produced three.
- On real postings the evidence question lists phrased requirements, including soft skills such as
  "Creative problem-solving"; an answer with no chosen experience lists that phrase with the skills.
- Scout leads from sites it may not read (SEEK, LinkedIn) need the advertisement pasted; leads are
  not filtered by seniority.
- The live voice interviewer needs an OpenAI project with access to a realtime model and a
  transcription model; set `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_TRANSCRIBE_MODEL` to ones it can use.
  Recorded answers (CFS-139) need only a transcription model (`OPENAI_TRANSCRIBE_MODEL`, default
  `gpt-transcribe`).
  Not yet run end to end with a microphone.
- The daily Scout schedule and the LangSmith passthrough have not been observed live.
- External profile sources were tested against recorded responses, not the live services.

## Live runs

| Date       | Route                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | Mission flow with the demo account                   | 20 calls (42 of 60 requests), 49k in / 23k out tokens, 4 min 32 s. Found the Critic and Evidence Selector loop; fixed (1 return then pass, 5 calls, 52 s).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-11-12 | Role-centred flow (CFS-109)                          | First attempt failed on an unquotable requirement (CFS-117, fixed). Rerun: Find roles 2 roles in 66 s (6 calls, reused Coach advice); first role complete in 165 s (20 calls, 25.9k in / 15.5k out); saved role tailored in 141 s (16 calls); practice-only run 15 s (2 calls); Scout 0 new of 3 (discover-first); recruiter read-back 100%.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-11-13 | Run route, evidence question, cost preview (CFS-127) | Demo account, official boards, separate database. Coach refresh with a revisit note: 1 call (2 requests), 2.6k in / 0.9k out. Find roles reused that advice: 2 roles, 6 requests. The role asked about 3 required items with no evidence; 1 confirmed answer (tied to the capstone) became a draft line and covered its requirement, 1 stayed a draft memory, 1 was skipped. Resume team 10 requests (one Critic return, then pass), interview 3 questions, 1 answer, feedback. Run total 22 requests, 27.4k in / 14.1k out, 171 s of model time, 6 min 18 s with the user's turns. Found and fixed: an AI edit asked to change one line rewrote 6 (now 1); AI edits were missing from the trace; the interview panel ignored confirmed answers; the Coach estimate and the question notice were stale. |
| 2026-11-14 | PR #40 features (CFS-138)                            | Separate database, demo account. Profile Builder answered "who are you" and an off-topic, prompt-probing message in character without revealing instructions (before: "I'm ChatGPT"). Coach refresh: 1 request (before 2), 3.1k in / 1.7k out, cited O*NET Business Intelligence Analysts after three approved facts. Practice on a role with no resume: 3 questions from the profile, every agent 1 request / 1 attempt; after the fix it reuses the Coach's saved advice (1 request in total, before 3). Voice: the client secret is issued, but this project has no realtime model (model list shows only gpt-transcribe for audio), so the call returned 403; the server now checks access first and says so.                                                                                       |

## Before real users

1. Hosting: HTTPS host, managed PostgreSQL with backups, server-side secrets, an always-on worker.
2. Account recovery: password reset and email verification.
3. A per-user daily spending cap and an operator view of spend.
4. Terms and privacy review (privacy notice, account deletion).

## Feature checklist

How to read the columns:

- **Auto** names the existing automated check. Q = Quest Playwright spec, D = the demo-workflow
  spec, I = API or integration test.
- **Fixture** and **Live** are ticked during a manual run in the Quest interface. Leave a box
  empty until it has been seen working.

### Account and workspace

| Feature                                             | Quest page   | Auto                              | Fixture | Live |
| --------------------------------------------------- | ------------ | --------------------------------- | ------- | ---- |
| Register, sign in, sign out                         | sign-in page | Q auth-brand; D                   | [ ]     | [ ]  |
| Home overview: hero, Coach, level/XP, waiting count | Home         | Q page render; Q agent-native; D  | [ ]     | [ ]  |
| Phone width without sideways scroll                 | all          | Q page render (7 pages); Q mobile | [ ]     | [ ]  |

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
| Capability levels with confidence and evidence             | Character  | I capability, coach                      | [ ]     | [ ]  |
| Evidence from GitHub, certificates, LinkedIn export, site  | Character  | I profile-sources                        | [ ]     | [ ]  |
| Evidence from Codeforces, Stack Overflow, LeetCode         | Character  | I profile-sources                        | [ ]     | [ ]  |

### Finding roles

| Feature                                      | Quest page  | Auto                       | Fixture | Live |
| -------------------------------------------- | ----------- | -------------------------- | ------- | ---- |
| Find roles uses profile search defaults      | Quests      | Q agent-native             | [ ]     | [ ]  |
| Save a role for later; tailor it later       | Quests      | D; I applications          | [ ]     | [ ]  |
| Role status and history across runs          | Quests      | D; I applications          | [ ]     | [ ]  |
| Coach next steps and refreshed advice        | Home, Coach | D; Q agent-native; I coach | [ ]     | [ ]  |
| Ranked jobs, compare, choose one             | Jobs        | Q journey; D               | [ ]     | [ ]  |
| Paste a job link into a reviewable candidate | Jobs        | Q agent-native; I job-link | [ ]     | [ ]  |
| Job availability check                       | Jobs        | I recruitment              | [ ]     | [ ]  |
| Fit and gap analysis                         | quest page  | I job-fit                  | [ ]     | [ ]  |
| World page: country rules                    | World       | Q page render              | [ ]     | [ ]  |
| Market insight by country and role family    | World       | I role-library             | [ ]     | [ ]  |
| Add a role from a link or pasted ad          | Quests      | I applications             | [ ]     | [ ]  |
| Practise interview with an approved resume   | Quests      | I applications             | [ ]     | [ ]  |
| One role across Find roles, Scout and board  | Quests      | I role-library             | [ ]     | [ ]  |

### Scout

| Feature                                                | Quest page | Auto                   | Fixture | Live |
| ------------------------------------------------------ | ---------- | ---------------------- | ------- | ---- |
| Settings: keywords, source tier, minimum score         | Scout      | I scout                | [ ]     | [ ]  |
| Manual sweep → roles on the board (discover-first)     | Scout      | I role-library         | [ ]     | [ ]  |
| Opt-in: one package per shortlisted role               | Scout      | Q Scout batch; I scout | [ ]     | [ ]  |
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
| Recruiter view: read-back, keywords, knock-outs   | My documents | I recruiter-check, applications                                      | [ ]     | [ ]  |
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
