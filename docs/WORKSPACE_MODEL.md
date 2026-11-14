# Workspace model: long-lived applications instead of one-shot missions

Jira: CFS-102 to CFS-117 · Status: implemented

## Problem

The group build models job hunting as a **mission**: one goal, one search, one chosen role, one
resume, one interview, then the mission ends. That was a fast way to demo the agents, but it does not
match how people look for work.

- A mission row holds everything at once: the goal, the search results, the chosen job, the resume
  team state, the interview, the application status (`Mission.data`).
- `ApprovedResume` hangs off `missionId`, not off the job it was written for.
- A second resume for the same role, or interview practice two weeks later, needs a new mission or a
  save-point branch, and the new mission does not know about the earlier one.
- Scout creates a mission per package; save points create a mission per branch. The application
  tracker rebuilds its list by scanning every mission, and two status systems exist
  (`optionalTools.status` and `applicationHistory`).
- The Career Coach runs inside a mission, so its advice is tied to one search.
- A mission is locked to the profile version it started with, so after the profile changes the
  user's job list is stuck in old missions.

## Target model

| Layer                                | Lives              | Holds                                                                                                                            |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                            | long               | the user                                                                                                                         |
| Profile                              | long, versioned    | the full evidence library (unchanged)                                                                                            |
| Career memory                        | long               | STAR stories and notes (unchanged)                                                                                               |
| **Application**                      | long, one per role | the job snapshot, where it came from, status and history, every run for this role                                                |
| **Run** (the existing `Mission` row) | short              | one agent workflow: find roles, or tailor a resume and practise the interview, with its budget, approvals, trace and save points |
| Coach                                | long               | reads the profile, all applications and memories; keeps the next actions                                                         |

A per-role resume is still made the same way: the resume team picks evidence from the approved
profile for that role's requirements and tightens it. What changes is where the result lives: on the
application, so every version and every practice round for that role stays together.

### What stays

The workflow engine is kept as it is: LangGraph graph, durable checkpoints, human gates, call budget,
save points, traces. A `Mission` row becomes a **run**. Its graph nodes already skip work that is
present (`career_coach` skips when `analysis` exists, `job_matching` when `matches` exist,
`select_job` when the job is preselected), so a run can start at the resume team for a known role.
No table is renamed; only the product language changes.

### Quest language

- **Quest** = one application (pursuing one role). The Quests page lists applications.
- **Run / battle** = one agent run inside that quest (resume team, interview).
- **Scout / Find roles** = searching; results land on the job board, not in a new quest.
- The party is still the agents.

## Data changes

```prisma
model Application {
  id          String   @id @default(uuid())
  userId      String
  fingerprint String   // jobFingerprint(job): same role found twice = same application
  job         Json     // job snapshot plus the latest match (score, requirements, gaps)
  source      String   // search | scout | link
  status      String   @default("saved") // saved | tailoring | ready | applied | interview | offer | rejected | closed
  history     Json     // [{ status, at, note? }]
  notes       String   @default("")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([userId, fingerprint])
}
// Mission: applicationId String? (+ index). ApprovedResume reaches its application through the run.
```

**Backfill** (idempotent, runs on first list per user): every mission with a `selectedJob` gets an
application by fingerprint and its `applicationId`; status comes from the latest of
`optionalTools.status`, `applicationHistory`, approved resume (`ready`) or run state (`tailoring`).
No mission data is deleted or rewritten.

## Flows

| Action                                | Before                       | After                                                                                        |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| Find roles                            | start a mission              | start a search run; the user saves roles to the board (`saved`) or starts tailoring one      |
| Choose a role in a search run         | `select_job` in that mission | same, and the run is linked to the role's application (created if new)                       |
| Tailor a resume for a saved role      | not possible                 | `POST /api/applications/:id/runs` starts a run at the resume team with the current profile   |
| Tailor again / after a profile update | branch a save point          | start another run on the same application                                                    |
| Scout package                         | new mission                  | new run on the role's application (`source: scout`)                                          |
| Record status                         | per mission, two places      | `PATCH /api/applications/:id` with history; the old mission endpoints write through          |
| Career advice                         | per mission                  | Coach page: latest analysis for the current profile, plus next actions from the applications |

## Delivery (one branch, one commit per phase, verify per phase)

1. **Data + API**: table, migration, backfill, linking on job choice / Scout / save points,
   `GET/PATCH /api/applications`, `POST /api/applications/:id/runs`, status write-through.
   _Done when_ integration tests show a role found twice gives one application, two runs on one
   application keep both resumes, and an old mission is backfilled.
2. **Quest UI**: Quests page lists applications (status, runs, resumes, next step); shortlist has
   "Save to board" next to "Select"; an application has "Tailor resume" / "Tailor again"; the
   start form becomes a Quest-styled "Find roles" form with plain source choices and the cost note;
   "mission" wording goes.
   _Done when_ the demo route e2e runs through the new pages and the full e2e suite passes.
3. **Coach**: workspace-level Coach panel on Home: latest analysis for the current profile version,
   next actions derived from applications (saved but not tailored, ready but not applied, last
   interview feedback), and a button to refresh advice (one counted model call).
   _Done when_ a unit test covers the action rules and the panel shows in fixture mode.

Each phase: `verify:local` and the affected e2e specs; the full e2e suite and one live smoke at the end.

## Out of scope now

Renaming the `Mission` table, deleting missions, automatic job applications, a model-run weekly plan
for the Coach (later issue), calendar sync.

## Role library (CFS-103)

- Identity is decided in layers (`resolveRole` in `apps/api/src/role-library.ts`):
  1. **Same posting**: same source and listing id (Greenhouse, Lever, Ashby, Adzuna, demo roles),
     or the same link once tracking parameters, fragment, `www.` and trailing slash are removed.
  2. **Same role on another board**: employer without legal suffixes, title with abbreviations
     spelled out and the city match, and the descriptions are alike (MinHash over word 3-grams,
     at least 0.6), or one side has no description, as a lead does. Same names with different
     descriptions are two openings and get separate identities.
  3. **Re-advertised**: a known role no search showed for 60 days. Off the board it is listed as
     new again; on the board its history gets a "Re-advertised" note and no resume team starts.
- A link or a date alone is not used: one role has a different link on each board, links carry
  tracking parameters, and most sources give no posting date.
- `TrackedJob` is the log of every role a search showed, from Scout sweeps and Find roles runs.
  `Application` holds the status of the roles the user pursues. Scout treats both as already seen,
  so it never lists a board role as new or starts a resume team on it.
- At startup `migrateRoleLibrary` resolves stored rows in creation order and merges rows that
  turn out to be the same role: runs move to the earlier application, histories combine and the furthest
  status wins. Each application records its provider mode; the board shows the current mode only.
- Shortlists and the Scout table mark roles already on the board; Scout can save a role it
  recorded.

## Per-role actions (CFS-104)

- `POST /api/applications` adds a role straight to the board from a public job link (at most one
  model call to read the page) or a pasted advertisement, scored against the current profile.
- `POST /api/applications/:id/practice` starts an interview-only run. It reuses the latest
  approved resume made for this role with the current profile when there is one, and otherwise
  works from the approved profile alone; the resume team is skipped. Practice and tailoring are
  independent: each can run beside the other, and only a second open run of the same kind is
  refused (CFS-134). The run page offers "Practise the interview now" next to the resume.
- `DELETE /api/applications/:id` removes a role with no runs. A role with runs and documents is
  archived by setting its status to Closed.
- Older runs stay tied to the profile version they used; their error messages point to the Quest
  log, where the role can be tailored again with the current profile.

## Cost and Coach (CFS-105)

- A Find roles run reuses career advice already prepared for the current profile version and
  mode (the workspace Coach's latest review, else an earlier run's analysis) instead of a new
  Career Coach call. A refinement with feedback still asks the Coach again.
- Scout is discover-first: a sweep scores new roles and puts the shortlist on the board as
  "New from Scout". Resume teams start only for roles the user tailors, or for every shortlisted
  role when "Also start a resume team" is switched on. A pasted lead still gets its package.
- The Find roles form offers the Coach's directions as goals.

## Capability levels (CFS-111)

`packages/contracts/src/capability.ts` gives each skill a level from approved data only:
0 no evidence · 1 aware (listed, or studied in a course) · 2 used (one project or role) ·
3 proficient (several projects or a delivered outcome, or a meaningful public repository) ·
4 advanced (over a year in roles, or external recognition). Confidence comes from the strongest
source (verified external evidence, STAR story, described record, listing); skills unused for
three years show one level lower. Role requirements are read as skill plus required level
(years, "strong", "familiarity" wording), and the gap drives role cards, the Coach and the
Character page. The Evidence Selector sees facts from records with a stated result first. There
is no overall score and no hiring prediction.

## Recruiter view (CFS-116)

`GET /api/resumes/:id/recruiter-check` (My documents → Recruiter view) reads an approved resume
the way screening systems and recruiters do: it re-reads the exported PDF (contact, sections,
dates, lines), checks required and preferred terms literally and by known synonym and whether they
appear in experience lines or only in the skills list, reads knock-out conditions (work rights,
location, years, degree) and shows level gaps. Results are a checklist with sub-scores, not a
pass probability. The employer's exact term is suggested only where an approved line already
names the same skill. Open-source references: Resume-Matcher (Apache-2.0) for keyword-gap ideas;
OpenResume's parser (AGPL-3.0) only as an outside readability reference, no code copied.

## Profile sources (CFS-112 to CFS-114)

`POST /api/profile-sources/:kind/preview` reads one public source and returns a proposal plus the
approved profile with the proposal merged in. Nothing is saved: the Character page shows the
proposal, and the user approves it as a new profile version through the normal draft flow.
Imported facts carry their source and whether they were verified (`verifiedEvidence`), which the
capability model uses for confidence and levels.

- GitHub (official REST API, optional server `GITHUB_TOKEN`): up to six recent non-fork public
  repositories become personal projects; languages, tests and CI become verified evidence. Each
  project also quotes up to five plain lines from its README (badges, code, links and set-up
  sections skipped; long paragraphs cut after the first sentence) and is dated by the user's own
  commits (latest 100). No model call; the user reviews the lines before approving (CFS-126).
  An import makes about four requests per repository, so without a token a second import in the
  same hour can reach GitHub's limit of 60 requests.
- Certificates: badge or verification links. An Open Badges assertion (most Credly badges) that
  can be fetched and has not expired is verified; others are skipped with a warning. Certificates
  join Education; named skills (AWS, Azure, Power BI, ...) get evidence at level 2, or 3 for
  professional, expert or specialty certificates.
- LinkedIn: no API scraping. The user uploads the official data export ZIP (or one CSV);
  positions, education, skills and certifications become a draft marked as self-reported.
- Personal website: one page, read only where robots.txt allows; each heading with text becomes
  a project draft, with known skills as technologies. No model call.
- Codeforces (official API): best rating and rated contests as Algorithms evidence (1900+ → 4,
  1400+ → 3, any rated contest → 2).
- Stack Overflow (official Stack Exchange API): answered top tags as per-skill evidence by answer
  score (100+ → 4, 20+ → 3, else 2).
- LeetCode (optional; no official API): the public profile is read when possible; otherwise the
  user's own solved count is added as self-reported (300+ → 3, 50+ → 2, else 1).

## Regional insight and positioning (CFS-115)

`GET /api/insights?country=&family=` (World page) counts, from the roles this user's searches and
Scout sweeps found in the current provider mode: roles per city, salary middle half from listings
that state one (yearly), visa sponsorship and citizen/PR-only counts, remote and hybrid counts, and
the most requested skills with example listings. It is a sample of what the searches found, not
the whole market. Role families: data, software, ML/AI, cloud/DevOps, product/business analysis.
The product is positioned as narrowing the information gap for technical roles across regions
(README, footer, demo pitch).

## Run route and Coach page (CFS-121)

- A run shows only its own steps (`apps/web/src/quest/run-route.ts`): a Find roles run has
  Shortlist, Review, Practice, Apply; a run on a saved or Scout role starts at Review; a practice
  run has Practice and Apply. The profile and career advice are workspace-level, so they are not
  run steps. Old links to the profile or analysis step open the run's first step.
- The Coach page (More → Coach, `/?view=coach`) shows the advice for the current profile version
  with the reason and cited evidence for each point. `POST /api/coach/refresh` takes an optional
  `feedback` text (what to revisit), which is passed to the Coach with the roles on the board.
  A run still reuses this advice when it needs it; it never asks the user to review it mid-run.

## Cost preview (CFS-124)

`GET /api/estimates` gives the expected model calls per kind of run (Find roles, tailoring,
practice, Coach refresh, Scout sweep), shown next to each start button. In live mode it is the
average and largest of the user's last five finished runs of that kind (calls and tokens from the
run, Coach review or sweep and its trace spans); with no finished run it shows a typical figure and
says so. Failed and unfinished runs are left out because they understate the cost. Rehearsal mode
says there is no model cost.

## Evidence questions during tailoring (CFS-123)

- After the Gap Analyzer, a run pauses once (`AWAITING_EVIDENCE`) when the role requires skills
  the approved profile has no evidence for: up to three, most important first. Skills the user
  already answered in an earlier run are not asked again.
- For each skill the user writes where and how they used it, optionally picks the experience or
  project, and ticks that it is true. Every answer is saved as a career memory: confirmed answers
  as `CONFIRMED`, the rest as `DRAFT` for later review. Skipping keeps the skill as a gap.
- Confirmed answers are snapshotted on the run (`evidenceAnswers`) as facts the team may cite: a
  line under the chosen record, or the skill alone. The Gap Analyzer runs again with them. The
  approved profile is not changed; a later run reuses a confirmed answer for the same skill
  without asking.
- Capability levels count confirmed answers as self-reported, unverified evidence: level 2 when
  tied to an experience, else 1.

## Listing re-checks (CFS-122)

- Saved, discovered, applied and interview roles are re-checked daily (06:30 Sydney, pg-boss) and
  from Quest log → Re-check listings, at most every 20 hours per role and 20 roles per run.
- Greenhouse, Lever and Ashby listings are asked again through their public APIs. Other roles are
  checked by opening their link where robots.txt allows; a page that still loads is reported as
  "link still opens", not as an open role. Demo roles are skipped.
- A gone listing (board says removed, or the link returns 404 or 410) closes a role the user has
  not applied to, with a history note. Applied and interview roles are only flagged on the card;
  their status and history are not changed. A check that cannot reach the source is reported and
  changes nothing.
- The last check is kept on the role (`listingCheck`) and shown on the board and in the Scout table.
- The Scout table offers Save only for roles whose full listing is kept (ranked by a search or seen
  in a sweep); a role a search showed without ranking it says so (CFS-128).

## Speech in interview practice (CFS-98, phase 1)

- "Speak your answer" dictates into the editable answer box with the browser's speech recognition;
  it starts only on a press and never submits. "Read aloud" speaks the question, the Evaluator's
  verdict and the final feedback with the browser's speech synthesis.
- No model cost and no server change: CareerFlow receives only the text the user submits and
  stores no audio. The browser's speech service may send audio to its vendor (Chrome does); the
  control says so. Controls are hidden where the browser lacks the APIs.
- Phase 2 (CFS-136): in live mode the interview offers "Start the voice interview".
  `POST /api/missions/:id/voice-session` asks OpenAI for a one-minute client secret
  (`/v1/realtime/client_secrets`, model `OPENAI_REALTIME_MODEL`, default `gpt-realtime-2.1`,
  input transcription and the `marin` voice) for a session that already carries the Panel's
  instructions and this run's questions; the server key never reaches the browser. The browser
  connects over WebRTC (`/v1/realtime/calls`; the page's CSP allows only that origin), the panel
  says "Question N" before each question so answers are filed under the right one, and on "End
  and score my answers" (or after 10 minutes, enforced in the browser) each answer's transcript is
  submitted as an interview round and scored by the Evaluator. At most three sessions per practice
  run; no audio is stored. The session first checks that the project can use the realtime and
  transcription models (`OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_TRANSCRIBE_MODEL`) and says which
  are missing (CFS-138).
- Recorded answers (CFS-139): in live mode "Record your answer" records one answer with
  MediaRecorder; `POST /api/missions/:id/transcribe` forwards the audio (up to 8 MB, 40 per run) to
  `/v1/audio/transcriptions` with `OPENAI_TRANSCRIBE_MODEL` (default `gpt-transcribe`) and returns
  the text into the editable answer box. The audio lives only in that request; the run keeps a
  count and the transcribed seconds. `GET /api/voice/status` (cached for an hour) tells the page
  which of the two voice features the project can use, so unavailable ones are hidden. Browser
  dictation stays for rehearsal mode.

## Party personas (CFS-132)

User-facing agents speak as named party members (`packages/agents/src/personas.ts`): the Profile
Builder (profile chat and polish), the Coach, the Panel (interview questions, scoring, feedback)
and the Rewriter (resume edits). Each instruction opens with the persona's voice and scope, never
claims to be ChatGPT or another product, keeps its instructions private, and answers off-topic or
role-changing messages in one in-character sentence before steering back. Free-text replies pass
through `guardIdentity`, which replaces a vendor self-description with the persona's introduction.
Personas shape tone only; evidence, schema and approval rules are unchanged. The Profile Builder
is on the Party page and its chat uses the party's avatars and Quest bubbles.

## Coach sources (CFS-125)

- Corpus: the O*NET 31.0 database (U.S. Department of Labor, CC BY 4.0): descriptions, up to six
  core tasks and up to ten software examples for computer and mathematical occupations and a few
  analyst, management and engineering roles. `npm run coach:sources` downloads three CSV files from
  onetcenter.org and writes `data/coach-sources/onet-31.json` with O*NET's attribution and a note
  that CareerFlow shortened the lists. No fine-tuning and no embeddings.
- Retrieval: BM25 over that file with the user's goal, skills, revisit request and the roles on
  the board; up to four passages go to the Coach as `publicSources`. Title, description and tasks
  count fully and the software list at one fifth; plurals are stemmed and a short synonym table
  maps posting titles (software engineer, DevOps, data or business analyst) to O*NET names
  (CFS-137). The built corpus has 46 occupations (see `data/coach-sources/README.md`).
- The Coach may add a source id (`onet:<code>`) to an item's evidence only after at least one
  approved fact ID; the server rejects any other unknown ID. Sources describe jobs, never the
  candidate. The Coach page links each cited source to O*NET OnLine and shows the attribution.
- Without the corpus file the Coach works as before. O*NET describes US occupations; regional
  requirements still come from the role library and World insight.

## Coach sources: ESCO and embedding retrieval (CFS-140, CFS-141)

- Two corpora: O*NET 31.0 (US; what the work involves, core tasks, software) and ESCO (EU, via
  its public API; descriptions, alternative names, essential skills; 102 ICT, data, analyst and
  ICT-technician occupations). Regional requirements still come from the role library and World
  insight, which use real postings.
- Retrieval: the Coach query is embedded (`text-embedding-3-small`, 512 dimensions; one small
  request, traced as "Coach sources") and compared with the committed document vectors; the BM25
  score adds a small bonus (0.1 of the normalised score) so exact job titles still count; at most
  three passages come from one source. Rehearsal mode, a missing key or vectors, or a failed
  request fall back to BM25.
- Measured on 22 labelled questions (12 with job titles, 10 plain-language or Chinese): right
  first occupation 19/22 with embeddings plus the bonus, 17/22 embeddings alone, 13/22 BM25 alone;
  BM25 found nothing for Chinese questions. Known gaps: no DevOps or machine-learning occupation in
  either source.
- Size: O*NET 61 KB, ESCO 112 KB, vectors 410 KB (148 documents); held in memory, no vector database.

## Walkthrough fixes: navigation, experience rank and plain wording (CFS-142)

Found by walking the app from a new account (see [USER_JOURNEY.md](USER_JOURNEY.md)).

- **Navigation.** The top bar keeps Home, Quests, Jobs, Scout and World; Coach, Party, Season
  event, Decision inbox, Applications and Activity sit under More. Pages about the user
  (Character, My profile, My documents) and Sign out moved under the avatar's Account menu.
- **Start from your resume.** Resume import is a top-level panel on the profile builder, open
  by default until a profile is approved, instead of nested inside the manual editor.
- **Finished runs** show what to do next: download the resume, apply on the employer's site,
  mark the role applied, practise again. A step notice is replaced when its run completes.
- **Experience rank** on the Character page: Rookie (under 1 year), Apprentice (1+), Adventurer
  (3+), Veteran (5+) and Legend (8+). It uses `experienceYears` from the approved profile, or
  else the months on work and volunteer records with overlaps counted once
  (`apps/web/src/quest/experience-rank.ts`). It is compared with the years stated by the
  latest ranked listings. XP and levels stay as the measure of activity in CareerFlow.
- **Wording.** Headings and hints say what the page is for in a few words; descriptions of how
  agents work moved out of the main path.
