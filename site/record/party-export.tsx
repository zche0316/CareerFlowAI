// Prints the agent party (faces as static SVG, names, quotes, what each may and may not do) as
// JSON for the landing site's Meet your party section (CFS-184):
//   npx tsx site/record/party-export.tsx > site/assets/party.json
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAvatar, agentProfiles } from '../../apps/web/src/quest/characters.js';

const party = Object.entries(agentProfiles).map(([id, p]) => ({
  id,
  ...p,
  svg: renderToStaticMarkup(
    createElement(AgentAvatar, { agent: id as never, size: 72, label: false }),
  ),
}));
console.log(JSON.stringify(party, null, 1));
