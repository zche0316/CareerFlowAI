import type { ResumeReturnTarget } from '../../../contracts/src/index.js';

export type { ResumeReturnTarget };

// Feedback addressed to one specialist. Critic notes may name a fact; human notes are free text.
export type TeamFeedback = {
  from: 'critic' | 'human';
  to: ResumeReturnTarget;
  message: string;
  factId?: string | null;
  code?: CritiqueIssue['code'];
};

export type RequirementCoverage = {
  term: string;
  level: 'required' | 'preferred';
  status: 'evidenced' | 'partial' | 'not_evidenced';
  factIds: string[];
};

export type GapReport = {
  version: 'resume-gap-v1';
  source: 'llm-mapping' | 'lexical';
  requirements: RequirementCoverage[];
  // Approved facts that support a job requirement, most important first.
  priorityFactIds: string[];
  // Requirements without approved evidence. These are never turned into claims.
  gaps: string[];
  // Requirement terms the user asked the team to focus on when returning a draft.
  userFocus: string[];
};

export type CritiqueIssue = {
  target: 'selector' | 'rewriter';
  code: 'UNGROUNDED' | 'WORDING_DRIFT' | 'MISSING_EVIDENCE' | 'REVIEWER_NOTE';
  message: string;
  factId: string | null;
};

export type Critique = {
  round: number;
  pass: boolean;
  reviewer: 'rules' | 'rules+model';
  issues: CritiqueIssue[];
  metrics: {
    requirementCoverage: number | null;
    // Requirements with approved evidence, out of all extracted requirements. Optional for critiques saved earlier.
    supportedRequirements?: number;
    totalRequirements?: number;
    keywordCoverage: number | null;
    rewrittenClaims: number;
    blockedRewrites: number;
  };
};

export type HumanOutcome =
  | { type: 'approved' }
  | { type: 'returned'; target: ResumeReturnTarget; message: string };
