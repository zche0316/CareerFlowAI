// Copies the party (from party-export.tsx) and the video chapter times (from the recording)
// into site/index.html, so the page needs no fetch and works from file:// too (CFS-184):
//   node site/record/inline-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const page = 'site/index.html';
const json = (file) =>
  JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))).replaceAll('</script', '<\\/script');
let html = readFileSync(page, 'utf8');
for (const [id, file] of [
  ['party-data', 'site/assets/party.json'],
  ['chapter-data', 'site/assets/demo-chapters.json'],
]) {
  const tag = new RegExp(`(<script id="${id}" type="application/json">)[\\s\\S]*?(</script>)`);
  if (!tag.test(html)) throw Error(`No ${id} block in ${page}`);
  html = html.replace(tag, (_m, open, close) => open + json(file) + close);
}
writeFileSync(page, html);
