# Agile demonstration preparation

Evidence check: 30 October 2026. The team member confirmed no Sprint review or retrospective has taken place. This file is preparation and an evidence index, not completed minutes.

## Actual feedback and delivery

On 30 October Aitong Lyu and Zun Chen discussed simplifying the UI so it was easier to operate and explain. Aitong delivered the focused change in PR #8. The final checks passed and Zun Chen merged it at 03:46 UTC (11:46 Asia/Shanghai). CFS-10 and CFS-66 record the discussion and delivered update. This is one real feedback loop, not evidence that a full Sprint ceremony occurred.

Current Jira readback: Sprint 1 and Sprint 2 are closed; Sprint 3 is active. Sprint 2 metadata currently shows the 23–29 October window and a late activation explanation. Closure was recorded on 30 October. Those metadata do not establish that a review or retrospective occurred. CFS-51 Done; CFS-46/47/48/49/52/53/54 require their actual activity/evidence. Status alone does not prove attendance or acceptance. CFS-49 comments distinguish owner feedback and proposed improvements from a team retrospective.

## Open during the demonstration

1. Backlog: select one delivered user story, show its user outcome, acceptance criteria, PR and passing tests.
2. Sprint board: show planned versus added/carried scope using actual Jira history.
3. Burndown report: select the real board/Sprint and estimation unit. Explain what the remaining-work axis means. If estimates were added late or tasks closed together during reconciliation, say so; a steep drop is not proof all coding happened that day. Do not redraw history or edit estimates to improve appearance.
4. Feedback: show the UI discussion → CFS-66 → PR #8 → test fixes → passing result → team-lead merge.
5. Review and retrospective: show actual minutes only after the team holds them.

The native Sprint burndown report was opened on 30 October with Story points selected. Sprint 2 shows a late rise and concentrated fall, with nonzero remaining work; its scope log records many estimates added on 28 October and CFS-50 removed on 29 October. This is not evidence of zero prior work or even daily throughput. Sprint 3 shows scope increases and work carried/added, including CFS-66–69 and review/retro items. Its completed section showed CFS-52 and CFS-67; CFS-38 appeared under completed outside sprint. This is a time-specific readback, not a velocity calculation or acceptance claim.

Report: https://careerflow-elec5620-group2.atlassian.net/jira/software/projects/CFS/boards/2/reports/burndown?source=overview

Local screenshots are under output/release-review/sprint2-burndown.png and sprint3-burndown.png. Open the native report during the demo because the active sprint continues changing. Do not reconstruct an authoritative burndown from current issue status rows.

Suggested explanation: The red line is remaining story points, and the grey line is the ideal guideline. Our late estimate entry and concentrated board reconciliation explain the sharp changes. Scope additions and carried work are visible in the log. These figures reflect Jira events and provisional estimates, rather than a precise daily measure of engineering effort.

## Ready-to-use meeting agenda (not minutes)

Hold a short review: record actual date, attendees and source revision; demonstrate profile → job → approved export → interview; inspect a failure/retry case; record accepted scope and concrete feedback.

Then hold a retrospective: discuss one thing that helped and one problem supported by evidence. Agree one improvement, an owner and a checkpoint. Suggested discussion: review whole user journeys before changing a single assertion, and freeze a single release revision for each acceptance run. Do not pre-record agreement. At the checkpoint record what actually happened and whether it helped.

Complete after the meeting:

- Actual date and participants:
- Demonstrated commit and linked issues:
- Accepted scope and observed issues:
- Feedback and decision:
- Agreed improvement, owner and checkpoint:
- Follow-up result:

## Short spoken explanation

We organised work into user stories and iterations. One concrete feedback loop was the UI review with the team lead: we simplified navigation, verified the connected journey and submitted a PR that was merged after checks passed. Our chart must be interpreted with the actual estimation and transition history. We will distinguish completed team activities from preparation materials.
