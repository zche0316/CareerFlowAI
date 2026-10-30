import { performance } from 'node:perf_hooks';
import { rankEvidence } from '../packages/contracts/src/career-evidence.js';

// Synthetic examples; labels are manually curated for this small benchmark.
const records = [
  {
    id: 'data-en',
    text: 'In a course project I used Python and Pandas to fill missing values and remove duplicate rows from a dataset.',
  },
  {
    id: 'data-zh',
    text: '课程项目中，我使用 Python 和 Pandas 清洗数据，填补缺失值并删除重复记录。',
  },
  {
    id: 'dashboard',
    text: 'I wrote SQL aggregation queries and created a reporting dashboard for a student project.',
  },
  {
    id: 'testing',
    text: 'I wrote 20 unit tests using pytest for a CSV importer and checked invalid inputs.',
  },
  {
    id: 'support-en',
    text: 'I helped workshop participants use spreadsheets and explained each step clearly.',
  },
  { id: 'support-zh', text: '我帮助社区活动参与者使用电子表格，逐步解释操作方法。' },
  {
    id: 'backend',
    text: 'I implemented a REST API using FastAPI and documented endpoints for the team.',
  },
  {
    id: 'team',
    text: 'I coordinated weekly tasks with teammates and documented project decisions in GitHub.',
  },
];
const cases: { category: string; query: string; relevant: string[] }[] = [
  {
    category: 'exact',
    query: 'Python Pandas missing values duplicate rows',
    relevant: ['data-en', 'data-zh'],
  },
  { category: 'exact', query: 'SQL reporting dashboard', relevant: ['dashboard'] },
  { category: 'exact', query: 'pytest unit tests CSV importer', relevant: ['testing'] },
  {
    category: 'paraphrase',
    query: 'How did I fix incomplete and repeated records?',
    relevant: ['data-en', 'data-zh'],
  },
  {
    category: 'paraphrase',
    query: 'When did I explain a tool to other people?',
    relevant: ['support-en', 'support-zh'],
  },
  {
    category: 'paraphrase',
    query: 'Give an example of checking software against bad input',
    relevant: ['testing'],
  },
  {
    category: 'cross-language',
    query: 'How did I clean a dataset and remove duplicates?',
    relevant: ['data-en', 'data-zh'],
  },
  {
    category: 'cross-language',
    query: 'Describe supporting users with spreadsheets',
    relevant: ['support-en', 'support-zh'],
  },
  { category: 'cross-language', query: '我在哪个项目中开发了数据报表？', relevant: ['dashboard'] },
  {
    category: 'cross-story',
    query: 'Which examples show Python data cleaning and SQL reporting?',
    relevant: ['data-en', 'data-zh', 'dashboard'],
  },
  {
    category: 'cross-story',
    query: 'Find examples of testing software and helping workshop participants',
    relevant: ['testing', 'support-en', 'support-zh'],
  },
  {
    category: 'cross-story',
    query: 'Show API development and team coordination',
    relevant: ['backend', 'team'],
  },
  { category: 'negative', query: 'Where did I administer Kubernetes clusters?', relevant: [] },
  { category: 'negative', query: 'Describe my Salesforce implementation', relevant: [] },
];

// Top 5 is an evaluation choice, not a change to production's top 8.
const results = cases.map((item) => {
  const started = performance.now();
  const hits = rankEvidence(records, item.query)
    .slice(0, 5)
    .map((r) => r.id);
  const elapsedMs = performance.now() - started;
  return {
    ...item,
    hits,
    recall: item.relevant.length
      ? item.relevant.filter((id) => hits.includes(id)).length / item.relevant.length
      : null,
    unlabelled: hits.filter((id) => !item.relevant.includes(id)),
    elapsedMs,
  };
});
const categories = Object.fromEntries(
  [...new Set(cases.map((x) => x.category))].map((category) => {
    const group = results.filter((r) => r.category === category);
    const scored = group.filter((r) => r.recall !== null);
    return [
      category,
      {
        cases: group.length,
        meanRecallAt5: scored.length
          ? scored.reduce((sum, r) => sum + r.recall!, 0) / scored.length
          : null,
        returnedUnlabelled: group.reduce((sum, r) => sum + r.unlabelled.length, 0),
      },
    ];
  }),
);
console.log(
  JSON.stringify(
    {
      description:
        'Synthetic, manually labelled examples; unlabelled hits are candidates for manual review, not verified false associations. In-memory latency excludes network and database.',
      records,
      categories,
      results,
    },
    null,
    2,
  ),
);
