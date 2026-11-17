import { expect, test } from 'bun:test';
import worker from '../src/index.js';

const request = (path) => worker.fetch(new Request('https://gardener.flisk.si' + path), {});

test('llms.txt describes the site and can be cached', async () => {
  const response = await request('/llms.txt');
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain');
  expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
  expect(body).toContain('# Gardener');
});
