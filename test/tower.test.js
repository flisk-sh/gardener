import { test, expect } from 'bun:test';
import worker, { _clearMemory, buildTower } from '../src/index.js';
import { loadFacts } from '../src/github.js';
import { fallbackTower, isGrounded, mergeTower, parseTower, supported } from '../src/wolf.js';
import { fit, renderTower, wrap } from '../src/tower.js';

// A tiny fake GitHub: one repo with a workspace layout, a README and a few manifests.
const FILES = {
  'README.md': '# Demo\n\n## Install\n\n## Run\n',
  'package.json': JSON.stringify({ packageManager: 'pnpm@9.1.0', engines: { node: '22.1.0' }, dependencies: { effect: 'catalog:' } }),
  'apps/web/package.json': JSON.stringify({ dependencies: { react: '19.0.0', electron: '44.1.0' } }),
};
const TREE = [
  ...Array.from({ length: 12 }, (_, i) => `apps/web/src/f${i}.ts`),
  'apps/web/src/a.test.ts', 'apps/web/src/b.test.ts', 'apps/server/src/index.ts', 'packages/provider-x/index.ts', 'packages/provider-y/index.ts', 'packages/source-control-z/index.ts',
  'patches/a.patch', 'patches/b.patch', 'native/resource-monitor/main.rs',
].map((path) => ({ type: 'blob', path }));
function fakeFetch(url) {
  const u = String(url);
  const json = (v) => new Response(JSON.stringify(v));
  if (u === 'https://api.github.com/repos/o/r') return json({ default_branch: 'main', description: 'demo', stargazers_count: 5, topics: [] });
  if (u.includes('/git/trees/')) return json({ tree: TREE, truncated: false });
  if (u.endsWith('/languages')) return json({ TypeScript: 9000, Rust: 100 });
  const raw = u.match(/raw\.githubusercontent\.com\/o\/r\/main\/(.+)$/);
  if (raw) return FILES[raw[1]] ? new Response(FILES[raw[1]]) : new Response('', { status: 404 });
  return new Response('', { status: 404 });
}

test('facts are counted from the tree and the manifests', async () => {
  const f = await loadFacts('o', 'r', { fetchImpl: fakeFetch });
  expect(f.counts.files).toBe(TREE.length);
  expect(f.counts.tests).toBe(2);
  expect(f.counts.patches).toBe(2);
  expect(f.counts.nativeDirs).toEqual(['resource-monitor']);
  expect(f.stack.packageManager).toBe('pnpm@9.1.0');
  expect(f.stack.workspaceVersions.electron).toBe('44.1.0');
  expect(f.workspaceGroups.find((g) => g.name === 'provider')?.count).toBe(2);
});

test('a repo that does not exist is a 404, not a tower', async () => {
  const f = await loadFacts('o', 'nope', { fetchImpl: () => new Response('', { status: 404 }) });
  expect(f.error).toBe('not-found');
});

test('numbers must come from the facts', () => {
  const facts = JSON.stringify({ files: 1423, v: '26.12.1' });
  expect(isGrounded('1,423 FILES', facts)).toBe(true);
  expect(isGrounded('NODE 26.12.1', facts)).toBe(true);
  expect(isGrounded('9,999 FILES', facts)).toBe(false);
});

test('an invented number is dropped and the plain fact takes its place', async () => {
  const facts = await loadFacts('o', 'r', { fetchImpl: fakeFetch });
  const model = parseTower(JSON.stringify({ title: 'DEMO', left: { title: 'apps/web', stat: '777,000 FILES' }, neck: { title: `${facts.counts.patches} PATCHES` } }), facts);
  expect(model.left.stat).toBe('');
  expect(model.dropped).toContain('left.stat');
  const { tower } = mergeTower(model, fallbackTower(facts));
  expect(tower.left.stat).toMatch(/FILES/);
  expect(tower.left.stat).not.toContain('777');
  expect(tower.neck.title).toBe('2 PATCHES');
});

test('model output that is not JSON falls back to facts only', async () => {
  const env = { AI: { run: async () => ({ response: 'sorry, I cannot do that' }) } };
  const built = await buildTower('o', 'r', env, { fetchImpl: fakeFetch });
  expect(built.source).toBe('facts-only');
  expect(built.filled).toBe(0);
  expect(renderTower(built.tower)).toContain('<svg');
});

test('a failing model call still yields a tower', async () => {
  const env = { AI: { run: async () => { throw new Error('quota'); } } };
  const built = await buildTower('o', 'r', env, { fetchImpl: fakeFetch });
  expect(built.source).toBe('facts-only');
  expect(built.note).toContain('quota');
});

test('Wolf words are used when they are valid', async () => {
  const env = { AI: { run: async () => ({ response: { title: 'DEMO TOWER', neck: { title: '2 PATCHES', note: 'patches/' }, insets: [{ kind: 'tests', caption: '2 TEST FILES' }, { kind: 'bogus', caption: 'x' }] } }) } };
  const built = await buildTower('o', 'r', env, { fetchImpl: fakeFetch });
  expect(built.source).toContain('wolf');
  expect(built.tower.title).toBe('DEMO TOWER');
  expect(built.tower.insets.map((i) => i.kind)).toEqual(['tests']);
});

test('labels cannot inject markup into the SVG', () => {
  const t = parseTower(JSON.stringify({ title: '<script>alert(1)</script>', crane: { title: 'A"><img src=x onerror=alert(1)>' } }), {}, { grounded: false });
  const svg = renderTower(t);
  expect(svg).not.toContain('<script');
  expect(svg).not.toContain('<img');
  expect(svg).not.toContain('onerror="');
});

test('wrap and fit keep text inside its box', () => {
  expect(wrap('ONE TWO THREE FOUR', 8)).toEqual(['ONE TWO', 'THREE', 'FOUR']);
  const f = fit('A VERY LONG LABEL THAT DOES NOT FIT', 30, 100);
  expect(f.text.length * f.size * 0.58).toBeLessThanOrEqual(110);
});

test('the same repo draws the same tower', () => {
  const t = fallbackTower({ repo: 'o/r', counts: { files: 3, tests: 0, patches: 0, nativeDirs: [], filesByLanguage: [] }, stack: {}, workspaces: [], workspaceGroups: [] });
  expect(renderTower(t, { seed: 'o/r' })).toBe(renderTower(t, { seed: 'o/r' }));
  expect(renderTower(t, { seed: 'o/r' })).not.toBe(renderTower(t, { seed: 'other' }));
});

