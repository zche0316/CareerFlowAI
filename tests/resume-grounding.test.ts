import { expect, it } from 'vitest';
import { checkResumeWording } from '../packages/contracts/src/resume-grounding.js';
import { checkWording } from '../packages/contracts/src/career-evidence.js';

it('allows ordinary synonyms and explanations instead of requiring the source vocabulary', () => {
  expect(
    checkResumeWording(
      'I assisted a team using Python to clean 120 records.',
      'Collaborated with colleagues on Python-based data cleansing involving 120 records.',
    ),
  ).toBeNull();
  expect(
    checkResumeWording(
      'I supported SQL reporting.',
      'Assisted with reporting activities, using SQL as the tool for this reporting work.',
    ),
  ).toBeNull();
});
it('allows compression, including safely omitting a metric or less relevant technology', () => {
  expect(
    checkResumeWording(
      'Used Python and SQL to prepare weekly reports for approximately 120 records.',
      'Prepared weekly reports with Python.',
    ),
  ).toBeNull();
  expect(
    checkResumeWording('Reported on 2,000 orders using SQL.', 'Reported on 2000 orders using SQL.'),
  ).toBeNull();
});
it('still rejects invented numbers, financial outcomes, tools and credentials', () => {
  expect(checkResumeWording('Reported on 120 records.', 'Reported on 500 records.')).not.toBeNull();
  expect(checkResumeWording('Supported reporting.', 'Saved one million dollars.')).not.toBeNull();
  expect(
    checkResumeWording('Used Python for reporting.', 'Used Python and AWS for reporting.'),
  ).not.toBeNull();
  expect(checkResumeWording('Completed a Bachelor degree.', 'Completed a PhD.')).not.toBeNull();
});
it('does not treat a denied leadership claim as evidence for leading', () => {
  expect(
    checkResumeWording(
      'I supported reporting. I did not lead the operations team.',
      'I led the operations team.',
    ),
  ).not.toBeNull();
  expect(
    checkResumeWording('I led the SQL reporting project.', 'Led a reporting project using SQL.'),
  ).toBeNull();
});
it('keeps team and company impact from being inflated', () => {
  expect(
    checkResumeWording(
      'Our team estimated a limited result, not a company-wide result.',
      'Achieved a company-wide result.',
    ),
  ).not.toBeNull();
  expect(
    checkResumeWording(
      'Our team estimated a reduction in preparation time.',
      'I reduced preparation time.',
    ),
  ).not.toBeNull();
  expect(
    checkResumeWording(
      'Our team estimated a reduction in preparation time.',
      'The team estimated that preparation took less time.',
    ),
  ).toBeNull();
});
it('does not weaken the separate factual profile extraction boundary', () => {
  expect(checkWording('Used Python and SQL.', 'Used Python.')).not.toBeNull();
});
