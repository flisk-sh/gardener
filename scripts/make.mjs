// Local runner: bun scripts/make.mjs owner/repo [--out tower.svg] [--no-model]
// Model: WOLF_KEY (the hosted flisk-wolf at inference.flisk.si). Without it the tower is drawn from facts only.
import { writeFileSync } from 'node:fs';
import { buildTower } from '../src/index.js';
import { renderTower } from '../src/tower.js';

const args = process.argv.slice(2);
const target = args.find((a) => /^[\w.-]+\/[\w.-]+$/.test(a));
if (!target) {
  console.error('usage: bun scripts/make.mjs owner/repo [--out file.svg] [--no-model]');
  process.exit(2);
}
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : `${target.replace('/', '-')}.svg`;

const [owner, repo] = target.split('/');
const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, WOLF_KEY: process.env.WOLF_KEY, WOLF_URL: process.env.WOLF_URL };
if (args.includes('--no-model')) delete env.WOLF_KEY;
if (!env.WOLF_KEY) console.error('no WOLF_KEY: drawing from facts only (set WOLF_KEY=fi-... for the hosted flisk-wolf)');

const t0 = Date.now();
const built = await buildTower(owner, repo, env);
if (built.error) {
  console.error(`failed: ${built.error}`);
  process.exit(1);
}
writeFileSync(out, renderTower(built.tower, { seed: target }));
writeFileSync(out.replace(/\.svg$/, '.json'), JSON.stringify({ source: built.source, filled: built.filled, dropped: built.dropped, note: built.note, tower: built.tower, facts: built.facts }, null, 2));
console.log(`${target}: ${built.source}; model filled ${built.filled} fields; dropped as ungrounded: ${built.dropped.length ? built.dropped.join(', ') : 'none'}; ${built.note ? `note: ${built.note}; ` : ''}${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
