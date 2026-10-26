import { describe, expect, it } from 'vitest';
import {
  approvedResumeText,
  groupResumeClaims,
} from '../packages/contracts/src/resume-document.js';

describe('Approved resume presentation', () => {
  it('groups mixed evidence without rewriting, dropping or mutating any claim', () => {
    const claims = [
      { factId: 'exp-1', kind: 'experience', text: 'Built a reviewed SQL reporting project.' },
      { factId: 'skill-1', kind: 'skill', text: 'SQL' },
      { factId: 'education-1', kind: 'education', text: 'Bachelor of Information Technology' },
      { factId: 'exp-2', kind: 'experience', text: 'Documented a sample dataset.' },
      { factId: 'legacy-1', kind: 'legacy', text: 'A retained historical fact.' },
    ];
    const before = structuredClone(claims);
    const sections = groupResumeClaims(claims);
    expect(sections.map((section) => section.title)).toEqual([
      'Skills',
      'Experience & projects',
      'Education',
      'Additional evidence',
    ]);
    expect(sections[1].claims.map((claim) => claim.factId)).toEqual(['exp-1', 'exp-2']);
    expect(
      sections
        .flatMap((section) => section.claims)
        .map((claim) => claim.factId)
        .sort(),
    ).toEqual(claims.map((claim) => claim.factId).sort());
    expect(claims).toEqual(before);
  });

  it('exports the same grouped factual content without inventing candidate information', () => {
    const text = approvedResumeText({
      name: 'Fictional QA Candidate',
      jobTitle: 'Analyst',
      claims: [
        { kind: 'education', text: 'Supplied education' },
        { kind: 'skill', text: 'SQL' },
        { kind: 'experience', text: 'A supplied student project.' },
      ],
    });
    expect(text).toBe(
      'Fictional QA Candidate\nApplication target: Analyst\n\nSKILLS\n• SQL\n\nEXPERIENCE & PROJECTS\n• A supplied student project.\n\nEDUCATION\n• Supplied education',
    );
    expect(text).not.toMatch(/@|phone|years of experience/i);
  });
});
