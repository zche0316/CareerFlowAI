import type { Fact } from '../../../contracts/src/index.js';
import type { GapReport } from './types.js';

// CFS-123: when a role requires a skill the approved profile has no evidence for, the run asks
// the user once. Confirmed answers become facts for this run only; skipped skills stay gaps.

export const MAX_EVIDENCE_QUESTIONS = 3;

export type EvidenceAnswer = {
  skill: string;
  text: string;
  recordId: string | null;
  memoryId: string;
};

/** Required skills with no approved evidence, most important first, at most three. */
export function gapSkills(report: GapReport | null | undefined) {
  return (report?.requirements || [])
    .filter((r) => r.level === 'required' && r.status === 'not_evidenced')
    .map((r) => r.term)
    .slice(0, MAX_EVIDENCE_QUESTIONS);
}

/**
 * Facts for confirmed answers. An answer placed on a profile record becomes a line under that
 * record; otherwise the skill joins the skills list. The user's own words are the fact text, so
 * the resume team may rephrase them but not add to them.
 */
export function evidenceFacts(answers: EvidenceAnswer[], facts: Fact[]): Fact[] {
  return answers.map((a) => {
    const header = a.recordId
      ? facts.find((f) => f.recordId === a.recordId && !f.recordHeaderId)
      : undefined;
    const source = 'Your confirmed answer while tailoring (career memory)';
    if (header)
      return {
        id: `answer-${a.memoryId}`,
        kind: header.kind,
        section: header.section,
        recordId: header.recordId,
        recordHeaderId: header.id,
        text: a.text,
        source,
        memoryEvidence: [{ memoryId: a.memoryId, revision: 1, quote: a.text }],
      };
    return {
      id: `answer-${a.memoryId}`,
      kind: 'skill',
      text: a.skill,
      source,
      memoryEvidence: [{ memoryId: a.memoryId, revision: 1, quote: a.text }],
    };
  });
}

/** Marks the requirements a confirmed answer covers as evidenced by that answer's fact. */
export function markAnswered(
  report: GapReport,
  evidence: { answers?: EvidenceAnswer[]; facts?: Fact[] } | undefined,
) {
  const answers = evidence?.answers || [];
  if (!answers.length) return report;
  for (const r of report.requirements) {
    if (r.status !== 'not_evidenced') continue;
    const a = answers.find((x) => x.skill.toLowerCase() === r.term.toLowerCase());
    const fact = a && (evidence?.facts || []).find((f) => f.id === `answer-${a.memoryId}`);
    if (fact) {
      r.status = 'evidenced';
      r.factIds = [fact.id];
    }
  }
  report.gaps = report.requirements.filter((r) => r.status === 'not_evidenced').map((r) => r.term);
  report.priorityFactIds = [
    ...new Set(
      report.requirements.filter((r) => r.status !== 'not_evidenced').flatMap((r) => r.factIds),
    ),
  ];
  return report;
}
