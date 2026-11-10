import { describe, expect, it } from 'vitest';
import {
  ndcgAt,
  pairwiseAccuracy,
  runRankingBaselineSuite,
  runRecordsSuite,
  runScreeningSuite,
  matchPhrase,
} from '../scripts/eval.js';

// Regression floors for the deterministic evaluation suites. Each floor sits slightly below the
// value measured on 2026-11-10 at commit 568f1bb (shown in the comment), so a rule change that
// lowers quality fails here. Raise a floor only after re-measuring; never set one above a
// measured value. See docs/EVALUATION.md.
describe('evaluation floors', () => {
  it('records: field accuracy and quote validity', () => {
    const r = runRecordsSuite();
    expect(r.size).toBeGreaterThanOrEqual(40);
    expect(r.quoteValidity).toBe(1);
    expect(r.fields.workRights.accuracy).toBeGreaterThanOrEqual(0.82); // measured 0.851
    expect(r.fields.arrangement.accuracy).toBeGreaterThanOrEqual(0.65); // measured 0.681
    expect(r.fields.seniority.accuracy).toBeGreaterThanOrEqual(0.8); // measured 0.830
    expect(r.fields.salary.accuracy).toBeGreaterThanOrEqual(0.54); // measured 0.574
    expect(r.overallAccuracy).toBeGreaterThanOrEqual(0.7); // measured 0.734
    expect(r.fields.arrangement.statedPrecision).toBeGreaterThanOrEqual(0.95); // measured 1.000
    expect(r.fields.salary.statedPrecision).toBeGreaterThanOrEqual(0.95); // measured 1.000
  });

  it('screening: postings reach the model and non-postings are stopped', async () => {
    const s = await runScreeningSuite();
    expect(s.size).toBeGreaterThanOrEqual(16);
    expect(s.postingRecall).toBeGreaterThanOrEqual(0.35); // measured 0.375 (3/8)
    expect(s.nonPostingsStopped).toBeGreaterThanOrEqual(0.35); // measured 0.400 (4/10)
    // Login-walled pages must never reach the model.
    expect(s.byKind.login_wall.reachedModel).toBe(0);
  });

  it('ranking baseline: nDCG@5 and pairwise ordering', () => {
    const k = runRankingBaselineSuite();
    expect(k.meanNdcg5).toBeGreaterThanOrEqual(0.72); // measured 0.753
    expect(k.meanPairwise).toBeGreaterThanOrEqual(0.76); // measured 0.797
  });
});

describe('metric helpers', () => {
  it('computes nDCG and pairwise accuracy on known orderings', () => {
    expect(ndcgAt(5, [3, 2, 1, 0], [0, 1, 2, 3])).toBe(1);
    expect(ndcgAt(5, [0, 0, 0], [0, 0, 0])).toBe(0);
    expect(ndcgAt(2, [0, 3], [3, 0])).toBeLessThan(1);
    expect(pairwiseAccuracy([3, 2, 1], [3, 2, 1])).toBe(1);
    expect(pairwiseAccuracy([1, 2, 3], [3, 2, 1])).toBe(0);
    expect(pairwiseAccuracy([1, 1], [2, 0])).toBe(0.5);
  });

  it('matches gold phrases to requirements by token overlap', () => {
    const reqs = [
      { term: 'SQL', excerpt: 'Requirements: SQL' },
      { term: 'Spark', excerpt: 'Spark, Airflow' },
    ];
    expect(matchPhrase('SQL', reqs)?.index).toBe(0);
    expect(matchPhrase('Kafka', reqs)).toBeNull();
  });
});
