# CareerFlow AI working conventions

- This checkout is the user's ELEC5620 group repository. Implement future improvements here; the older standalone prototype on port 8791 is a reference, not the working delivery target.
- On the long-term branch `feat/multi-agent-resume-team`, the Quest interface (`apps/web/src/quest/`, top pill navigation) is the default UI. The group's navy header and numbered 01–08 stage interface is the submitted baseline and stays available at `?classic=1`; keep both working until the Quest UI covers every flow. Preserve the group account system, PostgreSQL schemas, versioned approvals, durable missions and evidence-grounded resume workflow.
- Local startup: `npm run start:local`, or VS Code F5 → CareerFlow: database + app. Group UI: http://localhost:8787.
- Browser checks: `npm run test:e2e:local` starts a fixture-mode app on a disposable database (`.runtime/pglite-e2e`) and runs both Playwright projects (`classic` and `quest`). It needs ports 8787/55432 free (or set `PORT` and `LOCAL_DB_PORT`) and never touches `.runtime/pglite`.
- Full local checks: stop the app, then `npm run verify:local`. Portable mode uses one shared database connection; do not run another app/test process against that instance. Native PostgreSQL/Docker remain available for concurrent deployments.
- The user authorized progress comments on Jira CFS-41 after meaningful implementation/validation milestones. Report checks actually run, limitations and available evidence. Keep assignees and workflow status unchanged unless separately requested; do not claim reviews, submissions, commits or deployments that did not occur.

## Post-development issue workflow

- The user has accepted the current implementation as the completed development baseline. Track subsequent defects or requested fixes as separate Jira CFS issues rather than reopening the broad implementation task by default.
- For each reported problem: check for an existing issue, create or update an issue with reproduction steps and expected/actual behavior, link the fix branch/commit/PR with its issue key, and record the checks actually run before resolving it.
- Keep unrelated assignees and non-development deliverables unchanged. A development-complete status does not imply a PR was reviewed, merged, deployed, or submitted.

<!-- BEGIN AWS Agent Toolkit rules -->

# AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- For any AWS task or question — building, configuring, migrating, debugging,
  or operating a service, writing SDK code, authoring CDK/CloudFormation, or
  answering how a service works — first call `aws___search_documentation` with
  topic `agent_skills` and load the matching skill with `aws___retrieve_skill`.
  Do this even when you believe you know the answer: skills carry current
  service behavior that your training may not. Prefer the skill's guidance over
  general knowledge. Skip it only for work that does not involve AWS.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- Before reporting a count, a total, or that something does not exist, read
  every page of the results and search every Region and scope where it could
  be. If you could not, say the result is partial and name what you checked.
- To say what a system currently does, read what the runtime uses: the
  completed deployment, the alias or version that is invoked, the template the
  stack is running. A newer stored version, a draft, or a description field is
  not evidence of live behavior.
- Present a cause as confirmed only if data, configuration, or logs you read
  show it. Label anything else as unverified, and say what you would check
  next.
- When the user asks a specific question or names a suspected cause, confirm
  or rule out each cause they raised, and do not offer alternatives your evidence
  does not support.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

## Before you conclude

- Before deciding the AWS account can't hold what the request asks for,
  look. List the places it could live, such as S3 buckets, databases, and
  log groups, and read what is there.
- Don't conclude that records are missing from metadata, such as a
  creation date or a stored-bytes count, or from one query that failed or
  came back empty. Read the records another way, across the full time
  range, before reporting them absent.

## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END AWS Agent Toolkit rules -->
