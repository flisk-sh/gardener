import { expect, test } from 'bun:test';
import worker from '../src/index.js';
import { page } from '../src/page.js';

const origin = 'https://gardener.flisk.si';

test('the page declares an absolute og:image and twitter:image', () => {
  const html = page(origin);
  expect(html).toContain('<meta property="og:image" content="https://gardener.flisk.si/og.png">');
  expect(html).toContain('<meta property="og:image:width" content="1200">');
  expect(html).toContain('<meta property="og:image:height" content="630">');
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain('<meta name="twitter:image" content="https://gardener.flisk.si/og.png">');
});

test('GET /og.png returns a cached 1200x630 PNG under 200 KB', async () => {
  const res = await worker.fetch(new Request(`${origin}/og.png`), {});
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toContain('max-age=31536000');
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeLessThan(200 * 1024);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(16)).toBe(1200);
  expect(view.getUint32(20)).toBe(630);
});
