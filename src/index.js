import { loadFacts, validRepo } from './github.js';
import { askWolf, buildMessages, fallbackTower, mergeTower, parseTower } from './wolf.js';
import { renderTower } from './tower.js';
import { parseRepoInput } from './repo-input.js';
import { ICON, page, resultPage } from './page.js';
import SAMPLE from './sample.js';

// Bump when the prompt or the drawing changes: it is part of the cache key, so old towers are not served for a week.
export const VERSION = 'v1';
const SVG = { 'content-type': 'image/svg+xml; charset=utf-8', 'access-control-allow-origin': '*' };
const TTL_WOLF = 7 * 86400;
const TTL_PLAIN = 3600;

// facts (code) -> labels (Wolf) -> checked and merged with plain facts (code). No drawing here.
export async function buildTower(owner, repo, env = {}, { fetchImpl = fetch } = {}) {
  const facts = await loadFacts(owner, repo, { fetchImpl, token: env.GITHUB_TOKEN });
  if (facts.error) return { error: facts.error, status: facts.status };
  const plain = fallbackTower(facts);
  let source = 'facts-only';
  let model = null;
  let note = '';
  try {
    const answer = await askWolf(buildMessages(facts), env, fetchImpl);
    if (answer.text) {
      model = parseTower(answer.text, facts);
      source = model ? `wolf (${answer.via})` : 'facts-only';
      if (!model) note = 'the model did not return usable JSON';
    } else {
      note = answer.error === 'no-model' ? '' : answer.error || '';
    }
  } catch (e) {
    note = `model call failed: ${String(e?.message || e).slice(0, 120)}`;
  }
  const { tower, filled } = mergeTower(model, plain);
  return { facts, tower, source, filled, dropped: tower.dropped || [], note };
}

// ---- limits: the model is the expensive part, so it is capped per day and per visitor. Over a cap the tower is still drawn, from facts only.
async function allowModel(env, ip) {
  if (!env.KV) return true;
  const now = new Date().toISOString();
  const dailyKey = `cap:${now.slice(0, 10)}`;
  const ipKey = `ip:${ip}:${now.slice(0, 13)}`;
  const [d, i] = await Promise.all([env.KV.get(dailyKey), env.KV.get(ipKey)]);
  if (Number(d || 0) >= Number(env.DAILY_MODEL_CAP || 200) || Number(i || 0) >= Number(env.IP_HOURLY || 6)) return false;
  await Promise.all([env.KV.put(dailyKey, String(Number(d || 0) + 1), { expirationTtl: 172800 }), env.KV.put(ipKey, String(Number(i || 0) + 1), { expirationTtl: 7200 })]);
  return true;
}

// ---- cache: one entry per repo (KV in production, memory in dev and tests)
const memory = new Map();
const cacheKey = (repo) => `tower:${VERSION}:${repo.toLowerCase()}`;
async function getEntry(env, repo) {
  if (env.KV) return env.KV.get(cacheKey(repo), { type: 'json' });
  return memory.get(cacheKey(repo)) || null;
}
async function putEntry(env, repo, entry) {
  const ttl = entry.source.startsWith('wolf') ? TTL_WOLF : TTL_PLAIN;
  if (env.KV) await env.KV.put(cacheKey(repo), JSON.stringify(entry), { expirationTtl: ttl });
  else memory.set(cacheKey(repo), entry);
}
export const _clearMemory = () => memory.clear();

export async function grow(owner, repo, env, { ip = 'unknown', fetchImpl = fetch } = {}) {
  const useModel = await allowModel(env, ip);
  const built = await buildTower(owner, repo, useModel ? env : { GITHUB_TOKEN: env.GITHUB_TOKEN }, { fetchImpl });
  if (built.error) return built;
  const entry = {
    repo: `${owner}/${repo}`,
    svg: renderTower(built.tower, { seed: `${owner}/${repo}` }),
    source: built.source,
    filled: built.filled,
    dropped: built.dropped,
    note: useModel ? built.note : 'the model limit is reached for now: plain facts only',
    tower: built.tower,
    at: new Date().toISOString(),
  };
  await putEntry(env, `${owner}/${repo}`, entry);
  return { entry };
}

const placeholder = (repo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 260" width="900" height="260" role="img" aria-label="Gardener is growing the tower of ${repo.replace(/[^\w./-]/g, '')}"><rect width="900" height="260" fill="#fbfaf7"/><g font-family="Chalkboard SE, Marker Felt, Comic Sans MS, sans-serif" text-anchor="middle" fill="#222"><text x="450" y="110" font-size="34">Gardener is growing this tower</text><text x="450" y="160" font-size="22">${repo.replace(/[^\w./-]/g, '')}</text><text x="450" y="205" font-size="18" fill="#66635c">reload in about a minute</text></g></svg>`;

const svgResponse = (entry) => new Response(entry.svg, { headers: { ...SVG, 'cache-control': 'public, max-age=3600, s-maxage=86400', 'x-gardener-source': entry.source, 'x-gardener-fields-from-model': String(entry.filled) } });
const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /render\nDisallow: /check\n\nSitemap: https://gardener.flisk.si/sitemap.xml\n';
export const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://gardener.flisk.si/</loc></url></urlset>\n';

export default {
  async fetch(request, env = {}, ctx = { waitUntil() {} }) {
    const url = new URL(request.url);
    const origin = env.PUBLIC_ORIGIN || url.origin;
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const get = request.method === 'GET' || request.method === 'HEAD';

    if (url.pathname === '/ready') return text('ok');
    if (url.pathname === '/' && get) return html(page(origin));
    if (url.pathname === '/robots.txt') return text(ROBOTS);
    if (url.pathname === '/sitemap.xml') return new Response(SITEMAP, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
    if (url.pathname === '/icon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    if (url.pathname === '/sample.svg') return new Response(SAMPLE, { headers: { ...SVG, 'cache-control': 'public, max-age=86400' } });

    if (url.pathname === '/check' && get) {
      const raw = url.searchParams.get('repo') || '';
      const repo = parseRepoInput(raw);
      if (!repo) return html(page(origin, { error: 'Enter a GitHub repo like owner/repo or paste its URL.', value: raw.slice(0, 200) }), 400);
      return new Response(null, { status: 302, headers: { location: `/${repo}`, 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/render' && request.method === 'POST') {
      const body = await request.text();
      if (body.length > 20_000) return text('too large', 413);
      const tower = parseTower(body, {}, { grounded: false });
      if (!tower) return text('send a tower as JSON', 400);
      return new Response(renderTower(tower), { headers: SVG });
    }

    const m = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.(svg|json))?$/);
    if (!m || !get) return text('not found', 404);
    const [, owner, repo, ext] = m;
    if (!validRepo(owner, repo)) return text('not a GitHub repo name', 400);
    const full = `${owner}/${repo}`;

    if (!ext) return html(resultPage(origin, full));

    if (ext === 'json') {
      const entry = await getEntry(env, full);
      if (!entry) return text('not grown yet: open the repo page first', 404);
      const { svg, ...rest } = entry;
      return new Response(JSON.stringify(rest, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }

    const cached = await getEntry(env, full);
    if (cached) return svgResponse(cached);

    // The repo page asks with ?wait=1 and waits for the tower. A README <img> must not wait: growing takes up to half a minute,
    // longer than image proxies wait. It gets a placeholder while the tower grows in the background.
    const wait = url.searchParams.get('wait') === '1' || !env.KV;
    if (!wait) {
      const pendingKey = `pending:${VERSION}:${full.toLowerCase()}`;
      if (!(await env.KV.get(pendingKey))) {
        await env.KV.put(pendingKey, '1', { expirationTtl: 120 });
        ctx.waitUntil(grow(owner, repo, env, { ip }).catch(() => {}));
      }
      return new Response(placeholder(full), { headers: { ...SVG, 'cache-control': 'public, max-age=20' } });
    }
    const grown = await grow(owner, repo, env, { ip });
    if (grown.error) return text(grown.error === 'not-found' ? 'repo not found' : 'GitHub error', grown.status || 502);
    return svgResponse(grown.entry);
  },
};
