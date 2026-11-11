# Workspace model: long-lived applications instead of one-shot missions

Jira: CFS-102 · Status: in development

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

| Layer | Lives | Holds |
|---|---|---|
| Workspace | long | the user |
| Profile | long, versioned | the full evidence library (unchanged) |
| Career memory | long | STAR stories and notes (unchanged) |
| **Application** | long, one per role | the job snapshot, where it came from, status and history, every run for this role |
| **Run** (the existing `Mission` row) | short | one agent workflow: find roles, or tailor a resume and practise the interview, with its budget, approvals, trace and save points |
| Coach | long | reads the profile, all applications and memories; keeps the next actions |

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

| Action | Before | After |
|---|---|---|
| Find roles | start a mission | start a search run; the user saves roles to the board (`saved`) or starts tailoring one |
| Choose a role in a search run | `select_job` in that mission | same, and the run is linked to the role's application (created if new) |
| Tailor a resume for a saved role | not possible | `POST /api/applications/:id/runs` starts a run at the resume team with the current profile |
| Tailor again / after a profile update | branch a save point | start another run on the same application |
| Scout package | new mission | new run on the role's application (`source: scout`) |
| Record status | per mission, two places | `PATCH /api/applications/:id` with history; the old mission endpoints write through |
| Career advice | per mission | Coach page: latest analysis for the current profile, plus next actions from the applications |

## Delivery (one branch, one commit per phase, verify per phase)

1. **Data + API**: table, migration, backfill, linking on job choice / Scout / save points,
   `GET/PATCH /api/applications`, `POST /api/applications/:id/runs`, status write-through.
   *Done when* integration tests show a role found twice gives one application, two runs on one
   application keep both resumes, and an old mission is backfilled.
2. **Quest UI**: Quests page lists applications (status, runs, resumes, next step); shortlist has
   "Save to board" next to "Select"; an application has "Tailor resume" / "Tailor again"; the
   start form becomes a Quest-styled "Find roles" form with plain source choices and the cost note;
   "mission" wording goes.
   *Done when* the demo route e2e runs through the new pages and the full e2e suite passes.
3. **Coach**: workspace-level Coach panel on Home: latest analysis for the current profile version,
   next actions derived from applications (saved but not tailored, ready but not applied, last
   interview feedback), and a button to refresh advice (one counted model call).
   *Done when* a unit test covers the action rules and the panel shows in fixture mode.

Each phase: `verify:local` and the affected e2e specs; the full e2e suite and one live smoke at the end.

## Out of scope now

Renaming the `Mission` table, deleting missions, automatic job applications, a model-run weekly plan
for the Coach (later issue), calendar sync.
