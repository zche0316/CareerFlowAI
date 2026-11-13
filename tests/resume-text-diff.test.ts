import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resumeTextDiff, resumeInlineDiff } from '../apps/web/src/resume-text-diff.js';
import { ResumePreview } from '../apps/web/src/resume-preview.js';

const changed = (parts: { text: string; changed: boolean }[]) =>
  parts
    .filter((p) => p.changed)
    .map((p) => p.text)
    .join(' ');
it('marks a moved clause without colouring the unchanged experience', () => {
  const before =
    'I checked missing values and inconsistent delay categories, compared warehouse labels, and drafted shared definitions.';
  const after =
    'I compared warehouse labels, checked missing values and inconsistent delay categories, and drafted shared definitions.';
  const diff = resumeTextDiff(before, after);
  expect(diff.before.map((p) => p.text).join('')).toBe(before);
  expect(diff.after.map((p) => p.text).join('')).toBe(after);
  expect(changed(diff.after)).toContain('compared');
  expect(changed(diff.after)).not.toContain('inconsistent');
  expect(changed(diff.after)).not.toContain('drafted');
});
it('handles insertion, deletion and a completely new or removed item', () => {
  expect(changed(resumeTextDiff('SQL reporting', 'SQL and Excel reporting').after)).toBe(
    'and Excel',
  );
  const deleted = resumeTextDiff('SQL and Excel reporting', 'SQL reporting');
  expect(changed(deleted.before)).toContain('Excel');
  expect(changed(deleted.after)).toBe('');
  expect(changed(resumeTextDiff('', 'SQL').after)).toBe('SQL');
  expect(changed(resumeTextDiff('SQL', '').before)).toBe('SQL');
});
it('preserves repeated words, punctuation, numbers and whitespace exactly', () => {
  for (const [before, after] of [
    ['SQL SQL Excel', 'SQL Excel'],
    ['2,000 orders.', '2,000 orders!'],
    ['Café\n  SQL <script>', 'Café\n  Excel <script>'],
    ['', ''],
    ['SQL and Excel', 'SQL and Excel'],
  ]) {
    const result = resumeTextDiff(before, after);
    expect(result.before.map((p) => p.text).join('')).toBe(before);
    expect(result.after.map((p) => p.text).join('')).toBe(after);
  }
  expect(changed(resumeTextDiff('SQL SQL Excel', 'SQL Excel').before)).toBe('SQL');
  expect(changed(resumeTextDiff('Same text', 'Same text').after)).toBe('');
});
it('does not colour other skills on the same line', () => {
  const parts = resumeInlineDiff('SQL, Python, Git', [{ before: 'Excel', after: 'Python' }]);
  expect(parts.map((p) => p.text).join('')).toBe('SQL, Python, Git');
  expect(changed(parts)).toBe('Python');
});
it('keeps long common paragraphs unchanged and escapes markup in the preview', () => {
  const prefix = 'I supported reporting for 2,000 orders. '.repeat(150);
  const diff = resumeTextDiff(prefix + 'SQL', prefix + 'Excel');
  expect(changed(diff.after)).toBe('Excel');
  const html = renderToStaticMarkup(
    createElement(ResumePreview, {
      content: {
        name: 'Alex',
        jobTitle: 'Analyst',
        claims: [
          { factId: 'skill', kind: 'skill', text: 'SQL' },
          { factId: 'work', kind: 'experience', text: 'Used SQL <script>.' },
        ],
      },
      changes: [{ factId: 'skill', before: '', after: 'SQL', beforeIndex: -1 }],
    }),
  );
  expect(html.match(/<mark/g)).toHaveLength(1);
  expect(html).toContain('Used SQL &lt;script&gt;.');
  expect(html).not.toContain('<script>');
});
