import { describe, expect, it } from 'vitest';
import { eligibleSemanticRows, semanticCandidates } from '../apps/api/src/semantic-evidence.js';

describe('semantic suggestion boundaries', () => {
  const rows = [
    { id: 'general', text: 'Python data cleaning', recordId: 'one', missionId: null },
    { id: 'specific', text: 'SQL reporting', recordId: 'two', missionId: 'mission' },
  ];
  it('filters application and record scope before embedding', () => {
    expect(eligibleSemanticRows(rows, {}).map((r) => r.id)).toEqual(['general']);
    expect(
      eligibleSemanticRows(rows, { missionId: 'mission', recordId: 'two' }).map((r) => r.id),
    ).toEqual(['specific']);
  });
  it('discards unknown IDs, duplicates and low or invalid scores', () => {
    const result = semanticCandidates(rows, [
      { id: 'unknown', score: 0.99 },
      { id: 'general', score: 0.9 },
      { id: 'general', score: 0.95 },
      { id: 'specific', score: 0.8 },
      { id: 'specific', score: Infinity },
    ]);
    expect(result.map((r) => r.id)).toEqual(['general']);
  });
});
