import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blankProfile,
  profileBuilderDraftSchema,
  sampleProfile,
} from '../packages/contracts/src/index.js';
import { generate } from '../packages/agents/src/provider.js';
import {
  prepareProfileBuilderDraft,
  citeExactUserValues,
} from '../apps/api/src/profile-builder.js';

vi.mock('../packages/agents/src/provider.js', () => ({ generate: vi.fn() }));

function output(
  draft: Record<string, unknown> = {},
  proposedChanges: { field: string; proposedValue: string; evidence: string }[] = [],
) {
  return profileBuilderDraftSchema.parse({
    draft,
    proposedChanges,
    followUpQuestions: ['What is your career goal?'],
  });
}

beforeEach(() => {
  vi.mocked(generate).mockReset();
});

describe('UC1 evidence-grounded Profile Builder', () => {
  it('grounds mixed Chinese and English goals and retains supported skills independently', async () => {
    const notes =
      '我正在寻找悉尼的 Graduate Business Analyst 岗位。\n我的优势是结构化思考、Excel 和 SQL、沟通协调。';
    const result = await prepareProfileBuilderDraft({
      notes,
      mode: 'fixture',
      preparedResult: citeExactUserValues(
        output({
          goals: 'Graduate Business Analyst in Sydney',
          skills: ['Excel', 'SQL', 'Stakeholder management'],
          location: '悉尼',
        }),
        [notes],
      ),
    });
    expect(result.data.goals).toBe('我正在寻找悉尼的 Graduate Business Analyst 岗位。');
    expect(result.data.skills).toEqual(['Excel', 'SQL']);
    expect(result.data.location).toBe('悉尼');
  });
  it('starts notes-only users without fictional facts or implicit data sharing', async () => {
    vi.mocked(generate).mockResolvedValue(output());
    const result = await prepareProfileBuilderDraft({
      notes: 'I want to discuss my next career step.',
      mode: 'fixture',
    });
    expect(result.data).toEqual(blankProfile);
    expect(result.data.name).not.toBe(sampleProfile.name);
    expect(result.followUpQuestions).toEqual(['What is your career goal?']);
    expect(Object.values(result.data.sharing as object)).toEqual([true, true, true, true]);
    expect(vi.mocked(generate).mock.calls[0][1].profileBase).not.toHaveProperty('sharing');
  });

  it('keeps manual edits and sharing controls without mutating supplied data', async () => {
    const original = structuredClone(sampleProfile);
    const current = {
      ...original,
      education: '',
      sharing: { coach: false, matching: true, resume: false, interview: false },
    };
    vi.mocked(generate).mockResolvedValue(
      output({ location: 'Melbourne' }, [
        { field: 'location', proposedValue: 'An unchecked label', evidence: 'I prefer Melbourne' },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'I prefer Melbourne for my next job.',
      currentProfile: current,
      existingProfile: original,
      mode: 'fixture',
    });
    expect(result.data.education).toBe('');
    expect(result.data.location).toBe('Melbourne');
    expect(result.data.sharing).toEqual(current.sharing);
    expect(result.proposedChanges).toEqual([
      { field: 'location', proposedValue: 'Melbourne', evidence: 'I prefer Melbourne' },
    ]);
    expect(original).toEqual(sampleProfile);
    expect(current.location).toBe('Sydney');
  });

  it('accepts exact user-supported skills and shows their actual editable values', async () => {
    const evidence = 'I use JavaScript, SQL and C++';
    vi.mocked(generate).mockResolvedValue(
      output({ skills: ['JavaScript', 'SQL', 'C++'] }, [
        { field: 'skills', proposedValue: 'Something different', evidence },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: evidence + ' in my project.',
      mode: 'fixture',
    });
    expect(result.data.skills).toEqual(['JavaScript', 'SQL', 'C++']);
    expect(result.proposedChanges[0].proposedValue).toBe('JavaScript, SQL, C++');
  });

  it.each([
    ['JavaScript', 'Java'],
    ['MySQL', 'SQL'],
    ['C++', 'C'],
  ])('does not infer %s as evidence of the different skill %s', async (source, invented) => {
    const evidence = `I use ${source}`;
    vi.mocked(generate).mockResolvedValue(
      output({ skills: [invented] }, [{ field: 'skills', proposedValue: invented, evidence }]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: evidence + ' in a project.',
      mode: 'fixture',
    });
    expect(result.data.skills).toEqual([]);
    expect(result.discardedFields).toContain('skills');
    expect(result.proposedChanges).toEqual([]);
  });

  it('does not turn serialized schema keys into candidate evidence', async () => {
    vi.mocked(generate).mockResolvedValue(
      output({ skills: ['goals'] }, [
        { field: 'skills', proposedValue: 'goals', evidence: 'goals' },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'Please help organise my career information.',
      mode: 'fixture',
    });
    expect(result.data.skills).toEqual([]);
    expect(result.discardedFields).toContain('skills');
  });

  it('requires the cited quote to support the proposed value, not just occur elsewhere', async () => {
    vi.mocked(generate).mockResolvedValue(
      output({ skills: ['Python'] }, [
        { field: 'skills', proposedValue: 'Python', evidence: 'I live in Sydney' },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'I use Python. I live in Sydney.',
      mode: 'fixture',
    });
    expect(result.data.skills).toEqual([]);
    expect(result.proposedChanges).toEqual([]);
  });

  it('does not read part of a number as years of experience', async () => {
    vi.mocked(generate).mockResolvedValue(
      output({ experienceYears: 2 }, [
        { field: 'experienceYears', proposedValue: '2', evidence: 'I have 20 years of experience' },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'I have 20 years of experience.',
      mode: 'fixture',
    });
    expect(result.data.experienceYears).toBe(0);
    expect(result.discardedFields).toContain('experienceYears');
  });

  it.each([
    ['I have no AWS certification.', 'AWS certification', 'I have no AWS certification.'],
    ['I want to learn Python.', 'Python', 'Python'],
    ['I am learning JavaScript.', 'JavaScript', 'I am learning JavaScript.'],
  ])(
    'does not promote an absent or future skill into a current claim: %s',
    async (notes, skill, evidence) => {
      vi.mocked(generate).mockResolvedValue(
        output({ skills: [skill] }, [{ field: 'skills', proposedValue: skill, evidence }]),
      );
      const result = await prepareProfileBuilderDraft({ notes, mode: 'fixture' });
      expect(result.data.skills).toEqual([]);
      expect(result.proposedChanges).toEqual([]);
      expect(result.discardedFields).toContain('skills');
    },
  );

  it('keeps an explicit no-experience statement without turning it into a positive claim', async () => {
    vi.mocked(generate).mockResolvedValue(
      output({ experience: 'I have no work experience yet.' }, [
        {
          field: 'experience',
          proposedValue: 'I have no work experience yet.',
          evidence: 'I have no work experience yet.',
        },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'I have no work experience yet.',
      mode: 'fixture',
    });
    expect(result.data.experience).toBe('I have no work experience yet.');
  });

  it('does not pair an accepted field with an unrelated evidence quote', async () => {
    vi.mocked(generate).mockResolvedValue(
      output({ location: 'Sydney' }, [
        { field: 'location', proposedValue: 'Sydney', evidence: 'I prefer Sydney' },
        { field: 'location', proposedValue: 'London', evidence: 'I visited London' },
      ]),
    );
    const result = await prepareProfileBuilderDraft({
      notes: 'I prefer Sydney. I visited London.',
      mode: 'fixture',
    });
    expect(result.data.location).toBe('Sydney');
    expect(result.proposedChanges).toEqual([
      { field: 'location', proposedValue: 'Sydney', evidence: 'I prefer Sydney' },
    ]);
  });

  it('removes invalid date and salary suggestions from both the draft and review metadata', async () => {
    const notes = 'Dates: 2026-10-01 and 2026-01-01. Salary: 90000 to 50000 AUD.';
    const draft = {
      startDate: '2026-10-01',
      endDate: '2026-01-01',
      salaryMin: 90000,
      salaryMax: 50000,
    };
    vi.mocked(generate).mockResolvedValue(
      output(
        draft,
        Object.entries(draft).map(([field, value]) => ({
          field,
          proposedValue: String(value),
          evidence: notes,
        })),
      ),
    );
    const result = await prepareProfileBuilderDraft({ notes, mode: 'fixture' });
    for (const field of Object.keys(draft)) {
      expect(result.data[field as keyof typeof result.data]).toBeNull();
      expect(result.discardedFields).toContain(field);
    }
    expect(result.proposedChanges).toEqual([]);
  });

  it('leaves the current form and approved source untouched when the provider fails', async () => {
    const current = structuredClone(sampleProfile);
    vi.mocked(generate).mockRejectedValue(Error('Provider timed out'));
    await expect(
      prepareProfileBuilderDraft({
        notes: 'Please organise the current information.',
        currentProfile: current,
        existingProfile: sampleProfile,
        mode: 'openai',
      }),
    ).rejects.toThrow('Provider timed out');
    expect(current).toEqual(sampleProfile);
  });
});
