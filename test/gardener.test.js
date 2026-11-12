import { beforeEach, expect, test } from 'bun:test';
import worker, { _clearMemory } from '../src/index.js';
import { loadFacts } from '../src/github.js';
import { fallbackTower, parseTower, supported } from '../src/wolf.js';
import { renderTower } from '../src/tower.js';

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

test('crawlers get the home page and nothing else', async () => {
  const robots = await (await worker.fetch(new Request('https://g.example/robots.txt'), {})).text();
  expect(robots).toContain('Allow: /$');
  expect(robots).toContain('Disallow: /\n');
  const page = await (await worker.fetch(new Request('https://g.example/o/r'), {})).text();
  expect(page).toContain('noindex,nofollow');
  expect(await (await worker.fetch(new Request('https://g.example/'), {})).text()).not.toContain('noindex');
});

test('when KV fails (free-tier limit) the site still answers', async () => {
  await withGithub(async () => {
    const broken = { get: async () => { throw new Error('KV get() limit exceeded'); }, put: async () => { throw new Error('KV put() limit exceeded'); } };
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), { KV: broken });
    expect(res.status).toBe(200);
    const bg = await worker.fetch(new Request('https://g.example/o/r2.svg'), { KV: broken }, { waitUntil() {} });
    expect(bg.status).toBe(200);
  });
});

test('past the daily growing cap nothing is fetched and the answer is cheap', async () => {
  await withGithub(async () => {
    const kv = fakeKv();
    kv.m.set(`gen:${new Date().toISOString().slice(0, 10)}`, '100');
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), { KV: kv });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('try again tomorrow');
    expect(githubCalls).toBe(0);
  });
});

test('a huge tree is cut, so a request stays inside the free CPU limit', async () => {
  const big = Array.from({ length: 50_000 }, (_, i) => ({ type: 'blob', path: `apps/web/f${i}.ts` }));
  const f = await loadFacts('o', 'r', { fetchImpl: (u) => (String(u).includes('/git/trees/') ? new Response(JSON.stringify({ tree: big })) : fakeFetch(u)) });
  expect(f.counts.files).toBe(30_000);
  expect(f.treeTruncated).toBe(true);
});

// GitHub's API refuses (403), jsDelivr lists the files, raw serves the README and the manifests.
function limitedGithub(url) {
  const u = String(url);
  if (u.startsWith('https://api.github.com/')) return new Response('{"message":"API rate limit exceeded"}', { status: 403 });
  if (u.startsWith('https://data.jsdelivr.com/v1/packages/gh/o/r@HEAD')) {
    return new Response(JSON.stringify({ files: [{ name: '/apps/web/a.ts', size: 9000 }, { name: '/apps/web/a.test.ts', size: 100 }, { name: '/patches/x.patch', size: 5 }, { name: '/native/gpu/m.rs', size: 400 }, { name: '/README.md', size: 50 }] }));
  }
  if (u.startsWith('https://data.jsdelivr.com/')) return new Response('{}', { status: 404 });
  const raw = u.match(/raw\.githubusercontent\.com\/o\/r\/HEAD\/(.+)$/);
  if (raw) return FILES[raw[1]] ? new Response(FILES[raw[1]]) : new Response('', { status: 404 });
  return new Response('', { status: 404 });
}

test('when GitHub refuses, the file list comes from jsDelivr and the tower is still grown', async () => {
  const facts = await loadFacts('o', 'r', { fetchImpl: limitedGithub });
  expect(facts.source).toBe('jsdelivr');
  expect(facts.counts.files).toBe(5);
  expect(facts.counts.tests).toBe(1);
  expect(facts.counts.patches).toBe(1);
  expect(facts.counts.nativeDirs).toEqual(['gpu']);
  expect(facts.languages.map((l) => l.name)).toEqual(['TypeScript', 'Rust']);
  expect(facts.stars).toBeNull();
  expect(facts.stack.packageManager).toBe('pnpm@9.1.0');
  // jsDelivr cuts big repos' file lists, so the plain tower writes lower bounds
  const t = fallbackTower(facts);
  expect(t.foundation.text).toBe('5+ FILES');
  expect(t.neck.title).toBe('1+ PATCHES');
  expect(t.insets.find((i) => i.kind === 'tests').caption).toBe('1+ TEST FILES');

  const real = globalThis.fetch;
  globalThis.fetch = (url) => limitedGithub(url);
  try {
    const res = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), {});
    expect(res.status).toBe(200);
    const json = await (await worker.fetch(new Request('https://g.example/o/r.json'), {})).json();
    expect(json.note).toContain('jsDelivr');
  } finally {
    globalThis.fetch = real;
  }
});

test('with GitHub refusing and jsDelivr saying 404 the repo does not exist', async () => {
  const f = await loadFacts('o', 'nope', { fetchImpl: limitedGithub });
  expect(f.error).toBe('not-found');
});

test('with GitHub and jsDelivr both failing it is a rate limit, not a missing repo', async () => {
  const f = await loadFacts('o', 'r', { fetchImpl: () => new Response('', { status: 403 }) });
  expect(f.error).toBe('github-rate-limited');
});

test('hidden folders do not use up the path cap, so apps/ and packages/ are still counted', async () => {
  const tree = [...Array.from({ length: 35_000 }, (_, i) => ({ type: 'blob', path: `.repos/effect/f${i}.ts` })), ...Array.from({ length: 300 }, (_, i) => ({ type: 'blob', path: `apps/server/f${i}.ts` }))];
  const f = await loadFacts('o', 'r', { fetchImpl: (u) => (String(u).includes('/git/trees/') ? new Response(JSON.stringify({ tree })) : fakeFetch(u)) });
  expect(f.counts.files).toBe(300);
  expect(f.workspaces).toEqual([{ name: 'apps/server', files: 300 }]);
  expect(f.topLevel[0]).toEqual({ name: 'apps', files: 300 });
});

test('the plain tower stands on its own for a repo without apps/ and packages/', () => {
  const facts = {
    repo: 'o/cli', source: 'jsdelivr', stars: null, agentsFile: 'Never edit generated files by hand. Run the tests.',
    counts: { files: 300, tests: 40, patches: 0, generated: 4, nativeDirs: [], filesByLanguage: [['TypeScript', 200], ['Markdown', 60]] },
    workspaces: [], workspaceCount: 0, workspaceGroups: [],
    topLevel: [{ name: 'docs', files: 120 }, { name: 'cli', files: 100 }, { name: 'tests', files: 40 }, { name: '(root)', files: 5 }],
    stack: { packageManager: null, engines: { node: '>=22' }, rootDependencies: ['commander@^15', 'chalk@^6', 'react@^19', 'ink@^8', 'typescript@5'], workspaceVersions: {}, scripts: ['build', 'dev'], lockfile: 'bun' },
    readme: { headings: [], firstCommand: 'npx o/cli demo', excerpt: '' },
  };
  const t = fallbackTower(facts);
  expect(t.left).toMatchObject({ title: 'docs/', stat: '120+ FILES' });
  expect(t.right).toMatchObject({ title: 'cli/', stat: '100+ FILES' });
  expect(t.middle.title).toBe('3 TOP-LEVEL DIRS');
  expect(t.core.title).toBe('REACT');
  expect(t.runtime).toMatchObject({ bar: 'NODE >=22', tool: 'bun', toolNote: 'LOCKFILE' });
  expect(t.upper.plank).toBe('bun run dev');
  expect(t.crane.title).toBe('AI AGENTS');
  expect(t.braces.right).toBe('SOMEONE TYPING npx o/cli demo');
  expect(t.insets.map((i) => i.kind)).toEqual(['tests', 'scroll', 'nosign', 'tiny']);
  expect(t.insets.find((i) => i.kind === 'nosign').caption).toContain('NEVER EDIT GENERATED');
  expect(renderTower(t)).toContain('docs/');
});

test('from jsDelivr every count the model wrote becomes a lower bound', () => {
  const facts = { source: 'jsdelivr', counts: { files: 517, tests: 536, generated: 7 }, stack: { rootDependencies: ['commander@^15.0.0'], workspaceVersions: {} }, workspaces: [{ name: 'cli', files: 517 }] };
  const t = parseTower(JSON.stringify({ left: { title: 'cli', stat: '517 FILES' }, insets: [{ kind: 'tests', caption: '536 TEST FILES' }], middle: { title: '5 WORKSPACES' } }), { ...facts, counts: { ...facts.counts, tests: 536 } });
  expect(t.left.stat).toBe('517+ FILES');
  expect(t.insets[0].caption).toBe('536+ TEST FILES');
  const exact = parseTower(JSON.stringify({ left: { title: 'cli', stat: '517 FILES' } }), { ...facts, source: 'github' });
  expect(exact.left.stat).toBe('517 FILES');
});

test('a dependency the repo ranges with ^ is never called pinned', () => {
  const facts = { source: 'github', counts: { files: 5 }, stack: { rootDependencies: ['commander@^15.0.0'], workspaceVersions: {} } };
  const t = parseTower(JSON.stringify({ neck: { title: 'COMMANDER 15.0.0', note: 'PINNED FOR CLI' }, red: { title: 'COMMANDER 15.0.0', note: 'PINNED' } }), facts);
  expect(t.neck.note).toBe('');
  expect(t.red.note).toBe('');
  expect(t.dropped.join('|')).toContain('not a pin');
});

test('the neck and the red label are never the same words', () => {
  const t = parseTower(JSON.stringify({ neck: { title: '33 PATCHES' }, red: { title: '33 PATCHES' } }), { counts: { patches: 33 } });
  expect(t.neck.title).toBe('33 PATCHES');
  expect(t.red.title).toBe('');
});

test('a plain-facts tower is cached for minutes, a model-written one for a day, and the page asks with the version', async () => {
  await withGithub(async () => {
    const plain = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), {});
    expect(plain.headers.get('cache-control')).toContain('max-age=300');
    _clearMemory();
    const model = await worker.fetch(new Request('https://g.example/o/r.svg?wait=1'), { AI: { run: async () => ({ response: MODEL_ANSWER }) } });
    expect(model.headers.get('cache-control')).toContain('s-maxage=86400');
    const page = await (await worker.fetch(new Request('https://g.example/o/r'), {})).text();
    expect(page).toMatch(/\.svg\?wait=1&v='\+version/);
    expect(page).toContain('version="v');
  });
});

test('the plain tower picks a well-known library, never the owner\'s own package, and flags an exact pin', () => {
  const facts = {
    repo: 'apify/apify-sdk-js', source: 'ungh', stars: 186, pushedAt: '2026-11-11T00:55:19Z', hints: ['DOCKER'], agentsFile: null,
    counts: { files: 1085, tests: 46, patches: 1, generated: 0, nativeDirs: [], filesByLanguage: [['TypeScript', 600]] },
    workspaces: [], workspaceCount: 0, workspaceGroups: [],
    topLevel: [{ name: 'website', files: 922 }, { name: 'docs', files: 76 }, { name: 'test', files: 42 }, { name: 'patches', files: 1 }],
    stack: { packageManager: 'pnpm@12.18.0', engines: { node: '>=22.13.0' }, rootDependencies: ['@apify/consts@^3.0.1', 'apify-client@^3.0.0', 'minimatch@^10.0.0', 'crawlee@4.0.0-rc.2', 'typescript@^5.9.0', 'vitest@^4.0.0'], workspaceVersions: {}, scripts: ['prepare', 'build', 'test'], lockfile: 'pnpm' },
    readme: { headings: [], firstCommand: 'npm install apify', excerpt: 'Apify SDK for JavaScript.' },
  };
  const t = fallbackTower(facts);
  expect(t.core).toMatchObject({ title: 'CRAWLEE', note: '4.0.0-rc.2 (EXACT PIN)' });
  expect(t.core.title).not.toContain('APIFY');
  expect(t.left).toMatchObject({ title: 'website/', stat: '922 FILES', note: '85% OF THE FILES' });
  expect(t.badge).toBe('186 STARS');
  expect(t.cloud).toEqual({ word: 'docker', label: 'DOCKER (IN THE REPO)' });
  expect(t.upper.plank).toBe('pnpm run build');
  expect(t.crane.title).toBe(''); // nothing in the README or an AGENTS file about agents
  expect(t.neck.title).toBe('1 PATCH');
  expect(t.insets.map((i) => i.kind)).toEqual(['tests', 'tiny']); // one patch file is not a drawing of its own
});

test('from ungh the counts are exact, with stars and description', async () => {
  const f = await loadFacts('o', 'r', { fetchImpl: (u) => {
    const x = String(u);
    if (x.startsWith('https://api.github.com/')) return new Response('{}', { status: 403 });
    if (x === 'https://ungh.cc/repos/o/r') return new Response(JSON.stringify({ repo: { description: 'demo', stars: 12, pushedAt: '2026-11-01T00:00:00Z', defaultBranch: 'main' } }));
    if (x === 'https://ungh.cc/repos/o/r/files/HEAD') return new Response(JSON.stringify({ files: [{ path: 'apps/web/a.ts', size: 100 }, { path: 'apps/web/a.test.ts', size: 10 }, { path: '.github/workflows/ci.yml', size: 5 }] }));
    return fakeFetch(x.replace('/HEAD/', '/main/'));
  } });
  expect(f.source).toBe('ungh');
  expect(f.stars).toBe(12);
  expect(f.pushedAt).toBe('2026-11-01T00:00:00Z');
  expect(f.hints).toEqual(['GITHUB ACTIONS']);
  expect(f.counts.files).toBe(2); // the hidden .github folder is not the product
  expect(fallbackTower(f).foundation.text).toBe('2 FILES'); // exact: no +
});

test('a package name the facts do not contain is dropped', () => {
  const facts = { counts: {}, stack: { rootDependencies: ['crawlee@4.0.0-rc.2'], workspaceVersions: {} }, workspaces: [{ name: 'website', files: 9 }] };
  const t = parseTower(JSON.stringify({ core: { title: '@crawlee/core', disc: 'crawlee' }, red: { title: 'crawlee 4.0.0-rc.2' }, left: { title: 'website' }, right: { title: 'made-up' } }), facts);
  expect(t.core.title).toBe('');
  expect(t.core.disc).toBe('crawlee');
  expect(t.red.title).toBe('crawlee 4.0.0-rc.2');
  expect(t.left.title).toBe('website');
  expect(t.right.title).toBe('');
  expect(t.dropped.join('|')).toContain('core.title (the name is not in the facts)');
});
