// Extractive presentation: never replace or rewrite the underlying evidence.
export function experienceOverview(record: {
  overview?: string;
  details?: string[];
  starStory?: Record<string, string>;
}) {
  if (record.overview?.trim()) return record.overview;
  const story = Object.values(record.starStory || {})
    .filter(Boolean)
    .join(' ');
  const lines = (record.details || []).filter(
    (line) => !story.includes(line) && !/^From .*\bI worked as\b/i.test(line),
  );
  const chosen: string[] = [];
  for (const line of lines) {
    if (chosen.length >= 4 && !chosen.at(-1)?.endsWith(';')) break;
    chosen.push(line);
  }
  for (const line of lines)
    if (/\bnot\b|\bnever\b|\bonly\b|approximately|unmeasured/i.test(line) && !chosen.includes(line))
      chosen.push(line);
  return lines.filter((line) => chosen.includes(line)).join(' ');
}
