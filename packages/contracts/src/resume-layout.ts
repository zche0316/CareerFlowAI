export type ResumeRecord = {
  id: string;
  section: string;
  title: string;
  organisation?: string;
  location?: string;
  startMonth?: string | null;
  endMonth?: string | null;
  current?: boolean;
};
export type ResumeView = {
  name: string;
  jobTitle: string;
  summary?: string;
  contact?: {
    email?: string;
    phone?: string;
    city?: string;
    linkedin?: string;
    portfolio?: string;
    workRights?: string;
  };
  records?: ResumeRecord[];
  claims: {
    factId?: string;
    text: string;
    kind: string;
    section?: string;
    recordId?: string;
    recordHeaderId?: string;
  }[];
};
export const resumeLabels: Record<string, string> = {
  skill: 'Skills',
  education: 'Education',
  educations: 'Education',
  experience: 'Experience',
  workExperiences: 'Work Experience',
  projects: 'Projects',
  volunteering: 'Volunteering',
  activities: 'Clubs & Activities',
};
export const resumeBullet = (s: string) =>
  s
    .replace(/^(?:Personal actions|Personal responsibility|Team outcomes|Outcomes):\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/^I (?:also )?/, '')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
export function resumeLayout(c: ResumeView) {
  const groups = new Map<string, string[]>();
  const add = (key: string, value: string) => {
    const label = resumeLabels[key] || key;
    groups.set(label, [...(groups.get(label) || []), value]);
  };
  if (c.summary?.trim()) add('Career Objective', c.summary.trim());
  const skills = c.claims.filter((x) => x.kind === 'skill').map((x) => x.text);
  if (skills.length) add('skill', [...new Set(skills)].join(', '));
  if (!c.records) {
    for (const claim of c.claims.filter((x) => x.kind !== 'skill'))
      if (resumeLabels[claim.section || claim.kind]) add(claim.section || claim.kind, claim.text);
  } else {
    for (const section of [
      'workExperiences',
      'projects',
      'volunteering',
      'activities',
      'educations',
    ]) {
      for (const r of c.records.filter((r) => r.section === section)) {
        const selected = c.claims.filter(
          (x) =>
            x.recordId === r.id &&
            (x.section === section || (section === 'educations' && x.kind === 'education')),
        );
        if (!selected.length) continue;
        const bullets = selected.filter((x) => x.recordHeaderId).map((x) => resumeBullet(x.text));
        if (section !== 'educations' && !bullets.length) continue;
        const dates =
          r.startMonth || r.endMonth || r.current
            ? `${r.startMonth || 'Date not supplied'} – ${r.current ? 'Present' : r.endMonth || 'Date not supplied'}`
            : '';
        add(
          section,
          [
            r.title,
            [r.organisation, r.location, dates].filter(Boolean).join(' · '),
            ...bullets.map((s) => '• ' + s),
          ]
            .filter(Boolean)
            .join('\n'),
        );
      }
    }
    for (const claim of c.claims.filter((x) => x.kind !== 'skill' && !x.recordId))
      add(claim.section || claim.kind, claim.text);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}
export function resumeRecordIndex(p: any): ResumeRecord[] {
  return ['workExperiences', 'projects', 'educations'].flatMap((section) =>
    (p[section] || []).map((r: any) => ({
      id: r.id,
      section:
        r.experienceType === 'volunteer'
          ? 'volunteering'
          : r.experienceType === 'club'
            ? 'activities'
            : section,
      title: r.title,
      organisation: r.organisation,
      location: r.location,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      current: r.current,
    })),
  );
}
export function isResumeContribution(f: { text: string; recordHeaderId?: string; kind: string }) {
  return (
    f.kind !== 'experience' ||
    Boolean(
      f.recordHeaderId &&
      !/^(?:Type|Organisation|Dates|Location|Tools|Public link|Background|Reflection):|^This is fictional test data/i.test(
        f.text,
      ) &&
      !/^(?:Python|SQL|Git|Excel)(?:[, .]|$)/i.test(f.text),
    )
  );
}

export function resumeObjective(jobTitle: string, claims: { kind: string; text: string }[]) {
  const skills = [...new Set(claims.filter((c) => c.kind === 'skill').map((c) => c.text))];
  return `Targeting ${jobTitle} opportunities${skills.length ? ', with skills in ' + skills.join(', ') : ''}.`;
}
