import { expect, it } from 'vitest';
import { buildLetter, calendarFile, summarizeTools, toolCommand } from '../apps/api/src/tools.js';
it('grounds cover letter in approved facts and excludes unsupported practice text', () => {
  const letter = buildLetter(
    { name: 'Candidate' },
    [
      { kind: 'experience', text: 'Built a student project' },
      { kind: 'goal', text: 'Become CEO' },
      { kind: 'skill', text: 'SQL' },
    ],
    { title: 'Analyst', company: 'Example' },
  );
  expect(letter.text).toContain('Built a student project');
  expect(letter.text).toContain('SQL');
  expect(letter.text).not.toContain('Become CEO');
  expect(letter.mode).toBe('local-template');
});
it('handles an empty dashboard without inventing rates', () => {
  const d = summarizeTools([]);
  expect(d.total).toBe(0);
  expect(d.interviewRate).toBeNull();
  expect(d.rejectionRate).toBeNull();
});
it('summarizes recorded statuses and recurring gaps from the board, not saved roles', () => {
  const role = (id: string, status: string, gaps: string[]) => ({
    id,
    title: 'Analyst ' + id,
    status,
    gaps,
    history: [{ status, at: '2026-11-01T00:00:00.000Z' }],
    runs: [],
  });
  const d = summarizeTools(
    [],
    [
      role('a', 'offer', ['Python']),
      role('b', 'rejected', ['Python', 'dbt']),
      role('c', 'saved', ['dbt']),
    ],
  );
  expect(d.total).toBe(2);
  expect(d.interviewRate).toBe(0.5);
  expect(d.rejectionRate).toBe(0.5);
  expect(d.recurringGaps).toEqual([
    ['Python', 2],
    ['dbt', 2],
  ]);
});
it('escapes calendar text and provides an alarm without injected calendar properties', () => {
  const c = calendarFile({
    id: 'r',
    createdAt: '2026-10-19T10:00:00Z',
    dueAt: '2026-10-20T10:00:00Z',
    title: 'Meeting\nATTENDEE:fake@example.test; yes,',
    category: 'interview',
  });
  expect(c).toContain('TRIGGER:-PT15M');
  expect(c).toContain('Meeting\\nATTENDEE:fake@example.test\\; yes\\,');
  expect(c).not.toContain('\r\nATTENDEE:');
});
it('rejects invalid statuses, dates and empty negotiation input', () => {
  for (const body of [
    { kind: 'status', status: 'submitted_by_api' },
    { kind: 'reminder', title: 'x', category: 'application', dueAt: 'tomorrow' },
    { kind: 'negotiation', offer: '', response: 'x' },
  ])
    expect(toolCommand.safeParse(body).success).toBe(false);
});
