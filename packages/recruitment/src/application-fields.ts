import { postingIdentity } from './tavily.js';
export type ApplicationField = {
  id: string;
  label: string;
  required: boolean;
  type: string;
  options: { label: string; value: string }[];
  origin: string;
  suggested: string;
  sensitive: boolean;
};
const text = (s: unknown) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .slice(0, 500);
export function baselineFields(profile: any, resumeAvailable: boolean): ApplicationField[] {
  return [
    ['candidate_name', 'Name', profile.name || ''],
    ['email', 'Email', profile.contact?.email || ''],
    ['phone', 'Phone', profile.contact?.phone || ''],
    [
      'resume',
      'Approved resume attachment',
      resumeAvailable ? 'Approved resume available for manual upload' : '',
    ],
  ].map(([id, label, suggested]) => ({
    id,
    label,
    suggested,
    required: true,
    type: 'text',
    options: [],
    sensitive: false,
    origin: 'preparation-checklist; employer requirement unconfirmed',
  }));
}
export function greenhouseFields(
  data: any,
  profile: any,
  resumeAvailable: boolean,
): ApplicationField[] {
  return [...(data.questions || []), ...(data.location_questions || [])]
    .flatMap((q: any, qi: number) =>
      (q.fields || []).map((f: any, fi: number) => {
        const id = text(f.name || `question-${qi}-${fi}`),
          sensitive =
            /demograph|gender|race|ethnic|disabil|veteran|visa|sponsor|work.?right|authoriz|salary|compensation/i.test(
              q.label || '',
            );
        const known: Record<string, string> = {
          email: profile.contact?.email || '',
          phone: profile.contact?.phone || '',
          resume: resumeAvailable ? 'Approved resume available for manual upload' : '',
        };
        return {
          id,
          label: text(q.label || id),
          required: Boolean(q.required),
          type: text(f.type),
          options: (f.values || [])
            .slice(0, 200)
            .map((v: any) => ({ label: text(v.label), value: text(v.value) })),
          origin: 'official-greenhouse-question',
          suggested: sensitive ? '' : known[id] || '',
          sensitive,
        };
      }),
    )
    .slice(0, 80);
}
export async function officialApplicationFields(
  job: any,
  profile: any,
  resumeAvailable: boolean,
  fetcher: typeof fetch = fetch,
) {
  const baseline = baselineFields(profile, resumeAvailable);
  const identity = postingIdentity(job.applicationUrl);
  const board =
    identity?.provider === 'greenhouse'
      ? identity.board
      : job.source?.provider === 'greenhouse'
        ? job.source.board
        : null;
  const id = identity?.provider === 'greenhouse' ? identity.id : job.source?.listingId;
  if (!board || !/^[a-zA-Z0-9_-]{1,80}$/.test(board) || !/^\d{1,30}$/.test(String(id)))
    return {
      fields: baseline,
      schemaKnown: false,
      sourceUrl: null,
      notice:
        'Full employer application questions are not exposed by this supported public source. This is only a preparation checklist. Check the official application page; no hidden form was scraped.',
    };
  const sourceUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=true`;
  const response = await fetcher(sourceUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error('Official application questions unavailable.');
  const raw = await response.text();
  if (raw.length > 2000000) throw Error('Official response too large.');
  const data = JSON.parse(raw);
  if (String(data.id) !== String(id) || !Array.isArray(data.questions))
    throw Error('Official question identity/schema mismatch.');
  const fields = greenhouseFields(data, profile, resumeAvailable);
  const count = [...data.questions, ...(data.location_questions || [])].reduce(
    (n: number, q: any) => n + (q.fields?.length || 0),
    0,
  );
  return {
    fields,
    schemaKnown:
      fields.length > 0 &&
      count <= 80 &&
      fields.every((f) =>
        ['input_text', 'textarea', 'input_file', 'multi_value_single_select'].includes(f.type),
      ) &&
      !data.data_compliance?.length &&
      !data.demographic_questions,
    sourceUrl,
    notice:
      'Public Greenhouse questions only. Consent, demographic, conditional and file-upload questions still require review on the official page. Suggested contact values are not submitted or treated as verified eligibility.',
  };
}
export function fieldGaps(fields: ApplicationField[], answers: Record<string, string>) {
  return fields.map((f) => {
    const answer = answers[f.id]?.trim() || '';
    const valid =
      !!answer &&
      (f.id !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) &&
      (!f.options.length || f.options.some((o) => o.value === answer));
    return {
      ...f,
      answer,
      state: valid ? 'user-reviewed' : f.suggested ? 'available-needs-review' : 'missing',
      missing: f.required && !valid,
    };
  });
}
