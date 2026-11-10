# Evaluation

A small evaluation of the job-record extractor, the web-page screen, the rule-based ranking
baseline and (on request) the model-backed requirement mapping and page reader. It exists to
put measured numbers next to these features and to stop rule changes from silently making them
worse. It says nothing about production quality.

## Limitations

- Every ad, page and profile is fictional and was written for this set. Company names are made up.
- The labels come from one person: the author of the set. There was no second labeller and no
  agreement check.
- The sets are small (47 ads, 22 pages, 3 profiles × 8 jobs). One item changes a percentage by
  2 to 12 points. Read the misses, not just the totals.
- The ads were written to include hard and adversarial cases. They are not a sample of the job
  market, so the accuracy here is not the accuracy on real listings.

## Datasets (`evals/data/`)

| File                       | Contents                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `job-records.json`         | 47 ads (AU, UK, US, SG, NZ) with gold work rights, arrangement, seniority and salary. Includes unrelated uses of "citizenship", "hybrid", "remote" and "sponsorship", flattened bullet lists, caps headings, hourly/daily/monthly/"k" pay and no-salary ads. |
| `web-pages.json`           | 18 page texts (postings, listings, articles, an expired notice, two login-walled regional domains, a very short posting) plus 4 trap postings that name other companies or roles on the page.                                                                |
| `job-records-holdout.json` | 24 ads written on 2026-11-11 after the first round of rule fixes and not used to tune them (see below).                                                                                                                                                      |
| `web-pages-holdout.json`   | 10 pages (5 postings, 5 non-postings) written at the same time, for the same purpose.                                                                                                                                                                        |
| `matching.json`            | 3 profiles (validated with `profileSchema`) × 8 jobs, each graded 0–3 by a recruiter's judgement; 6 pairs also list requirement phrases the profile clearly does and does not evidence.                                                                      |

Labelling conventions are stated at the top of each file (for example, a single salary figure is
recorded as min = max, monthly pay is recorded as stated with period `month`, and when both
clearance and citizenship are stated the gold is clearance). Monthly pay was annualised ×12 until
2026-11-11, when the record type gained a `month` period; r05 and r37 were relabelled then, with a
note on each item.

## Suites

Deterministic (default; no network, no model):

- **records** runs `buildJobRecord` over every ad. Per field: accuracy (exact value; null means
  "not stated"), precision and recall of stated versus not stated, and quote validity (share of
  extracted fields whose quote is literally in the ad, using `quoteInSource`). Salary is correct
  when min, max, currency and period all match, with ±1 tolerance on numbers.
- **screening** sends each non-trap page through `discoverWeb` as the only search result, with a
  fake fetcher and a fake page reader that records whether the page reached it. Tavily
  credentials are set to dummy values in-process for this suite only. Reports the share of gold
  postings that reach the model and the share of non-postings stopped before it.
- **ranking-baseline** scores each profile's 8 jobs with the rule-based `compare` and reports
  nDCG@5 (gain 2^grade − 1) and pairwise ordering accuracy (pairs with different grades; a tied
  score earns half credit). Ties keep dataset order.

Live (only with `--live`; each prints its planned request count, counts model calls through
provider hooks and records individual failures instead of stopping):

- **mapping-live** runs `mapJobRequirements` (mode `openai`) and `scoreJobMapping` for the 6
  labelled pairs and for profile p1 × 8 jobs (12 requests; the two overlapping pairs are reused).
  A gold phrase matches the requirement whose term plus excerpt covers the largest share of its
  word tokens (stop words removed), if that share is at least 0.6. Reports the share of supported
  phrases matched to a requirement linked to at least one fact, the share of unsupported phrases
  that were linked anyway (false support), failures, mean latency, unmatched phrases for manual
  audit, and live nDCG@5 and pairwise accuracy next to the baseline for the same profile.
- **pages-live** runs `extractJobPage` on the pages that pass screening plus the 4 traps (at most
  12 requests) through `discoverWeb`, so the production acceptance rule (title and company quoted
  on the page) is applied. Reports accepted/rejected against gold and fabrications: accepted pages
  whose title or company differs from the gold value.

`--limit N` caps the items in each live suite.

## Running

```sh
npm run eval                 # deterministic suites
npm run eval:live            # adds live suites; uses the configured model key and costs money
npx tsx scripts/eval.ts --out <dir> --limit 3
```

Each run writes `output/eval/<timestamp>/report.json` (full detail, misses, config, commit, mode,
dataset sizes, call counts) and `report.md`, and prints a summary table. `output/` is git-ignored:
reports are run artefacts.

## Rule fixes of 2026-11-11

The first readings below exposed rule misses in record extraction and a screen that stopped most
real postings. The rules were changed against those misses:

- **Screening** now stops only pages that are clearly not one open posting and lets anything
  uncertain reach the model (which made 12 of 12 correct calls in the live run). Changes: minimum
  text 600 → 150 characters; `/careers` is no longer treated as a listing path; repeated "Apply
  now" alone no longer marks a listing (per-role "View job"/"Read more" links or a listing heading
  do); new stops for closed postings and for article furniture (byline, read time, related
  articles, share/subscribe; two signs needed); informal "we're hiring" wording counts as a
  posting signal.
- **Work rights**: clearance outranks citizenship; "citizenship" needs a nationality, a residency
  pairing or required/only wording; "without sponsorship" and "sponsorship is not available" are
  read as no sponsorship (the second was read as _available_ before, a reversed meaning).
- **Arrangement**: negated remote ("not a remote role", "cannot be performed remotely") is on-site;
  hybrid labels, office-plus-home phrasing, "remote with/across …", "based at our … office", FIFO.
- **Seniority**: "Manager" alone is no longer lead (only engineering/team/people/delivery manager,
  team leader); the body can fill an empty title-derived level only when it describes this role
  ("this is a senior position", "our graduate program", "a paid internship").
- **Salary**: single figure is min = max, "up to X" is a ceiling, "from X" a floor; unsigned
  figures after a salary word ("130000 to 145000", "140-155k", "32.50 per hour"); monthly pay; a
  currency code anywhere in the sentence; and a bare "$" takes the listing location's currency
  (US, NZ, SG, CA, UK) before falling back to AUD.

Because the main sets were then tuned on their own misses, their new 100% readings say little
about generalisation. The held-out sets were written afterwards to measure that. They were written
by the same author, who had seen the rules, so they are a weaker check than an independent set.

| Metric                      | Main set before | Main set after (tuned) | Held-out, first reading | Held-out after fixes |
| --------------------------- | --------------- | ---------------------- | ----------------------- | -------------------- |
| Work rights                 | 85.1%           | 100%                   | 91.7%                   | 100%                 |
| Arrangement                 | 68.1%           | 100%                   | 70.8%                   | 100%                 |
| Seniority                   | 83.0%           | 100%                   | 91.7%                   | 95.8%                |
| Salary (strict)             | 57.4%           | 100%                   | 95.8%                   | 100%                 |
| Records overall             | 73.4%           | 100%                   | 87.5%                   | 99.0%                |
| Quote validity              | 100%            | 100%                   | 100%                    | 100%                 |
| Postings reaching the model | 37.5% (3/8)     | 87.5% (7/8)            | 80% (4/5)               | 100% (5/5)           |
| Non-postings stopped        | 40.0% (4/10)    | 100% (10/10)           | 80% (4/5)               | 100% (5/5)           |

The **held-out first reading** is the best available estimate of how the rules do on ads they were
not written for: about 88% field accuracy, with arrangement phrasing still the weakest field.
After it, the held-out set was used to fix one reversed-meaning bug and a few phrasing gaps, so
the last column is tuned too. A fresh set (ideally labelled by someone else) is needed for the
next honest reading. The remaining miss is h13 ("a paid ten-week vacation program" not read as an
internship). The main-set posting miss is w14, a plain-HTTP page, stopped by policy.

Ranking is unchanged by these fixes (nDCG@5 0.753, pairwise 0.797). The live suites were not
re-run after the fixes; the screening change means more pages now reach the model per sweep.

## First deterministic results

Measured 2026-11-10, commit `568f1bb`, `npx tsx scripts/eval.ts`, before the rule fixes above.

| Metric                                 | Value                         |
| -------------------------------------- | ----------------------------- |
| Work rights accuracy                   | 85.1% (40/47)                 |
| Arrangement accuracy                   | 68.1% (32/47)                 |
| Seniority accuracy                     | 83.0% (39/47)                 |
| Salary accuracy (strict)               | 57.4% (27/47)                 |
| Overall field accuracy                 | 73.4%                         |
| Quote validity                         | 100% (78 quotes)              |
| Arrangement stated recall / precision  | 50.0% / 100%                  |
| Salary stated recall / precision       | 77.4% / 100%                  |
| Postings reaching the model            | 37.5% (3/8)                   |
| Non-postings stopped before the model  | 40.0% (4/10)                  |
| Ranking nDCG@5 (p1 / p2 / p3 / mean)   | 0.476 / 0.868 / 0.916 / 0.753 |
| Ranking pairwise (p1 / p2 / p3 / mean) | 0.609 / 0.891 / 0.891 / 0.797 |

Main miss categories (item IDs in brackets):

- **Arrangement phrasing not recognised** (recall 50%): "in the office three days a week and from
  home two days" (r01), "Tuesdays to Thursdays in the office" (r06), "This role is hybrid, with
  three days…" (r19), "work from home up to 3 days" (r28), "a mix of office and home working"
  (r43), "100% onsite" (r20), "based at our Hobart office" (r27), "Remote with occasional travel"
  (r33). Two wrong values: "Hybrid – 1 day per week on site" read as on-site (r21) and "This is
  not a remote role" read as remote (r26).
- **Salary**: nine misses only because a single figure leaves max empty while the set records
  min = max (r03, r06, r09, r13, r22, r25, r34, r39, r45; accepting that convention gives 76.6%).
  Beyond that: currency defaults to AUD even when the ad says USD or is in the US (r19, r20, r38);
  monthly pay is read as annual (r05) or missed (r37); not extracted at all for "Up to $150,000"
  (r12), "140-155k" (r18), "130000 to 145000" without a symbol (r23), "32.50 per hour" (r32),
  "$95K to $105K" (r36) and a range after a caps heading (r42).
- **Work rights**: "corporate citizenship program" and "engage citizens" read as a citizenship
  requirement (r06, r40); citizenship picked over a stated clearance (r20, r41); missed
  "SC clearance" (r21), "Visa sponsorship (482) available" (r24) and "authorized to work … without
  sponsorship" (r38).
- **Seniority**: any "Manager" title becomes lead (r06, r18, r26, r39); levels stated only in the
  body are not read, by design (r10, r11, r30, r31).
- **Screening**: genuine postings stopped for a `/careers` path on a small employer's
  one-vacancy page (w03), an informal ad without the expected section words (w04), a short posting
  (w05), plain HTTP (w14, intentional policy) and a posting that repeats "Apply now" five times
  (w16). Non-postings that would cost a model call: an aggregator list and an open-roles page
  (w08, w18), three articles (w09, w10, w17) and an expired notice that keeps the original ad
  (w11). Login-walled pages were always stopped.
- **Ranking**: for the graduate analyst profile (p1) the baseline puts a 3-year Melbourne analyst
  role and a data engineering role (both grade 1) above both grade-3 graduate roles.

## Live results

Run once on 2026-11-10 (UTC) at commit 568f1bb with the configured live model, 39 model calls in
total. One run on a small synthetic set; treat these as a first reading, not a benchmark.

| Suite                                                           | Result                                       |
| --------------------------------------------------------------- | -------------------------------------------- |
| Mapping: gold-supported phrases covered                         | 87.5% of 16                                  |
| Mapping: gold-unsupported phrases linked anyway (false support) | 7.1% of 14                                   |
| Mapping: failed pairs                                           | 1 of 12 (schema validation after correction) |
| Mapping: mean latency per pair                                  | 11.7 s                                       |
| Ranking, profile p1 × 8 jobs: nDCG@5                            | 0.99 live vs 0.476 rule-based baseline       |
| Ranking, profile p1: pairwise accuracy                          | 0.941 live vs 0.609 baseline                 |
| Pages: correct accept/reject decisions                          | 12 of 12                                     |
| Pages: fabricated title or company accepted                     | 0 (including the trap pages)                 |

The live ranking figure covers one profile only. The pages suite reads only pages that pass
screening, so it does not offset the screening recall above.

## Regression floors

`tests/eval.test.ts` runs the deterministic suites (main and held-out) under `vitest` and asserts
floors set slightly below the latest measured values, each with a comment giving the measured value. Quote validity must stay
exactly 1 and login-walled pages must never reach the model. If a rule change improves a number,
re-run `npm run eval`, update this page and raise the floor to just below the new value. Never set
a floor above a measured value, and never edit the labelled data to make a floor pass; a label
that is wrong should be corrected with a note explaining why.
