import { expect, test } from 'bun:test';
import worker from '../src/index.js';

const request = (path, options) => worker.fetch(new Request(`https://gardener.flisk.si${path}`, options));

test('unknown well-known paths use the regular 404 response, not a repo page', async () => {
  const response = await request('/.well-known/missing');
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

  const head = await request('/.well-known/missing', { method: 'HEAD', headers: { accept: 'text/html' } });
  expect(head.status).toBe(404);
  expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(await head.text()).toBe('');

  const tower = await request('/octocat/hello-world');
  expect(tower.status).toBe(200);
});
