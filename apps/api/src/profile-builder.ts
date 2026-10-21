import { generate, type Mode } from '../../../packages/agents/src/provider.js';
import {
  profileBuilderDraftSchema,
  sampleProfile,
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

const isSupportedValue = (value: unknown, evidenceText: string) =>
  atomicValues(value).every((item) => evidenceText.includes(normalized(item)));

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
    ...sampleProfile,
    ...existing,
    ...current,
    sharing: asRecord(current.sharing).coach !== undefined ? current.sharing : existing.sharing,
  } as Partial<CareerProfile>;
  const profileForModel = Object.fromEntries(
    Object.entries(base).filter(([key]) => key !== 'sharing'),
  );
  const evidenceText = normalized(input.notes + '\n' + JSON.stringify(profileForModel));
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
  const supportedChanges = result.proposedChanges.filter((change) => {
    const evidence = normalized(change.evidence);
    const proposed = result.draft[change.field];
    return (
      evidence.length > 0 &&
      evidenceText.includes(evidence) &&
      proposed !== undefined &&
      isSupportedValue(proposed, evidenceText)
    );
  });
  const supportedFields = new Set(supportedChanges.map((change) => change.field));
  const discardedFields: BuilderField[] = [];

  for (const field of builderFields) {
    const proposed = result.draft[field];
    if (proposed === undefined || sameValue(proposed, base[field])) continue;
    if (supportedFields.has(field)) prepared[field] = proposed;
    else discardedFields.push(field);
  }

  if (
    typeof prepared.startDate === 'string' &&
    typeof prepared.endDate === 'string' &&
    prepared.startDate &&
    prepared.endDate &&
    prepared.endDate < prepared.startDate
  ) {
    prepared.endDate = base.endDate;
    discardedFields.push('endDate');
  }
  if (
    typeof prepared.salaryMin === 'number' &&
    typeof prepared.salaryMax === 'number' &&
    prepared.salaryMin > prepared.salaryMax
  ) {
    prepared.salaryMax = base.salaryMax;
    discardedFields.push('salaryMax');
  }

  if (!prepared.sharing) prepared.sharing = sampleProfile.sharing;
  return {
    data: prepared,
    followUpQuestions: result.followUpQuestions,
    proposedChanges: supportedChanges,
    discardedFields: [...new Set(discardedFields)],
  };
}
