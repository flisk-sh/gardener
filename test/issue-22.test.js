import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('README links to the MIT license', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  expect(readme).toMatch(/^## License\n\n\[MIT\]\(LICENSE\)\s*$/m);
  expect(license).toContain("MIT License");
});
