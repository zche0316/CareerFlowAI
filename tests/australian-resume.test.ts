import { expect, it } from 'vitest';
import {
  australianProfileDraft,
  australianResumeText,
} from '../packages/contracts/src/australian-resume.js';
import { sampleProfile } from '../packages/contracts/src/index.js';
it('prefills an Australia draft using approved evidence without inventing skills or work rights', () => {
  const p = australianProfileDraft(sampleProfile);
  expect(p.name).toBe(sampleProfile.name);
  expect(p.skills).toEqual(sampleProfile.skills);
  expect(p.location).toBe('Australia');
  expect(p.currency).toBe('AUD');
  const text = australianResumeText(p);
  expect(text).toContain('Work rights: [confirm');
  expect(text).not.toContain('Australian citizen');
  p.skills.push('extra');
  expect(sampleProfile.skills).not.toContain('extra');
});
it('leaves unknown qualifications and experience empty and sharing disabled', () => {
  const p = australianProfileDraft(undefined, 'New candidate');
  expect(p.skills).toEqual([]);
  expect(p.education).toBe('');
  expect(p.experience).toBe('');
  expect(Object.values(p.sharing).every((v) => !v)).toBe(true);
  expect(australianResumeText(p)).toContain('[Add factual');
});
