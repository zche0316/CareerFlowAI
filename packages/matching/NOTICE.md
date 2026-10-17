# Member 3 source provenance

`domain.js`, `jobs.json`, `profile.json` and the baseline Node tests were imported from `CareerFlow_AI_Member3_CF20-CF23.zip`, supplied in the group's original CF-20 issue and copied to CFS-20 during Jira migration. The original baseline test import paths were adjusted for this repository layout; the matching domain algorithm and fictional fixture data were retained.

The new authenticated workflow uses only the pure matching function. The legacy file-backed persistence/orchestrator classes remain as baseline source for the original regression tests and are not exposed through the integrated API. Their old validation rules are not the new profile approval contract.

New integration adds owned, approved profile versions, durable mission context, real downstream workflows, exact-draft approval and cancellation/staleness guards. The fixture matching algorithm must not be represented as a remote LLM or live job search.
