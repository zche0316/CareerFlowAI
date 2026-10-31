import { expect, it } from 'vitest';
import {
  resumeChanges,
  visibleResumeText,
  pendingResumeChanges,
} from '../packages/contracts/src/resume-review.js';
const original = { factId: 'work-1', kind: 'experience', text: 'I supported SQL reporting.' };
it('recovers real wording differences in older drafts from retained source text', () => {
  const draft = {
    claims: [{ ...original, factText: original.text, text: 'SQL reporting supported.' }],
  };
  expect(pendingResumeChanges(draft)[0].before).toBe('Supported SQL reporting.');
  expect(pendingResumeChanges(draft, [])).toEqual([]);
});
it('does not count formatting already applied by the resume preview as a change', () => {
  expect(visibleResumeText(original)).toBe('Supported SQL reporting.');
  expect(resumeChanges([original], [{ ...original, text: 'Supported SQL reporting.' }])).toEqual(
    [],
  );
});
it('keeps the original baseline through further edits and clears it when restored', () => {
  const first = { ...original, text: 'SQL reporting supported.' };
  const changes = resumeChanges([original], [first]);
  expect(changes[0]).toMatchObject({
    before: 'Supported SQL reporting.',
    after: 'SQL reporting supported.',
    beforeClaim: original,
  });
  const next = { ...original, text: 'Reporting supported using SQL.' };
  expect(resumeChanges([first], [next], changes)[0].before).toBe('Supported SQL reporting.');
  expect(resumeChanges([first], [original], changes)).toEqual([]);
});
it('retains inserted and removed text for review without requiring model calls', () => {
  expect(resumeChanges([original], [])[0]).toMatchObject({
    beforeClaim: original,
    after: '',
    beforeIndex: 0,
  });
  expect(resumeChanges([], [original])[0]).toMatchObject({
    before: '',
    after: 'Supported SQL reporting.',
  });
});
