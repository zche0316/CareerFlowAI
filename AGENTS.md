# CareerFlow AI working conventions

- This checkout is the user's ELEC5620 group repository. Implement future improvements here; the older standalone prototype on port 8791 is a reference, not the working delivery target.
- Use the navy header and numbered 01–08 stage interface as the UI baseline. Preserve the group account system, PostgreSQL schemas, versioned approvals, durable missions and evidence-grounded resume workflow.
- Discuss work with the user in Chinese. Keep application UI, Jira records, code comments, commit/PR text and newly authored project documentation in English. Preserve historical team content unless an edit is requested.
- Local startup: `npm run start:local`, or VS Code F5 → CareerFlow: database + app. Group UI: http://localhost:8787.
- Full local checks: stop the app, then `npm run verify:local`. Portable mode uses one shared database connection; do not run another app/test process against that instance. Native PostgreSQL/Docker remain available for concurrent deployments.
- The user authorized progress comments on Jira CFS-41 after meaningful implementation/validation milestones. Report checks actually run, limitations and available evidence. Keep assignees and workflow status unchanged unless separately requested; do not claim reviews, submissions, commits or deployments that did not occur.
- Preserve contribution evidence on the relevant CFS issues, with an integration index on CFS-41 when useful. Attribute only the actual increment, disclose AI assistance, link commits and real verification results, and distinguish proposals from implemented or accepted work.
