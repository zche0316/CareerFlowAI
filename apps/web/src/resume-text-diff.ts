export type TextPart = { text: string; changed: boolean };
const tokenize = (text: string) => text.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]|\s+/gu) || [];

/** Exact word/punctuation diff. Linear memory avoids a quadratic table for long resumes. */
export function resumeTextDiff(before: string, after: string) {
  const a = tokenize(before),
    b = tokenize(after);
  const sameA = new Set<number>(),
    sameB = new Set<number>();
  const match = (i: number, j: number) => {
    sameA.add(i);
    sameB.add(j);
  };
  function row(a0: number, a1: number, b0: number, b1: number, reverse: boolean) {
    const n = b1 - b0;
    let previous = new Uint32Array(n + 1),
      current = new Uint32Array(n + 1);
    for (let i = 0; i < a1 - a0; i++) {
      current[0] = 0;
      for (let j = 1; j <= n; j++)
        current[j] =
          a[reverse ? a1 - i - 1 : a0 + i] === b[reverse ? b1 - j : b0 + j - 1]
            ? previous[j - 1] + 1
            : Math.max(previous[j], current[j - 1]);
      [previous, current] = [current, previous];
    }
    return previous;
  }
  function align(a0: number, a1: number, b0: number, b1: number) {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) match(a0++, b0++);
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) match(--a1, --b1);
    if (a0 === a1 || b0 === b1) return;
    if (a1 - a0 === 1) {
      for (let j = b0; j < b1; j++)
        if (a[a0] === b[j]) {
          match(a0, j);
          break;
        }
      return;
    }
    const middle = (a0 + a1) >>> 1;
    const left = row(a0, middle, b0, b1, false),
      right = row(middle, a1, b0, b1, true);
    let split = 0,
      best = -1;
    for (let j = 0; j <= b1 - b0; j++) {
      const score = left[j] + right[b1 - b0 - j];
      if (score > best) {
        best = score;
        split = j;
      }
    }
    align(a0, middle, b0, b0 + split);
    align(middle, a1, b0 + split, b1);
  }
  align(0, a.length, 0, b.length);
  function parts(tokens: string[], unchanged: Set<number>) {
    const result: TextPart[] = [];
    tokens.forEach((text, i) => {
      const changed = !unchanged.has(i) && Boolean(text.trim());
      if (result.at(-1)?.changed === changed) result[result.length - 1].text += text;
      else result.push({ text, changed });
    });
    return result;
  }
  return { before: parts(a, sameA), after: parts(b, sameB) };
}

/** Keep surrounding text (e.g. other skills) untouched when a claim is part of a line. */
export function resumeInlineDiff(text: string, changes: { before: string; after: string }[]) {
  const ranges = changes
    .filter((c) => c.after)
    .map((change) => ({
      start: text.indexOf(change.after),
      change,
    }))
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start || b.change.after.length - a.change.after.length);
  const result: TextPart[] = [];
  let cursor = 0;
  for (const { start, change } of ranges) {
    if (start < cursor) continue;
    if (start > cursor) result.push({ text: text.slice(cursor, start), changed: false });
    result.push(...resumeTextDiff(change.before, change.after).after);
    cursor = start + change.after.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), changed: false });
  return result;
}
