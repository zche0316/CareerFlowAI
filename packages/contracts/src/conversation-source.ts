// Capture source statements, never assistant questions or generated summaries.
// A named experience bounds the relevant section of a user answer.
export const careerTitle = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/^(?:course|personal|student|university) /, '');
export function sourceStatements(
  title: string,
  titles: string[],
  messages: { id: string; role: string; text: string }[],
  focusMessageId?: string,
  recoverSingleExperience = false,
) {
  const target = careerTitle(title);
  const otherTitles = titles.map(careerTitle).filter((t) => t !== target);
  const found: { text: string; messageId: string }[] = [];
  for (const message of messages.filter((m) => m.role === 'user')) {
    const clauses = message.text
      .split(/(?<=[.!?;])\s+|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    let active = recoverSingleExperience || message.id === focusMessageId;
    for (const clause of clauses) {
      const lower = clause.toLowerCase();
      const header = lower.includes(target);
      if (header) active = true;
      else if (otherTitles.some((t) => lower.includes(t))) active = false;
      if (
        !active ||
        clause.includes('?') ||
        /^(?:please|can you|could you|tell me|what |how )/i.test(clause)
      )
        continue;
      if (
        /\b(?:this is|these are).*(?:additional detail|not another|same project|fictional|QA data)/i.test(
          clause,
        )
      )
        continue;
      if (
        /^(?:my name|my (?:email|phone)|I (?:am a (?:student|graduate)|prefer|would prefer|want|would like|hope|aim))\b|^(?:我的(?:名字|邮箱|电话)|我(?:想申请|希望申请|偏好))/i.test(
          clause,
        )
      )
        continue;
      if (
        /^(?:My previous answer|I have described|Please help|Sorry.*(?:do not|don.t) have it|I (?:already )?answered)/i.test(
          clause,
        )
      )
        continue;
      // A title/date header already has its own structured fields.
      if (header && !/\bI\b/i.test(clause)) continue;
      found.push({ text: clause, messageId: message.id });
    }
  }
  return found.filter((item, i) => found.findIndex((other) => other.text === item.text) === i);
}
