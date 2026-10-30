// Optional complete-answer format inside the same chat, not a second form.
// Map explicit labels deterministically; do not infer absent facts.
export function labelledExperience(text: string, page: number) {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z ]+):\s*(.+)$/.exec(line.trim());
    if (match) fields.set(match[1].toLowerCase().trim(), match[2].trim());
  }
  const title = fields.get('title'),
    organisation = fields.get('organisation');
  const type = fields.get('type')?.toLowerCase();
  if (
    !title ||
    !organisation ||
    !['work', 'course project', 'personal project', 'volunteer', 'club'].includes(type || '') ||
    !fields.get('dates') ||
    !fields.get('background') ||
    !fields.get('personal actions')
  )
    return null;
  const dates = fields.get('dates')!,
    months = dates.match(/\b\d{4}-(?:0[1-9]|1[0-2])\b/g) || [];
  const current = /\b(?:present|ongoing|current)\b/i.test(dates) && !/\bnot\b/i.test(dates);
  if (months.length > 2 || (months.length === 1 && !current)) return null;
  const detailKeys = [
    'background',
    'personal responsibility',
    'personal actions',
    'team outcomes',
    'outcomes',
    'reflection',
  ];
  const location = fields.get('location') || '';
  const link = fields.get('public link') || '';
  return {
    section: type === 'work' ? ('workExperiences' as const) : ('projects' as const),
    title,
    organisation,
    location: /^unknown\b/i.test(location) ? '' : location,
    startMonth: months[0] || null,
    endMonth: current ? null : months[1] || null,
    current,
    details: detailKeys.flatMap((key) => (fields.has(key) ? [fields.get(key)!] : [])),
    technologies: (fields.get('tools') || '').split(/,\s*|;\s*| and /).filter(Boolean),
    url: /^https?:\/\/\S+$/.test(link) ? link : '',
    evidence: [{ page, quote: text }],
  };
}
