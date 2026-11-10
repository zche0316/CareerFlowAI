import { describe, expect, it } from 'vitest';
import {
  datasets,
  ndcgAt,
  pairwiseAccuracy,
  runRankingBaselineSuite,
  runRecordsSuite,
  runScreeningSuite,
  matchPhrase,
} from '../scripts/eval.js';

// Regression floors for the deterministic evaluation suites. Each floor sits slightly below the
// value measured (shown in the comment), so a rule change that lowers quality fails here. The
// main sets were re-measured on 2026-11-11 after rule fixes tuned on their own misses, so their
// 100% readings are not generalisation figures; the held-out sets were written after those fixes.
// Raise a floor only after re-measuring; never set one above a measured value. See
// docs/EVALUATION.md.
describe('evaluation floors', () => {
  it('records: field accuracy and quote validity', () => {
    const r = runRecordsSuite();
    expect(r.size).toBeGreaterThanOrEqual(40);
    expect(r.quoteValidity).toBe(1);
    // Measured 1.000 on every field after tuning; one miss costs about 0.021.
    for (const f of ['workRights', 'arrangement', 'seniority', 'salary'] as const)
      expect(r.fields[f].accuracy).toBeGreaterThanOrEqual(0.95);
    expect(r.overallAccuracy).toBeGreaterThanOrEqual(0.97); // measured 1.000
    expect(r.fields.arrangement.statedPrecision).toBeGreaterThanOrEqual(0.95); // measured 1.000
    expect(r.fields.salary.statedPrecision).toBeGreaterThanOrEqual(0.95); // measured 1.000
  });

  it('records held out: generalisation beyond the tuned misses', () => {
    const r = runRecordsSuite(datasets.recordsHoldout());
    expect(r.size).toBeGreaterThanOrEqual(20);
    expect(r.quoteValidity).toBe(1);
    // First reading before any fix was 0.875 overall; after fixing what it exposed, 0.990.
    expect(r.overallAccuracy).toBeGreaterThanOrEqual(0.95);
    for (const f of ['workRights', 'arrangement', 'seniority', 'salary'] as const)
      expect(r.fields[f].accuracy).toBeGreaterThanOrEqual(0.9); // measured 0.958 to 1.000
  });

  it('screening: postings reach the model and non-postings are stopped', async () => {
    const s = await runScreeningSuite();
    expect(s.size).toBeGreaterThanOrEqual(16);
    expect(s.postingRecall).toBeGreaterThanOrEqual(0.85); // measured 0.875 (7/8; w14 is plain HTTP)
    expect(s.nonPostingsStopped).toBeGreaterThanOrEqual(0.9); // measured 1.000 (10/10)
    // Login-walled pages must never reach the model.
    expect(s.byKind.login_wall.reachedModel).toBe(0);
    const h = await runScreeningSuite(datasets.pagesHoldout());
    // First reading 0.8 / 0.8; after fixes 1.0 / 1.0. Five pages of each kind, so 0.8 is one miss.
    expect(h.postingRecall).toBeGreaterThanOrEqual(0.8);
    expect(h.nonPostingsStopped).toBeGreaterThanOrEqual(0.8);
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
