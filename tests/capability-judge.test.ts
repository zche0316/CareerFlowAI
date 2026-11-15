import { expect, it } from 'vitest';
import { judgeCapabilities } from '../apps/api/src/capability.js';

// CFS-161: without a model (fixture mode) the rule levels stand unchanged.
it('keeps rule levels when no model judges them', async () => {
  process.env.PROVIDER_MODE = 'fixture';
  const rules: any[] = [
    {
      skill: 'SQL',
      level: 2,
      rawLevel: 2,
      confidence: 'described',
      dimension: 'stack',
      lastUsed: null,
      stale: false,
      evidence: [{ kind: 'listed', label: 'Listed' }],
    },
  ];
  expect(await judgeCapabilities('u:1', rules, {})).toEqual(rules);
});
