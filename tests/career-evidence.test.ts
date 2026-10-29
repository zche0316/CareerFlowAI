import { describe, it, expect } from 'vitest';
import {
  rankEvidence,
  checkWording,
  nextProfileQuestions,
  matchingProfileView,
} from '../packages/contracts/src/career-evidence.js';
import {
  officialApplicationFields,
  greenhouseFields,
  fieldGaps,
} from '../packages/recruitment/src/application-fields.js';
describe('Scoped lexical retrieval baseline', () => {
  it('handles Unicode/CJK, respects record/application associations and reports no fabricated match', () => {
    const rows = [
      { id: 'general', text: '数据分析 SQL', recordId: 'project-1', missionId: null },
      { id: 'specific', text: 'SQL analysis', missionId: 'application-1' },
    ];
    expect(rankEvidence(rows, '数据 SQL').map((r) => r.id)).toEqual(['general']);
    expect(rankEvidence(rows, 'SQL', { missionId: 'application-1' })).toHaveLength(2);
    expect(rankEvidence(rows, 'SQL', { recordId: 'other' })).toEqual([]);
    expect(rankEvidence(rows, 'Kubernetes')).toEqual([]);
  });
  it('asks for actual dates and contributions without inferring experience', () => {
    const qs = nextProfileQuestions({
      name: 'Alex',
      goals: 'Analyst',
      skills: ['SQL'],
      education: 'BSc',
      projects: [{ title: 'Atlas', details: [], current: false }],
      location: 'Sydney',
    });
    expect(qs.join(' ')).toContain('YYYY-MM');
    expect(qs.join(' ')).toContain('own contribution');
  });
});
describe('Conservative expression boundary', () => {
  it('allows first-person removal but rejects invented metrics, leadership and removed qualifiers/facts', () => {
    expect(
      checkWording('I used SQL to clean 120 records.', 'used SQL to clean 120 records.'),
    ).toBeNull();
    expect(
      checkWording('I used SQL to clean 120 records.', 'Led SQL automation for 200 records.'),
    ).not.toBeNull();
    expect(checkWording('I assisted a team using Python.', 'used Python.')).not.toBeNull();
    expect(checkWording('Used Python and SQL.', 'Used Python.')).not.toBeNull();
  });
});
describe('Official application question adapters', () => {
  const profile = {
    name: 'Alex',
    contact: { email: 'alex@example.test', workRights: 'User-attested rights' },
  };
  it('retrieves only a constructed allowlisted Greenhouse endpoint and keeps eligibility unanswered', async () => {
    let requested = '';
    const r = await officialApplicationFields(
      { applicationUrl: 'https://boards.greenhouse.io/example/jobs/123' },
      profile,
      true,
      (async (url: any) => {
        requested = url;
        return new Response(
          JSON.stringify({
            id: 123,
            questions: [
              { label: 'Email', required: true, fields: [{ name: 'email', type: 'input_text' }] },
              {
                label: 'Do you require sponsorship?',
                required: true,
                fields: [{ name: 'sponsor', type: 'input_text' }],
              },
            ],
          }),
        );
      }) as typeof fetch,
    );
    expect(requested).toBe(
      'https://boards-api.greenhouse.io/v1/boards/example/jobs/123?questions=true',
    );
    expect(r.fields[0].suggested).toBe(profile.contact.email);
    expect(r.fields[1].suggested).toBe('');
    expect(r.fields[1].sensitive).toBe(true);
    expect(fieldGaps(r.fields, {})[0].state).toBe('available-needs-review');
  });
  it('does not scrape Lever/Ashby/manual pages or fetch arbitrary URLs', async () => {
    const r = await officialApplicationFields(
      { applicationUrl: 'http://127.0.0.1/private', source: {} },
      profile,
      false,
      (() => {
        throw Error('Must not fetch');
      }) as any,
    );
    expect(r.schemaKnown).toBe(false);
    expect(r.fields.find((f) => f.id === 'resume')?.suggested).toBe('');
  });
  it('validates published select options and discloses incomplete compliance schemas', () => {
    const fields = greenhouseFields(
      {
        questions: [
          {
            label: 'Choice',
            required: true,
            fields: [
              {
                name: 'choice',
                type: 'multi_value_single_select',
                values: [{ label: 'Yes', value: 1 }],
              },
            ],
          },
        ],
      },
      profile,
      true,
    );
    expect(fieldGaps(fields, { choice: 'not-an-option' })[0].missing).toBe(true);
    expect(fieldGaps(fields, { choice: '1' })[0].missing).toBe(false);
  });
});

it('uses approved project technology and full source context without inventing employment years or completed degrees', () => {
  const p = {
    skills: [],
    goals: 'Find a data role',
    education: 'Studying a Bachelor degree',
    experienceYears: 0,
    projects: [
      {
        id: 'p',
        title: 'Volunteer SQL project',
        technologies: ['SQL'],
        details: ['I checked the original data.'],
        experienceType: 'volunteer',
        current: false,
      },
    ],
    educations: [
      {
        title: 'Bachelor of IT',
        current: true,
        endMonth: null,
        expectedEndMonth: '2027-07',
        details: [],
        technologies: [],
      },
    ],
  };
  const view = matchingProfileView(p);
  expect(view.skills).toContain('SQL');
  expect(view.goals).toContain('I checked the original data.');
  expect(view.experienceYears).toBe(0);
  expect(view.education).toBe('');
  expect(p.goals).toBe('Find a data role');
});

it('does not use a conflicting legacy education summary when structured education is authoritative', () => {
  const view = matchingProfileView({
    skills: [],
    goals: 'Analyst',
    experienceYears: 0,
    education: 'PhD in an old free-text summary',
    educations: [
      {
        id: 'edu-one',
        title: 'Bachelor of IT',
        organisation: 'Example University',
        endMonth: '2025-11',
        current: false,
        details: [],
        technologies: [],
      },
    ],
  });
  expect(view.education).toContain('Bachelor of IT');
  expect(view.education).not.toContain('PhD');
});

it('asks education-specific missing details but never demands a contribution to a qualification', () => {
  const base = { name: 'Alex', goals: 'Analyst', skills: ['SQL'], education: '', experience: 'none yet', location: 'Sydney' };
  const degree = { title: 'Bachelor of IT', organisation: 'Example University', startMonth: '2022-02', endMonth: '2025-11', current: false, details: [] };
  expect(nextProfileQuestions({ ...base, educations: [degree] })).toEqual([]);
  const missing = nextProfileQuestions({ ...base, educations: [{ ...degree, organisation: '', startMonth: null, endMonth: null }] });
  expect(missing.join(' ')).toContain('institution');
  expect(missing.join(' ')).not.toMatch(/contribution|outcome|achievement/i);
  expect(nextProfileQuestions({ ...base, educations: [degree], projects: [{ ...degree, title: 'SQL Project' }] }).join(' ')).toContain('contribution to SQL Project');
});
