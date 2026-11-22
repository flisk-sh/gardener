import { expect, test } from 'bun:test';
import worker from '../src/index.js';

const request = (path) => worker.fetch(new Request('https://gardener.flisk.si' + path), {});

test('robots.txt is publicly cached', async () => {
  const response = await request('/robots.txt');
  expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(await response.text()).toContain('User-agent:');
});
