import { expect, test } from 'bun:test';
import { notFoundPage, page, resultPage } from '../src/page';

const skip = '<a class="skip-link" href="#main">Skip to content</a>';

test('the skip link is the first focusable element in the body', () => {
  const html = page('https://gardener.flisk.si');
  expect(html).toContain(`<body>${skip}`);
  expect(html.indexOf(skip)).toBeLessThan(html.indexOf('<header class="top stage">'));
});

test('every page has a main target for the skip link', () => {
  const pages = [
    page('https://gardener.flisk.si'),
    notFoundPage('https://gardener.flisk.si', '/nope'),
    resultPage('https://gardener.flisk.si', 'owner/repo'),
  ];
  for (const html of pages) {
    expect(html).toContain(skip);
    expect(html).toContain('<main id="main">');
  }
});

test('the skip link is hidden until focused', () => {
  const html = page('https://gardener.flisk.si');
  expect(html).toContain('.skip-link{position:absolute;left:-9999px');
  expect(html).toContain('.skip-link:focus{left:12px;top:12px');
});
