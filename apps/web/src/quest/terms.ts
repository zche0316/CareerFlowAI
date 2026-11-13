// Shared by Home and the character sheet, so Home does not pull in the whole sheet (CFS-129).
const acronyms = new Set([
  'sql',
  'aws',
  'bi',
  'api',
  'etl',
  'gcp',
  'ui',
  'ux',
  'ml',
  'ai',
  'kpi',
  'crm',
  'erp',
  'qa',
  'ci',
  'cd',
]);
// Requirement terms arrive lowercase from matching; restore conventional casing for display.
export const prettyTerm = (term: string) =>
  term
    .split(/(\s+|\/)/)
    .map((w) =>
      acronyms.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('');
