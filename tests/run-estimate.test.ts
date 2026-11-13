import { expect, it } from 'vitest';
import { estimateText } from '../apps/web/src/quest/run-estimate.js';

const e = (calls: number, maxCalls: number, runs: number, tokens: number | null = null) => ({
  calls,
  maxCalls,
  runs,
  inputTokens: tokens,
  outputTokens: tokens === null ? null : 0,
});

it('describes the expected cost of a run before it starts (CFS-124)', () => {
  expect(estimateText(null, 'search')).toBe('');
  expect(estimateText({ live: false, estimates: null }, 'coach')).toBe(
    'Rehearsal mode: no model cost.',
  );
  const live = {
    live: true,
    estimates: {
      search: e(13, 14, 2, 22000),
      tailor: e(6, 10, 0),
      practice: e(3, 3, 1, 2400),
      coach: e(1, 1, 0),
      scout: e(5, 6, 3, 0),
    },
  };
  expect(estimateText(live, 'search')).toBe(
    'Live mode: usually about 13 model calls (up to 14) and 22k tokens, from your last 2 Find roles runs.',
  );
  expect(estimateText(live, 'practice')).toBe(
    'Live mode: usually about 3 model calls and 2.4k tokens, from your last practice run.',
  );
  expect(estimateText(live, 'tailor', '')).toBe(
    'expect about 6 model calls (up to 10). No finished tailoring run to measure yet.',
  );
  expect(estimateText(live, 'coach')).toBe(
    'Live mode: expect about 1 model call. No finished Coach refresh to measure yet.',
  );
});
