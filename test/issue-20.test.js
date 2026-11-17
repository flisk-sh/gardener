import { expect, test } from 'bun:test';
import worker from '../src/index.js';

const request = (path) => worker.fetch(new Request('https://gardener.flisk.si' + path), {});

test('the first body link targets the focusable main landmark', async () => {
  const body = await (await request('/')).text();
  expect(body).toMatch(/<body>\s*<a class="skip-link" href="#main-content">Skip to content<\/a>/);
  expect(body).toContain('<main id="main-content" tabindex="-1">');
  expect(body).toContain('.skip-link:focus{transform:none}');
});
