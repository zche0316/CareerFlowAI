# Australian employer API check — 19 October 2026

Checked at 12:10 UTC (20:10 China time). The actual repository adapter returned 12 Australian jobs, before suitability filtering:

| Official board | Jobs |
| --- | ---: |
| Spaceship | 1 |
| VGW | 1 |
| GoFundMe | 1 |
| MongoDB | 9 |

Single-posting official API rechecks also confirmed publication for:

- [Spaceship — Product Builder, Sydney](https://job-boards.greenhouse.io/spaceship/jobs/8119027)
- [VGW — Software Engineer, Perth](https://job-boards.greenhouse.io/vgw/jobs/8862551002)
- [GoFundMe — IT Administrator I, Australia](https://job-boards.greenhouse.io/gofundme/jobs/8165225)
- [MongoDB — Principal Partner Specialist, Sydney](https://www.mongodb.com/careers/job/?gh_jid=8205437)

These are historical checks, not guarantees that links or vacancies remain available. The local machine report is `output/real-australia-check.json` (ignored by Git). The source adapter uses documented public endpoints: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board). Only GET requests were used; no applications were submitted.

28 tests passed: 22 domain/provider/recruitment/tools/resume unit tests and six original matching tests. New cases cover partial source outages, all-source failure, direct official link allowlists, closed/changed vacancies, failed availability checks and resume draft evidence preservation. TypeScript and production frontend build passed. PostgreSQL integration and full browser acceptance have not been run successfully in this environment.
