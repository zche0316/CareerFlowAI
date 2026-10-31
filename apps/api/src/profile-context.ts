export function profileModelNotes(messages: { text: string }[], recover = false) {
  // Only the current answer is sent. Recovery also uses the search tool rather
  // than switching back to transcript injection.
  const candidates = messages.slice(-1);
  const limit = 4100;
  const chosen: string[] = [];
  let size = 0;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const note = `Message ${messages.indexOf(candidates[i]) + 1}: ${candidates[i].text}`;
    if (size + note.length > limit) break;
    chosen.unshift(note);
    size += note.length;
  }
  return chosen.join('\n');
}

export function searchProfileHistory(
  messages: { text: string; id?: string }[],
  query: string,
  offset = 0,
) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const ranked = messages
    .map((m, i) => ({
      page: i + 1,
      messageId: m.id,
      text: m.text,
      score: terms.filter((term) => m.text.toLowerCase().includes(term)).length,
    }))
    .filter((m) => query === '*' || m.score > 0)
    .sort((a, b) => b.score - a.score || b.page - a.page);
  const start = Math.max(0, Math.min(30, offset));
  return {
    total: ranked.length,
    nextOffset: start + 2 < ranked.length ? start + 2 : null,
    hits: ranked
      .slice(start, start + 2)
      .map(({ score, ...m }) => ({ ...m, text: m.text.slice(0, 4000) })),
  };
}
