import {
  requirementClauses,
  experienceRequirement,
  educationAssessment,
  locationAssessment,
} from './requirements.js';
export { experienceRequirement, educationAssessment, locationAssessment } from './requirements.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const vocabulary = [
  'python',
  'sql',
  'git',
  'react',
  'rest apis',
  'power bi',
  'docker',
  'typescript',
  'aws',
  'excel',
  'statistics',
  'machine learning',
  'data analysis',
];

const aliases = {
  postgresql: 'sql',
  'javascript react': 'react',
  'rest api': 'rest apis',
  'amazon web services': 'aws',
};

export function canonical(s) {
  const v = s.trim().toLowerCase();
  return aliases[v] || v;
}

export function validateProfile(p) {
  if (
    !p ||
    typeof p.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    !Array.isArray(p.skills) ||
    !p.skills.length ||
    p.skills.some((s) => typeof s !== 'string' || !s.trim()) ||
    !Number.isFinite(p.experienceYears) ||
    p.experienceYears < 0 ||
    p.experienceYears > 60 ||
    ['education', 'goals', 'location', 'employmentType'].some(
      (k) => typeof p[k] !== 'string' || !p[k].trim(),
    )
  )
    throw new Error(
      'A valid career profile requires id, name, skills, experience, education, goals and preferences.',
    );
  if (p.approved !== true)
    throw new Error('Approve your career profile before requesting recommendations.');
  return { ...p, skills: [...new Set(p.skills.map(canonical))] };
}

export const scoringVersion = 'matching-v2';
export const scoringWeights = Object.freeze({
  skill: 0.4,
  preferred: 0.05,
  experience: 0.15,
  education: 0.1,
  preference: 0.15,
  semantic: 0.15,
});
export const educationMeets = (evidence, requirement) =>
  educationAssessment(evidence, requirement).status === 'met';
export const locationMatches = (preference, location) =>
  locationAssessment(preference, location).status === 'met';

// Finite vocabulary and explicit clause evidence keep this local fallback auditable.
export function extractRequirements(job) {
  const clauses = requirementClauses(job.description);
  const skillTerms = [...vocabulary, ...Object.keys(aliases)];
  const skills = (t) => [
    ...new Set(skillTerms.filter((s) => new RegExp('\\b' + s + '\\b', 'i').test(t)).map(canonical)),
  ];
  const evidence = clauses.map((c) => ({ ...c, skills: skills(c.text) }));
  // Alternatives and negated skill requirements require manual interpretation, never an AND penalty.
  const uncertain = (t) => /\b(or|not required|not essential|no .{0,30} required)\b/i.test(t);
  const required = [
    ...new Set(
      evidence.filter((c) => c.kind === 'required' && !uncertain(c.text)).flatMap((c) => c.skills),
    ),
  ];
  const preferred = [
    ...new Set(
      evidence.filter((c) => c.kind === 'preferred' && !uncertain(c.text)).flatMap((c) => c.skills),
    ),
  ].filter((s) => !required.includes(s));
  const mentioned = skills(job.description).filter(
    (s) => !required.includes(s) && !preferred.includes(s),
  );
  const qualification =
    clauses.find(
      (c) =>
        c.kind === 'required' &&
        /\b(bachelor|master|phd|doctorate|diploma|associate|b\.?sc|m\.?sc)\b/i.test(c.text),
    )?.text || 'unspecified';
  return {
    required,
    preferred,
    mentioned,
    experienceYears: experienceRequirement(job.description),
    qualification,
    confidence: required.length ? 'medium' : 'low',
    inferred: false,
    skillEvidence: evidence
      .filter((c) => c.skills.length)
      .map((c) => ({ ...c, kind: uncertain(c.text) ? 'mentioned' : c.kind })),
    evidence: job.description,
  };
}

const tokens = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(
      (s) =>
        s.length > 2 &&
        ![
          'the',
          'and',
          'for',
          'with',
          'skills',
          'required',
          'preferred',
          'minimum',
          'qualification',
          'responsibilities',
        ].includes(s),
    );

// TF-IDF cosine similarity is lexical overlap, not pretrained semantic understanding.
export function vectorSimilarity(a, b, corpus) {
  const docs = corpus.map(tokens),
    vocab = [...new Set(docs.flat().concat(tokens(a), tokens(b)))];
  const vector = (t) => {
    const ts = tokens(t);
    return vocab.map(
      (w) =>
        ts.filter((x) => x === w).length *
        (Math.log((docs.length + 1) / (1 + docs.filter((d) => d.includes(w)).length)) + 1),
    );
  };
  const x = vector(a),
    y = vector(b);
  const dot = x.reduce((s, v, i) => s + v * y[i], 0),
    norm = Math.sqrt(x.reduce((s, v) => s + v * v, 0) * y.reduce((s, v) => s + v * v, 0));
  return norm ? dot / norm : 0;
}

export function compare(profile, job, corpus) {
  const requirements = extractRequirements(job),
    known = new Set(profile.skills.map(canonical));
  const matches = requirements.required.filter((s) => known.has(s)),
    gaps = requirements.required.filter((s) => !known.has(s));
  const skill = requirements.required.length ? matches.length / requirements.required.length : 0.5;
  const preferredMatches = requirements.preferred.filter((s) => known.has(s));
  const preferredGaps = requirements.preferred.filter((s) => !known.has(s));
  const preferred = requirements.preferred.length
    ? preferredMatches.length / requirements.preferred.length
    : 0.5;
  const educationResult = educationAssessment(profile.education, requirements.qualification);
  const locationResult = locationAssessment(profile.location, job.location);
  const credit = (r) => (r.status === 'met' ? 1 : r.status === 'not_met' ? 0 : 0.5);
  const experience =
    requirements.experienceYears === null
      ? 0.5
      : requirements.experienceYears === 0
        ? 1
        : Math.min(1, profile.experienceYears / requirements.experienceYears);
  const education = credit(educationResult);
  const employmentKnown =
    job.employmentType && !/^(unknown|unspecified|not provided)$/i.test(job.employmentType);
  const employment = employmentKnown
    ? canonical(job.employmentType) === canonical(profile.employmentType)
      ? 1
      : 0
    : 0.5;
  const preference = (credit(locationResult) + employment) / 2;
  const semantic = vectorSimilarity(
    profile.skills.join(' ') + ' ' + profile.goals,
    job.title + ' ' + job.description,
    corpus,
  );

  // Keep components inspectable so the weighted suitability score can be reproduced.
  const components = { skill, preferred, experience, education, preference, semantic };
  const score = Math.round(
    100 *
      Object.entries(scoringWeights).reduce(
        (sum, [key, weight]) => sum + weight * components[key],
        0,
      ),
  );
  const limitations = [
    job.source?.liveVacancy
      ? 'External job snapshot; verify availability and requirements on the official source.'
      : job.source?.externalListing
        ? 'User-pasted external listing; content and vacancy availability are unverified.'
        : 'Sample advertisement; not a live vacancy.',
    'Self-reported skills are not verified.',
    'TF-IDF uses word overlap, not pretrained semantic embeddings.',
    'Scores are heuristic suitability indicators, not hiring probabilities.',
  ];
  if (requirements.mentioned.length)
    limitations.push(
      'Unclassified skill mentions are excluded from mandatory and preferred skill scoring.',
    );
  if (!requirements.required.length)
    limitations.push('Required skills unknown; neutral half-credit is used.');
  if (!requirements.preferred.length)
    limitations.push('Preferred skills unspecified; neutral half-credit is used.');
  if (educationResult.status === 'unknown') limitations.push(educationResult.reason);
  if (locationResult.status === 'unknown') limitations.push(locationResult.reason);
  if (requirements.confidence === 'low')
    limitations.push(
      'Low confidence: explicit skill requirements are missing; verify requirements before selecting.',
    );
  if (requirements.experienceYears === null)
    limitations.push(
      'Experience requirement unknown; neutral half-credit is used, not a confirmed match.',
    );
  if (requirements.qualification === 'unspecified')
    limitations.push('Qualification requirement unknown; neutral half-credit is used.');
  if (educationResult.status === 'not_met')
    gaps.push('Qualification evidence: ' + requirements.qualification);
  if (requirements.experienceYears !== null && experience < 1)
    gaps.push(
      `${requirements.experienceYears - profile.experienceYears} additional years of experience`,
    );
  if (locationResult.status === 'not_met') gaps.push('Location preference mismatch');
  if (employment === 0) gaps.push('Employment preference mismatch');
  return {
    job,
    requirements,
    matches,
    gaps,
    components,
    scoringVersion,
    scoringWeights,
    preferredMatches,
    preferredGaps,
    assessment: {
      experience:
        requirements.experienceYears === null ? 'unknown' : experience === 1 ? 'met' : 'not_met',
      education: educationResult,
      location: locationResult,
    },
    score,
    confidence: requirements.confidence,
    explanation: `${matches.length}/${requirements.required.length} required skills evidenced; ${preferredMatches.length}/${requirements.preferred.length} preferred skills evidenced (optional). Experience ${profile.experienceYears}/${requirements.experienceYears ?? 'unknown'} years. Review gaps and score components before choosing.`,
    limitations,
  };
}

// Legacy file-backed services support the original regression suite.
// The integrated API uses authenticated PostgreSQL domain services instead.
export class CareerDataService {
  constructor(dir) {
    this.dir = dir;
  }
  async saveProfile(p) {
    p = validateProfile(p);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, p.id + '.json'), JSON.stringify(p));
    return p;
  }
  async getProfile(id) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id || '')) throw new Error('Profile unavailable');
    try {
      return validateProfile(
        JSON.parse(await fs.readFile(path.join(this.dir, id + '.json'), 'utf8')),
      );
    } catch {
      throw new Error('Profile unavailable: create and approve a profile.');
    }
  }
  async getTarget(id) {
    await this.getProfile(id);
    const target = JSON.parse(await fs.readFile(path.join(this.dir, id + '-target.json'), 'utf8'));
    const current = await this.getProfile(id);
    if (JSON.stringify(current) !== JSON.stringify(target.careerProfile))
      throw new Error('Profile changed: select a target again.');
    return target;
  }
  async saveTarget(id, target) {
    await fs.writeFile(path.join(this.dir, id + '-target.json'), JSON.stringify(target, null, 2));
    return target;
  }
}

export class JobRepository {
  constructor(file) {
    this.file = file;
  }
  async retrieve(failure) {
    if (failure) throw new Error('Job Source unavailable. Retry the request.');
    return JSON.parse(await fs.readFile(this.file, 'utf8'));
  }
}

export class JobMatchingAgent {
  async run(profile, jobs, options = {}) {
    const corpus = jobs.map((j) => j.title + ' ' + j.description);
    let ranked = jobs
      .map((j) => compare(profile, j, corpus))
      .filter((r) => r.score >= options.minScore)
      .sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id));
    return ranked;
  }
}

export class AgentOrchestrator {
  constructor(data, repository) {
    this.data = data;
    this.repository = repository;
    this.agent = new JobMatchingAgent();
    this.runs = new Map();
  }
  async match(id, options) {
    const trace = ['Created'];
    const profile = await this.data.getProfile(id);
    trace.push('Profile Loaded');
    const jobs = await this.repository.retrieve(options.simulateFailure);
    trace.push('Jobs Retrieved', 'Analysing');
    const ranked = await this.agent.run(profile, jobs, options);
    trace.push('Scored', 'Ranked', ranked.length ? 'Presented' : 'No Suitable Jobs');
    const run = {
      id: crypto.randomUUID(),
      profileId: id,
      profileSnapshot: profile,
      ranked,
      trace,
      mode: 'local-tfidf',
      createdAt: new Date().toISOString(),
    };
    this.runs.set(run.id, run);
    if (this.runs.size > 100) this.runs.delete(this.runs.keys().next().value);
    return run;
  }
  async compareSelected(runId, jobIds) {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run expired: run matching again.');
    if (
      !Array.isArray(jobIds) ||
      jobIds.length < 2 ||
      jobIds.length > 4 ||
      new Set(jobIds).size !== jobIds.length
    )
      throw new Error('Select 2–4 distinct jobs for comparison.');
    const current = await this.data.getProfile(run.profileId);
    if (JSON.stringify(current) !== JSON.stringify(run.profileSnapshot))
      throw new Error('Profile changed: run matching again.');
    const rows = jobIds.map((id) => {
      const item = run.ranked.find((r) => r.job.id === id);
      if (!item) throw new Error('Compare jobs from the current ranked result only.');
      return {
        jobId: id,
        title: item.job.title,
        salary: item.job.salary ?? null,
        skills: item.requirements.required,
        location: item.job.location,
        score: item.score,
        growth: item.job.growth ?? null,
        gaps: item.gaps,
        source: item.job.source,
      };
    });
    return {
      runId,
      rows,
      limitations: [
        'Salary and growth values are fictional fixtures, not market estimates.',
        'Unavailable values remain null and must not be inferred.',
      ],
    };
  }
  async select(runId, jobId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run expired: run matching again.');
    const match = run.ranked.find((r) => r.job.id === jobId);
    if (!match) throw new Error('Select a job from the current ranked result.');
    const current = await this.data.getProfile(run.profileId);
    if (JSON.stringify(current) !== JSON.stringify(run.profileSnapshot))
      throw new Error('Profile changed: run matching again before selection.');
    const target = {
      schemaVersion: '1.0',
      profileId: run.profileId,
      careerProfile: current,
      job: match.job,
      requirements: match.requirements,
      analysis: match,
      runId,
      selectedAt: new Date().toISOString(),
      selectedBy: 'Job Seeker',
      handoffTo: ['Resume Tailoring Agent', 'Interview Coach Agent'],
    };
    await this.data.saveTarget(run.profileId, target);
    return {
      ...target,
      trace: [...run.trace, 'Target Job Selected', 'Completed'],
    };
  }
}
