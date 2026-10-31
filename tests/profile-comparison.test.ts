import { expect, it } from 'vitest';
import { sameProfileField } from '../packages/contracts/src/profile-comparison.js';

it('accepts the first record when the optional list has not been set', () => {
  expect(sameProfileField(undefined, [])).toBe(true);
  expect(sameProfileField(null, [])).toBe(true);
});

it('ignores JSONB object key order but protects real edits and record order', () => {
  expect(sameProfileField([{ id: 'a', title: 'Degree' }], [{ title: 'Degree', id: 'a' }])).toBe(
    true,
  );
  expect(sameProfileField([{ id: 'a', title: 'Changed' }], [{ id: 'a', title: 'Degree' }])).toBe(
    false,
  );
  expect(sameProfileField([], [{ id: 'a', title: 'Degree' }])).toBe(false);
  expect(sameProfileField(['SQL', 'Excel'], ['Excel', 'SQL'])).toBe(false);
  expect(sameProfileField('', [])).toBe(false);
});
