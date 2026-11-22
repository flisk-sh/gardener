import { expect, test } from 'bun:test';
import worker from '../src/index.js';
import { withSecurityHeaders } from '../src/security-headers.js';

const EXPECTED = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
const expectBaseline = (res) => {
  for (const [k, v] of Object.entries(EXPECTED)) expect(res.headers.get(k)).toBe(v);
  expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://analytics.flisk.si");
};

const call = (path, init) => worker.fetch(new Request(`https://gardener.flisk.si${path}`, init), {});

test('pages, text files, a redirect and a 404 all carry the baseline headers', async () => {
  for (const path of ['/', '/robots.txt', '/sitemap.xml', '/ready', '/icon.svg', '/sample.svg', '/check?repo=owner/repo', '/check?repo=', '/a/b/c/d']) {
    expectBaseline(await call(path));
  }
});

test('a missing header is added, an existing one is kept and nothing is duplicated', () => {
  const res = withSecurityHeaders(new Response('x', { headers: { 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'" } }));
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'self' https://analytics.flisk.si");
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
});

test('an existing frame-ancestors is not changed and the status and body survive', async () => {
  const res = withSecurityHeaders(new Response('body', { status: 404, headers: { 'content-security-policy': "frame-ancestors 'none'" } }));
  expect(res.status).toBe(404);
  expect(await res.text()).toBe('body');
  expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
});
