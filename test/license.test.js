import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const license = readFileSync(resolve(root, 'LICENSE'), 'utf8');

test('README ends with a License section that links to the MIT LICENSE file', () => {
  expect(readme.trimEnd()).toMatch(/\r?\n## License\r?\n\r?\nMIT, see \[LICENSE\]\(LICENSE\)\.\s*$/);
  expect(license).toContain('MIT License');
});
