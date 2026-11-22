import { expect, test } from 'bun:test';
import worker from '../src/index.js';

test('home can be cached and revalidated without sending the page again', async () => {
  const get = (init) => worker.fetch(new Request('https://gardener.flisk.si/', init));
  const response = await get();
  const tag = response.headers.get('etag');
  expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  expect(tag).toMatch(/^"[a-f0-9]{64}"$/);
  expect(await response.text()).toContain('<main');
  const cached = await get({ headers: { 'If-None-Match': '"other", W/' + tag } });
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe('');
  const head = await get({ method: 'HEAD' });
  expect(head.headers.get('etag')).toBe(tag);
  expect(await head.text()).toBe('');
});
