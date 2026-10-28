import { generate, type Mode } from '../../../packages/agents/src/provider.js';
import {
  profileBuilderDraftSchema,
  blankProfile,
  type CareerProfile,
} from '../../../packages/contracts/src/index.js';

const builderFields = [
  'name',
  'goals',
  'skills',
  'interests',
  'education',
  'experience',
  'experienceYears',
  'location',
  'employmentType',
  'workArrangement',
  'companySize',
  'industry',
  'startDate',
  'endDate',
  'salaryMin',
  'salaryMax',
  'currency',
] as const;

type BuilderField = (typeof builderFields)[number];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalized = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const atomicValues = (value: unknown) => {
  if (Array.isArray(value)) return value.filter((item) => normalized(item));
  return normalized(value) ? [value] : [];
};

// Match actual values, not JSON keys or fragments of a different skill/number.
// For example JavaScript is not evidence of Java, and MySQL is not evidence of SQL.
const containsValue = (source: string, value: unknown) => {
  const text = normalized(source);
  const needle = normalized(value);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_+#])${escaped}(?![\\p{L}\\p{N}_+#])`, 'u').test(text);
};

// A mentioned skill/qualification can be explicitly absent or only a learning
// goal. Be conservative for these common cases; this is not a proof of truth.
const uncertainFact =
  /\b(?:no|not|never|without|lack|lacking|don't|doesn't|haven't|hasn't)\b|\b(?:want|hope|plan|aim|need|would like)\b[^.!?;]{0,80}\b(?:learn|study|gain|develop|obtain|earn|get)\b|\b(?:learning|studying|aspiring)\b/i;
const factualFields = new Set<BuilderField>([
  'skills',
  'education',
  'experience',
  'experienceYears',
]);

const supportsValue = (field: BuilderField, value: unknown, quote: string, sources: string[]) => {
  if (!containsValue(quote, value)) return false;
  if (!factualFields.has(field)) return true;
  return sources.some((source) =>
    source.split(/(?<=[.!?;])\s+|\n/).some((clause) => {
      if (!containsValue(clause, quote)) return false;
      if (!uncertainFact.test(clause)) return true;
      // Keeping an explicit statement such as "no work experience" verbatim is
      // safe; removing its qualifier to claim the qualification is not.
      return (
        ['education', 'experience'].includes(field) &&
        normalized(value).replace(/[.!?;]$/, '') === normalized(clause).replace(/[.!?;]$/, '')
      );
    }),
  );
};

const profileValues = (record: Record<string, unknown>) =>
  builderFields.flatMap((field) => atomicValues(record[field]).map(String));

const pickFields = (record: Record<string, unknown>) =>
  Object.fromEntries(
    builderFields
      .filter((field) => record[field] !== undefined)
      .map((field) => [field, record[field]]),
  );

const sharingValues = (value: unknown) =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      ([key, item]) => Object.hasOwn(blankProfile.sharing, key) && typeof item === 'boolean',
    ),
  );

/**
 * Prepare an editable draft without persisting or approving it.
 * Generated changes are applied only when the supplied quote and value are traceable to user input.
 */
export async function prepareProfileBuilderDraft(input: {
  notes: string;
  currentProfile?: unknown;
  existingProfile?: unknown;
  mode: Mode;
}) {
  const current = asRecord(input.currentProfile);
  const existing = asRecord(input.existingProfile);
  const base = {
    ...structuredClone(blankProfile),
    ...pickFields(existing),
    ...pickFields(current),
    sharing: {
      ...blankProfile.sharing,
      ...sharingValues(existing.sharing),
      ...sharingValues(current.sharing),
    },
  } as CareerProfile;
  const profileForModel = Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== 'sharing'),
  );
  const sources = [input.notes, ...profileValues(current), ...profileValues(existing)];
  const result = await generate(
    'profile',
    {
      goal: input.notes,
      facts: [],
      profileNotes: input.notes,
      profileBase: profileForModel,
    },
    profileBuilderDraftSchema,
    input.mode,
    {
      onCall: async () => {},
      onTool: async () => {},
      onUsage: async () => {},
    },
  );

  const prepared = { ...base } as Record<BuilderField | 'sharing', unknown>;
  const citedChanges = result.proposedChanges.filter((change) => {
    const evidence = normalized(change.evidence);
    return evidence.length > 0 && sources.some((source) => containsValue(source, evidence));
  });
  const discardedFields: BuilderField[] = [];

  for (const field of builderFields) {
    const proposed = result.draft[field];
    if (proposed === undefined || sameValue(proposed, base[field])) continue;
    const values = atomicValues(proposed);
    const quotes = citedChanges.filter((change) => change.field === field);
    if (
      values.length &&
      values.every((value) =>
        quotes.some((quote) => supportsValue(field, value, quote.evidence, sources)),
      )
    )
      prepared[field] = proposed;
    else discardedFields.push(field);
  }

  if (
    typeof prepared.startDate === 'string' &&
    typeof prepared.endDate === 'string' &&
    prepared.startDate &&
    prepared.endDate &&
    prepared.endDate < prepared.startDate
  ) {
    for (const field of ['startDate', 'endDate'] as const) {
      if (!sameValue(prepared[field], base[field])) discardedFields.push(field);
      prepared[field] = base[field];
    }
  }
  if (
    typeof prepared.salaryMin === 'number' &&
    typeof prepared.salaryMax === 'number' &&
    prepared.salaryMin > prepared.salaryMax
  ) {
    for (const field of ['salaryMin', 'salaryMax'] as const) {
      if (!sameValue(prepared[field], base[field])) discardedFields.push(field);
      prepared[field] = base[field];
    }
  }

  // Review metadata describes only changes that survived all checks. Never display
  // the model's unchecked proposedValue as if it were the actual editable value.
  const supportedChanges = citedChanges
    .filter(
      (change) =>
        !sameValue(prepared[change.field], base[change.field]) &&
        !discardedFields.includes(change.field) &&
        atomicValues(prepared[change.field]).some((value) =>
          supportsValue(change.field, value, change.evidence, sources),
        ),
    )
    .map((change) => ({
      ...change,
      proposedValue: Array.isArray(prepared[change.field])
        ? (prepared[change.field] as unknown[]).join(', ')
        : String(prepared[change.field]),
    }));
  return {
    data: prepared,
    followUpQuestions: result.followUpQuestions,
    proposedChanges: supportedChanges,
    discardedFields: [...new Set(discardedFields)],
  };
}
