# Technology implementation and evidence

Prepared 30 October 2026. Explain each implementation and open its evidence; dependency counts alone do not establish benefit.

| Technology | Implemented purpose | Evidence to show | Limits |
|---|---|---|---|
| React/Vite | Stage-specific UI and reusable views | apps/web/src; workspace navigation and prototype browser tests; production build | No measured conversion or usability uplift |
| TypeScript and Zod | Shared contracts and rejection of invalid inputs/model output | packages/contracts; provider/router/domain tests; typecheck | Compile-time checks do not prove external data correctness |
| PostgreSQL/Prisma | Owned immutable versions and atomic decisions | apps/api/src/domain.ts; integration rollback, stale version and user-isolation cases | Portable PGlite is a single shared session, not production load evidence |
| LangGraph checkpoints | Pause for user selection/approval and resume a mission | packages/agents/src/workflow.ts; persistent checkpoint restart integration test | Not exactly-once remote model billing |
| pg-boss worker | Durable queued execution and recovery | apps/api/src/queue.ts; recovery, cancellation and expired-lease tests | A stopped server cannot keep processing |
| Official recruitment API adapters | Normalise sources, deduplicate and revalidate target | packages/recruitment; retrieval/timeout/removed-posting tests; observed Spaceship API response | Curated coverage; search index snippets are not verified vacancies |
| Structured LLM adapter | Bounded authorised context calls and validated results | packages/agents/src/provider.ts; provider tests; VALIDATION_20261030.md real Groq run | Fictional candidate/jobs in recorded live run; output quality still needs review |
| Playwright/GitHub Actions | Reproduce full user journeys from installed source | .github/workflows/ci.yml; latest branch run and artifacts | Passing automation is not team acceptance |
| PDF/DOCX pipeline | Searchable export from approved content | packages/documents; documents/resume-layout tests; rendered fictional QA sample | One-page visual QA does not prove every possible long resume |

## Quantitative evidence and how to present it

Historical quality measurements in QUALITY_CHECKS.md: workspace maximum 25.9 ms, draft save 45.8 ms, approved save 19.7 ms on the stated 22 October machine. These show that version met local budgets; do not report them as current speedups or concurrent capacity. VALIDATION_20261030.md records a real Groq journey test at 23.4 seconds; its dataset, model and scope are recorded there. This branch's focused suite passed 25 tests plus six original matching regressions. Use final CI for the full count.

For a new measurement, record commit, Node/database/model, fictional inputs, cold/warm conditions, repetitions, median/p95, errors and sample size. Only report a before/after improvement if both versions use the same setup. No unmeasured performance percentage is claimed here.

Matching quality has four targeted regression scenarios: unknown-vs-zero experience, explicit range/plus-year extraction, degree-level/false-positive handling, and Australian geography. This is correctness evidence on designed cases, not a representative ranking-accuracy benchmark. Use the retrieval-evaluation directory only within its stated synthetic-data scope.

## Demonstration prompts

Show a retained answer after failure, a rejected stale approval, a resumed checkpoint, a source limitation and a CI regression fix. Explain the practical value of each rather than listing technology names. The teaching team decides whether technologies are sufficiently distinct and integrated for the rubric.

## Matching measurement on this branch

`node scripts/measure-matching.mjs` performed 5 warm-ups and 30 measured runs per input size on Node 24.20.0, macOS arm64. Eight fictional jobs: median 0.519 ms, p95 0.735 ms. Eighty repeated fictional jobs: median 29.068 ms, p95 30.624 ms. Raw samples summary and algorithm hash: MATCHING_BENCHMARK_20261030.json. These measurements exclude retrieval, database, LLM, export and concurrency. The superlinear increase reflects repeated TF-IDF corpus work; do not use it to claim production scalability or a before/after speedup. It identifies a bounded prototype workload and a future optimisation target.
