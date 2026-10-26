import type { CareerProfile } from './index.js';
// Reuse approved evidence only. An account name is editable and not an employment claim.
export function australianProfileDraft(
  approved: CareerProfile | undefined,
  name = '',
): CareerProfile {
  return {
    name: approved?.name || name,
    goals: approved?.goals || 'Find a suitable technology role in Australia.',
    skills: [...(approved?.skills || [])],
    interests: [...(approved?.interests || ['Technology roles in Australia'])],
    education: approved?.education || '',
    experience: approved?.experience || '',
    experienceYears: approved?.experienceYears || 0,
    location: 'Australia',
    employmentType: approved?.employmentType || '',
    workArrangement: approved?.workArrangement || '',
    companySize: approved?.companySize || '',
    industry: approved?.industry || '',
    startDate: null,
    endDate: null,
    salaryMin: null,
    salaryMax: null,
    currency: 'AUD',
    sharing: approved
      ? { ...approved.sharing }
      : { coach: false, matching: false, resume: false, interview: false },
  };
}
export function australianResumeText(p: CareerProfile) {
  return [
    p.name || '[Your name]',
    'AUSTRALIA — RESUME DRAFT FOR REVIEW',
    'Email: [add email] | Phone: [add phone] | Portfolio: [optional]',
    'Work rights: [confirm Australian work rights; do not infer]',
    '',
    'CAREER OBJECTIVE',
    p.goals,
    '',
    'SKILLS',
    p.skills.length ? p.skills.join(', ') : '[Add confirmed skills]',
    '',
    'EDUCATION',
    p.education || '[Add degree, institution and dates]',
    '',
    'EXPERIENCE / PROJECTS',
    p.experience || '[Add factual responsibilities, project contributions and dates]',
    '',
    'LOCATION PREFERENCE',
    p.location || 'Australia',
    '',
    'Draft only. Verify every claim and replace all placeholders before external use.',
  ].join('\n');
}
