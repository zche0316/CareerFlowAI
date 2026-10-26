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
it('summarizes only explicit current application statuses and latest stored gaps', () => {
  const d = summarizeTools([
    {
      id: 'm',
      goal: 'x',
      data: {
        optionalTools: { status: { value: 'offer', at: 'now' } },
        selectedJob: { job: { title: 'Analyst' } },
        matches: [{ gaps: ['Python'] }],
      },
    },
  ]);
  expect(d.interviewRate).toBe(1);
  expect(d.recurringGaps).toEqual([['Python', 1]]);
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
