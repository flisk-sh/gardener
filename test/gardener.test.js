import { beforeEach, expect, test } from 'bun:test';
import worker, { _clearMemory } from '../src/index.js';
import { loadFacts } from '../src/github.js';
import { parseTower, supported } from '../src/wolf.js';

const FILES = {
  'README.md': '# Demo\n\nA shop with a database.\n',
  'AGENTS.md': 'Never write to the live database.',
  'package.json': JSON.stringify({ packageManager: 'pnpm@9.1.0', engines: { node: '22.1.0' } }),
  'apps/web/package.json': JSON.stringify({ dependencies: { react: '^19.0.0', electron: '44.1.0' } }),
};
const TREE = [...Array.from({ length: 8 }, (_, i) => `apps/web/src/f${i}.ts`), 'apps/web/a.test.ts', 'patches/a.patch', 'native/gpu/main.rs', 'src/schema.gen.ts', 'apps/b/x.ts', 'apps/c/x.ts'].map((path) => ({ type: 'blob', path }));
let githubCalls = 0;
function fakeFetch(url) {
  const u = String(url);
  githubCalls++;
  const json = (v) => new Response(JSON.stringify(v));
  if (u === 'https://api.github.com/repos/o/r') return json({ default_branch: 'main', description: 'demo', stargazers_count: 5, topics: [] });
  if (u.includes('/git/trees/')) return json({ tree: TREE, truncated: false });
  if (u.endsWith('/languages')) return json({ TypeScript: 9000 });
  const raw = u.match(/raw\.githubusercontent\.com\/o\/r\/main\/(.+)$/);
  if (raw) return FILES[raw[1]] ? new Response(FILES[raw[1]]) : new Response('', { status: 404 });
  return new Response('', { status: 404 });
}
const withGithub = async (fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => fakeFetch(url, init);
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
};
const MODEL_ANSWER = { title: 'DEMO', neck: { title: '1 PATCHES', note: 'patches/' }, red: { title: 'REACT ^19.0.0', note: 'EXACT PIN' }, insets: [{ kind: 'tests', caption: '1 TEST FILES' }, { kind: 'notes', caption: 'TODO/FIXME' }, { kind: 'shark', caption: 'THE LIVE DATABASE' }, { kind: 'bird', caption: 'APP STORE' }, { kind: 'scroll', caption: 'schema.gen.ts' }, { kind: 'tape', caption: 'PATCHED OR VENDORED CODE' }] };
const fakeKv = () => {
  const m = new Map();
  return { m, get: async (k, o) => (m.has(k) ? (o?.type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => void m.set(k, v) };
};
beforeEach(() => {
  _clearMemory();
  githubCalls = 0;
});

test('an inset is kept only when the facts back it', async () => {
  const facts = await withGithub(() => loadFacts('o', 'r', { fetchImpl: fakeFetch }));
  expect(facts.counts.generated).toBe(1);
  expect(supported('tests', facts)).toBe(true);
  expect(supported('notes', facts)).toBe(false);
  expect(supported('shark', facts)).toBe(true); // README and AGENTS.md talk about the database
  expect(supported('bird', facts)).toBe(false);
  expect(supported('scroll', facts)).toBe(true);
  const t = parseTower(JSON.stringify(MODEL_ANSWER), facts);
  expect(t.insets.map((i) => i.kind)).toEqual(['tests', 'shark', 'scroll']);
  expect(t.dropped.join('|')).toContain('insets.notes');
  expect(t.dropped.join('|')).toContain('insets.tape (echoes the prompt)');
  expect(t.dropped.join('|')).toContain('insets.bird (facts do not support it)');
});

test('a ^ range is not called a pin', async () => {
  const facts = await withGithub(() => loadFacts('o', 'r', { fetchImpl: fakeFetch }));
  const t = parseTower(JSON.stringify({ red: { title: 'REACT ^19.0.0', note: 'EXACT PIN' } }), facts);
  expect(t.red.title).toBe('REACT ^19.0.0');
  expect(t.red.note).toBe('');
  expect(t.dropped.join('|')).toContain('not a pin');
});

test('home, check, repo page, static files', async () => {
  expect((await worker.fetch(new Request('https://g.example/'), {})).status).toBe(200);
  const home = await (await worker.fetch(new Request('https://g.example/'), {})).text();
  expect(home).toContain('Grow a dependency tower');
  expect(home).toContain('/sample.svg');
  const redirect = await worker.fetch(new Request('https://g.example/check?repo=https://github.com/o/r/tree/main'), {});
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe('/o/r');
  expect((await worker.fetch(new Request('https://g.example/check?repo=nonsense'), {})).status).toBe(400);
  const page = await (await worker.fetch(new Request('https://g.example/o/r'), {})).text();
  expect(page).toContain('.svg?wait=1');
  expect(page).toContain('Dependency tower of o/r');
  expect((await worker.fetch(new Request('https://g.example/sample.svg'), {})).headers.get('content-type')).toContain('svg');
  expect((await worker.fetch(new Request('https://g.example/icon.svg'), {})).status).toBe(200);
  expect((await worker.fetch(new Request('https://g.example/robots.txt'), {})).status).toBe(200);
  expect((await worker.fetch(new Request('https://g.example/nope'), {})).status).toBe(404);
});

test('a repo name cannot carry markup or path tricks', async () => {
  expect((await worker.fetch(new Request('https://g.example/..%2Fx/r.svg'), {})).status).toBe(400);
  const page = await (await worker.fetch(new Request('https://g.example/o/%3Cscript%3E'), {})).text();
  expect(page).not.toContain('<script>alert');
});

test('without a KV the tower is grown on the request, cached, and its labels are readable', async () => {
  await withGithub(async () => {
    const env = { AI: { run: async () => ({ response: MODEL_ANSWER }) } };
    const before = await worker.fetch(new Request('https://g.example/o/r.json'), env);
    expect(before.status).toBe(404);
    const svg = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), env);
    expect(svg.status).toBe(200);
    expect(svg.headers.get('x-gardener-source')).toContain('wolf');
    const calls = githubCalls;
    const again = await worker.fetch(new Request('https://g.example/o/r.svg'), env);
    expect(again.status).toBe(200);
    expect(githubCalls).toBe(calls); // served from the cache
    const json = await (await worker.fetch(new Request('https://g.example/o/r.json'), env)).json();
    expect(json.repo).toBe('o/r');
    expect(json.svg).toBeUndefined();
    expect(json.dropped.length).toBeGreaterThan(0);
  });
});

test('a README image gets a placeholder at once while the tower grows in the background', async () => {
  await withGithub(async () => {
    const kv = fakeKv();
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    const env = { KV: kv, AI: { run: async () => ({ response: MODEL_ANSWER }) } };
    const first = await worker.fetch(new Request('https://g.example/o/r.svg'), env, ctx);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('growing this tower');
    expect(first.headers.get('cache-control')).toContain('max-age=20');
    expect(waits.length).toBe(1);
    await worker.fetch(new Request('https://g.example/o/r.svg'), env, ctx); // while it grows: no second job
    expect(waits.length).toBe(1);
    await Promise.all(waits);
    const done = await worker.fetch(new Request('https://g.example/o/r.svg'), env, ctx);
    expect(await done.text()).toContain('<g filter');
    expect([...kv.m.keys()].some((k) => k.startsWith('tower:'))).toBe(true);
  });
});

test('over the daily cap the tower is still drawn, from facts only, without calling the model', async () => {
  await withGithub(async () => {
    let modelCalls = 0;
    const kv = fakeKv();
    const day = new Date().toISOString().slice(0, 10);
    kv.m.set(`cap:${day}`, '200');
    const env = { KV: kv, AI: { run: async () => { modelCalls++; return { response: MODEL_ANSWER }; } } };
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1', { headers: { 'cf-connecting-ip': '1.2.3.4' } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-gardener-source')).toBe('facts-only');
    expect(modelCalls).toBe(0);
  });
});

test('one visitor is limited per hour', async () => {
  await withGithub(async () => {
    let modelCalls = 0;
    const kv = fakeKv();
    const env = { KV: kv, IP_HOURLY: '1', AI: { run: async () => { modelCalls++; return { response: MODEL_ANSWER }; } } };
    const headers = { 'cf-connecting-ip': '9.9.9.9' };
    await worker.fetch(new Request('https://g.example/o/r.svg?wait=1', { headers }), env);
    _clearMemory();
    for (const k of [...kv.m.keys()].filter((k) => k.startsWith('tower:'))) kv.m.delete(k);
    await worker.fetch(new Request('https://g.example/o/r.svg?wait=1', { headers }), env);
    expect(modelCalls).toBe(1);
  });
});

test('an unknown repo is a 404, not a tower', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => new Response('', { status: 404 });
  try {
    expect((await worker.fetch(new Request('https://g.example/o/missing.svg?wait=1'), {})).status).toBe(404);
  } finally {
    globalThis.fetch = real;
  }
});

test('a GitHub rate limit is not reported as a missing repo', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => new Response('{"message":"API rate limit exceeded"}', { status: 403 });
  try {
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), {});
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('limiting requests');
  } finally {
    globalThis.fetch = real;
  }
});

test('a daily cap of 0 never calls the model', async () => {
  await withGithub(async () => {
    let modelCalls = 0;
    const kv = fakeKv();
    const env = { KV: kv, DAILY_MODEL_CAP: '0', AI: { run: async () => { modelCalls++; return { response: MODEL_ANSWER }; } } };
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-gardener-source')).toBe('facts-only');
    expect(modelCalls).toBe(0);
  });
});
