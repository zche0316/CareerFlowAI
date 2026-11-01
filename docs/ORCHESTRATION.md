# Orchestration, request lifecycle and profile handoff

This document records the implementation and verification contract for CFS-37 and CFS-14.

## Request identity

Every HTTP response carries `X-Request-ID`. A caller-supplied ID is reused only when it matches
`[A-Za-z0-9._:-]{1,100}`; otherwise the API generates a UUID. JSON error responses include the same
ID as `requestId`, so a user-facing failure can be correlated with server activity without exposing
internals.

The request ID is transport-level correlation. The mission UUID is the durable workflow identity.

## Mission lifecycle

```text
QUEUED
  -> RUNNING
  -> AWAITING_JOB
  -> RUNNING
  -> AWAITING_APPROVAL
  -> RUNNING
  -> AWAITING_INTERVIEW
  -> RUNNING
  -> COMPLETE
```

Recoverable failures enter `FAILED` and may be retried. Cancellation enters `CANCELLED`. Profile
replacement marks unfinished work `STALE`. An empty ranked result enters `NO_MATCHES`.

Each human decision is accepted only at its corresponding status. PostgreSQL row locks, worker
leases and current-profile-version checks reject stale, cancelled or superseded results before a
late write can commit.

## Approved profile handoff

The downstream context is built from the mission's pinned `Profile` row and its persisted facts:

1. A profile draft records the user's current profile version as `baseVersion`.
2. Approval uses compare-and-increment and appends a new immutable profile version.
3. A mission records the approved `profileId`, never draft content.
4. Each workflow step rechecks the owner's current profile version before proceeding.
5. Pending or discarded drafts are never exposed as downstream context.
6. A profile replacement marks unfinished missions stale while preserving historical approved data.
7. Starting a mission grants all five specialists access to its approved-profile snapshot. Legacy
   sharing fields remain stored for compatibility; users do not need to toggle four specialist switches.

## UI and provider boundary

The React client renders persisted mission data and submits user actions. It does not call the model,
choose lifecycle transitions or construct candidate evidence. LangGraph and the API own provider
invocation, context filtering, structured validation, usage accounting and durable checkpoints.

## Verification map

| Requirement                                     | Verification                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Stable request ID and lifecycle status          | `propagates request IDs and meets local load/save latency budgets`                     |
| Full UC1–UC5 handoff                            | `completes the profile → career → job → approved resume → interview journey`           |
| Only approved profile reaches downstream agents | `hands only the approved, permitted profile to downstream agents`                      |
| Missing data correction                         | profile schema and missing-profile integration tests                                   |
| Failed save preserves prior version             | `rolls back a failed profile approval and preserves the previous approved version`     |
| Cancelled edit does not replace approved data   | `preserves approved profile versions while isolating, discarding and filtering drafts` |
| Stale/cancelled late results are rejected       | stale-profile and cancellation-race integration tests                                  |
| No duplicate provider logic in UI               | source boundary documented in `docs/API.md`                                            |


## Live job requirement mapping

Live missions use `packages/agents/src/job-mapping.ts`: a generic lexical shortlist (up to 12 jobs, two concurrent requests) is reviewed by the configured LLM. There is no skill vocabulary in this extraction path. Requirements retain exact job excerpts, required/preferred classification, category, evidence/partial/missing status, and approved fact IDs with exact quotations. Goals cannot establish qualifications; coursework cannot establish professional proficiency. Numeric years require an explicit source number, not an inference from a senior title. Semantic mapping remains advisory and its citations require user review.

Code calculates the score: 50% required capability/responsibility/seniority, 10% preferred requirements, 20% experience expectations, 10% education, 10% location preference. Evidenced/partial/missing receives 1/0.5/0. Unknown categories are unscored and excluded from the denominator; coverage shows how much policy weight was assessed. No extracted requirements yields zero, not a positive location-only recommendation. Job minimum years can remain unknown while a stated qualitative experience requirement is still mapped to approved records; the default profile year field is not silently treated as a proven zero-year history.

Mappings are cached by profile version and job content within the mission, and calls use the existing cancellation, budget and usage hooks. Provider or grounding failure stops the step; there is no silent dictionary or fixture replacement. Retrieval coverage discloses unreviewed jobs beyond the shortlist. Saved older results retain their original algorithm; new live missions use `llm-evidence-v1`. Deterministic fixture missions and the original matching package remain the disclosed rule-based regression baseline.
