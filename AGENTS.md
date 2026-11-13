# CareerFlow AI working conventions

## Product and code

- This checkout is the CareerFlow repository, started as the ELEC5620 group project and now developed on its own. The product: find technical roles across regions, show what each region asks for, rate capability per skill from approved evidence, and tailor an evidence-grounded resume per role. Applying stays manual.
- The Quest interface (`apps/web/src/quest/`, top pill navigation) is the only UI. Build new pages there.
- Keep the core guarantees: versioned profile approvals, facts only from approved data, human gates bound to the exact version shown, durable runs, owner scoping on every query. See `docs/architecture.md` and `docs/WORKSPACE_MODEL.md`.
- Every API route has a row in `docs/API.md` (`tests/api-docs.test.ts` enforces it). Add design notes for a new feature to `docs/WORKSPACE_MODEL.md`.

## Running and checking

- Local startup: `npm run start:local`, or VS Code F5 → CareerFlow: database + app. UI: http://localhost:8787. `npm run demo:account` creates a ready account.
- Portable mode uses one shared database connection: one app process per database. For a second instance use other ports (`PORT`, `LOCAL_DB_PORT`) and another `LOCAL_DB_DIR`; never touch the user's `.runtime/pglite`.
- Test routine (keep it light):
  - While iterating: `npm run verify:quick` and the one or two browser specs for the page you changed: `npm run test:e2e:local -- tests/e2e/<spec>.spec.ts --reporter=line`.
  - Before pushing, with the app stopped: `npm run verify:local` once and `npm run test:e2e:smoke`. Run the full browser suite locally only when a change touches shared navigation, the start form or many pages.
  - CI runs the full checks and every browser spec in parallel on each pull request; it is the full gate. Report only summary lines of test output.
- Live mode costs money: use it for a planned validation run on a separate database, and record the numbers.

## Jira and Git

- Every change starts from a Jira CFS issue (check for an existing one first). Bugs get reproduction steps and expected and actual behaviour.
- One commit per issue, with the issue key in the commit message and branch (`feat/CFS-123-...`). Do not squash a batch into one commit.
- Commit locally until a module or feature is complete, then push once and open a pull request. Batch later changes into one push.
- Commit messages: `feat:`/`fix:`/`docs:`/`test:`/`chore:`/`ci:` prefix; one line for a small change, dot points otherwise; no AI or co-author lines.
- After meaningful milestones, comment on the issue with the commit or PR, the checks actually run and any limitations. Keep assignees and workflow status unchanged unless asked; never claim reviews, merges or deployments that did not happen.
- Do not watch passing CI; act when a run fails. `main` accepts changes only through pull requests.

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
