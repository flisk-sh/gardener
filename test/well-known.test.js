import { expect, test } from 'bun:test';
import worker from '../src/index.js';

const get = (path, accept = 'text/html') =>
  worker.fetch(new Request('https://gardener.flisk.si' + path, {
    headers: { accept },
  }), {}, { waitUntil() {} });

test('dot-directories are not treated as a repo', async () => {
  for (const path of ['/.well-known/anything', '/.well-known/security.txt', '/.git/config']) {
    const res = await get(path);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain('Page not found');
    expect(body).not.toContain('/.well-known/anything tower');
  }
});

test('an ordinary unknown path still returns 404', async () => {
  const res = await get('/nope.txt');
  expect(res.status).toBe(404);
});

test('a plain Accept header gets a plain 404 for a dot-directory', async () => {
  const res = await get('/.well-known/security.txt', 'text/plain');
  expect(res.status).toBe(404);
  expect(res.headers.get('content-type')).toContain('text/plain');
});
