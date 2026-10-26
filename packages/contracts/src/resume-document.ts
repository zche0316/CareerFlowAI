type DocumentClaim = { kind: string; text: string };

// Both the review preview and approved export use the same section order.
// Preserve claim wording and order within each section, including unfamiliar legacy kinds.
export function groupResumeClaims<T extends DocumentClaim>(claims: T[]) {
  const sections = [
    { kind: 'skill', title: 'Skills' },
    { kind: 'experience', title: 'Experience & projects' },
    { kind: 'education', title: 'Education' },
  ];
  const known = new Set(sections.map((section) => section.kind));
  return [
    ...sections.map((section) => ({
      ...section,
      claims: claims.filter((claim) => claim.kind === section.kind),
    })),
    {
      kind: 'other',
      title: 'Additional evidence',
      claims: claims.filter((claim) => !known.has(claim.kind)),
    },
  ].filter((section) => section.claims.length > 0);
}

export function approvedResumeText(content: {
  name: string;
  jobTitle: string;
  claims: DocumentClaim[];
}) {
  return [
    content.name,
    `Application target: ${content.jobTitle}`,
    ...groupResumeClaims(content.claims).flatMap((section) => [
      '',
      section.title.toUpperCase(),
      ...section.claims.map((claim) => `• ${claim.text}`),
    ]),
  ].join('\n');
}
