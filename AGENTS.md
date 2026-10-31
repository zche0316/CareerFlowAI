# CareerFlow AI working conventions

- This checkout is the user's ELEC5620 group repository. Implement future improvements here; the older standalone prototype on port 8791 is a reference, not the working delivery target.
- Use the navy header and numbered 01–08 stage interface as the UI baseline. Preserve the group account system, PostgreSQL schemas, versioned approvals, durable missions and evidence-grounded resume workflow.
- Local startup: `npm run start:local`, or VS Code F5 → CareerFlow: database + app. Group UI: http://localhost:8787.
- Full local checks: stop the app, then `npm run verify:local`. Portable mode uses one shared database connection; do not run another app/test process against that instance. Native PostgreSQL/Docker remain available for concurrent deployments.
- The user authorized progress comments on Jira CFS-41 after meaningful implementation/validation milestones. Report checks actually run, limitations and available evidence. Keep assignees and workflow status unchanged unless separately requested; do not claim reviews, submissions, commits or deployments that did not occur.

## Post-development issue workflow

- The user has accepted the current implementation as the completed development baseline. Track subsequent defects or requested fixes as separate Jira CFS issues rather than reopening the broad implementation task by default.
- For each reported problem: check for an existing issue, create or update an issue with reproduction steps and expected/actual behavior, link the fix branch/commit/PR with its issue key, and record the checks actually run before resolving it.
- Keep unrelated assignees and non-development deliverables unchanged. A development-complete status does not imply a PR was reviewed, merged, deployed, or submitted.
