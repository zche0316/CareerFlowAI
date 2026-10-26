import type { CareerProfile } from './index.js';
// Returns search terms only. Never pass the profile, identity or experience text to a job API.
export function suggestJobSearch(profile: CareerProfile) {
  const text = [profile.goals, ...profile.interests].join(' ').toLowerCase();
  const roles: [RegExp, string][] = [
    [/data analys|数据分析/, 'data analyst'],
    [/software|developer|软件/, 'software engineer'],
    [/cyber|security|网络安全/, 'cyber security'],
    [/business analys/, 'business analyst'],
    [/machine learning|机器学习/, 'machine learning'],
  ];
  const keyword = roles.find(([pattern]) => pattern.test(text))?.[1] || profile.interests[0] || '';
  const location = /^(australia|澳洲|澳大利亚)$/i.test(profile.location.trim())
    ? ''
    : profile.location.trim();
  return { keyword: keyword.slice(0, 150), location: location.slice(0, 150) };
}
