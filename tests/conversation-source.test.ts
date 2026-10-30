import { it, expect } from 'vitest';
import { sourceStatements } from '../packages/contracts/src/conversation-source.js';
it('retains complete user answers under the named experience without copying questions, headers or a different project', () => {
  const messages = [
    { id: 'assistant', role: 'assistant', text: 'What did you do in Course Atlas Project?' },
    {
      id: 'first',
      role: 'user',
      text: 'My Course Atlas Project was at Example University from 2025-03 to 2025-06. A dataset had missing values. I used SQL to identify missing values and wrote a report. My Other Project involved Python. I built a web app.',
    },
    {
      id: 'second',
      role: 'user',
      text: 'For the same Course Atlas Project, I also presented findings to my team. The actual outcome is still unknown. This is an additional detail of that existing project, not another project.',
    },
    { id: 'question', role: 'user', text: 'What should I say about Course Atlas Project?' },
  ];
  const lines = sourceStatements(
    'Course Atlas Project',
    ['Course Atlas Project', 'Other Project'],
    messages,
  );
  expect(lines.map((l) => l.text)).toEqual([
    'A dataset had missing values.',
    'I used SQL to identify missing values and wrote a report.',
    'For the same Course Atlas Project, I also presented findings to my team.',
    'The actual outcome is still unknown.',
  ]);
  expect(lines.map((l) => l.messageId)).toEqual(['first', 'first', 'second', 'second']);
});

it('keeps a direct answer in the explicitly focused experience without requiring the user to repeat its title', () => {
  expect(
    sourceStatements(
      'Atlas',
      ['Atlas'],
      [{ id: 'answer', role: 'user', text: 'I wrote a SQL report. The outcome is unknown.' }],
      'answer',
    ).map((l) => l.text),
  ).toEqual(['I wrote a SQL report.', 'The outcome is unknown.']);
});
