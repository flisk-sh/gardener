// Local runner: bun scripts/make.mjs owner/repo [--out tower.svg] [--no-model]
// Model: WOLF_KEY (hosted flisk-wolf at inference.flisk.si), else Workers AI through the account wrangler is logged in to.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTower } from '../src/index.js';
import { renderTower } from '../src/tower.js';

const args = process.argv.slice(2);
const target = args.find((a) => /^[\w.-]+\/[\w.-]+$/.test(a));
if (!target) {
  console.error('usage: bun scripts/make.mjs owner/repo [--out file.svg] [--no-model]');
  process.exit(2);
}
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : `${target.replace('/', '-')}.svg`;

function workersAiShim() {
  const cfg = readFileSync(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const token = cfg.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
  if (!token) throw new Error('wrangler is not logged in: run `bunx wrangler@4 login`');
  // `wrangler whoami` also refreshes an expired OAuth token. The account id is the only thing read from its output.
  const who = execFileSync('bunx', ['wrangler@4', 'whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || who.match(/\b[0-9a-f]{32}\b/)?.[0];
  const fresh = readFileSync(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)?.[1] || token;
  return {
    run: async (model, input) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: 'POST', headers: { authorization: `Bearer ${fresh}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
      const j = await r.json();
      if (!j.success) throw new Error(j.errors?.[0]?.message || `Workers AI ${r.status}`);
      return j.result;
    },
  };
}

const [owner, repo] = target.split('/');
const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, WOLF_KEY: process.env.WOLF_KEY, WOLF_URL: process.env.WOLF_URL };
if (!args.includes('--no-model') && !env.WOLF_KEY) env.AI = workersAiShim();

const t0 = Date.now();
const built = await buildTower(owner, repo, env);
if (built.error) {
  console.error(`failed: ${built.error}`);
  process.exit(1);
}
writeFileSync(out, renderTower(built.tower, { seed: target }));
writeFileSync(out.replace(/\.svg$/, '.json'), JSON.stringify({ source: built.source, filled: built.filled, dropped: built.dropped, note: built.note, tower: built.tower, facts: built.facts }, null, 2));
console.log(`${target}: ${built.source}; model filled ${built.filled} fields; dropped as ungrounded: ${built.dropped.length ? built.dropped.join(', ') : 'none'}; ${built.note ? `note: ${built.note}; ` : ''}${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
