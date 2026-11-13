/** Lightweight authenticity checks, not a semantic fact verifier.
 * Wording and omissions are free; new measurable claims and obvious inflation are not.
 * Profile evidence extraction continues to use the stricter checkWording rule.
 */
export function checkResumeWording(source: string, proposed: string) {
  const normal = (s: string) =>
    s
      .normalize('NFKC')
      .replace(/[’']/g, "'")
      .replace(/\b(?:didn't|doesn't|don't|wasn't|weren't|isn't|aren't|haven't|hasn't)\b/gi, 'not');
  const before = normal(source),
    after = normal(proposed);
  const numbers = (s: string) =>
    new Set((s.match(/\d+(?:[.,]\d+)*(?:%|\+)?/g) || []).map((n) => n.replace(/,/g, '')));
  const known = numbers(before);
  if ([...numbers(after)].some((n) => !known.has(n)))
    return 'Use only numbers and dates supported by the approved source.';

  const newTerms = (pattern: RegExp) => {
    const key = (term: string) => term.toLowerCase().replace(/\s+/g, '');
    const allowed = new Set((before.match(pattern) || []).map(key));
    return (after.match(pattern) || []).some((term) => !allowed.has(key(term)));
  };
  if (newTerms(/[$£€]|\b(?:million|billion|percent|percentage|revenue|profit)\b/gi))
    return 'Do not add unsupported financial results, amounts or percentages.';
  if (
    newTerms(
      /\b(?:AWS|Azure|GCP|Kubernetes|Docker|Terraform|Salesforce|Tableau|Power\s*BI|SQL|Python|JavaScript|TypeScript|Java|React|Excel|Git)\b/gi,
    )
  )
    return 'Do not add a technology that is not supported by this source.';
  if (
    newTerms(
      /\b(?:PhD|doctorate|MBA|master'?s|certified|certification|senior|principal|director)\b/gi,
    )
  )
    return 'Do not add unsupported qualifications or seniority.';

  // A denied action in the source (e.g. "did not lead") is not permission to claim it.
  const positive = (text: string, expression: string) =>
    [...text.matchAll(new RegExp(expression, 'gi'))].some((m) => {
      const prefix =
        text
          .slice(0, m.index)
          .split(/[.!?;\n]/)
          .at(-1) || '';
      return !/\b(?:not|never|no)\b[^.!?;]{0,80}$/i.test(prefix);
    });
  const leadership = '\\b(?:led|lead|leading|managed|supervised|headed|directed|owned)\\b';
  if (positive(after, leadership) && !positive(before, leadership))
    return 'Keep your actual contribution; do not turn support work into leadership.';
  const organisation = '\\b(?:company-wide|organisation-wide|organization-wide)\\b';
  if (positive(after, organisation) && !positive(before, organisation))
    return 'Do not turn a limited or team result into a company-wide result.';
  if (
    /\b(?:our team|team-level|team estimated)\b/i.test(before) &&
    /\bI\s+(?:personally\s+)?(?:reduced|cut|saved|increased|achieved|generated)\b/i.test(after) &&
    !/\bI\s+(?:personally\s+)?(?:reduced|cut|saved|increased|achieved|generated)\b/i.test(before)
  )
    return 'Keep team outcomes separate from your personal contribution.';
  return null;
}
