import { expect, test } from 'bun:test';
import { problemOf, sendTrace, traced } from '../src/trace.js';

test('a normal request writes nothing; refused, failed and slow ones are one row', () => {
  expect(problemOf('https://x/a/b', 200, 100)).toBeNull();
  expect(problemOf('https://x/a/b', 404, 100)).toBeNull();
  expect(problemOf('https://x/owner/repo', 429, 5)).toMatchObject({ route: '/owner', kind: 'capped' });
  expect(problemOf('https://x/api/y', 502, 5)).toMatchObject({ route: '/api', kind: 'error', status: 502 });
  expect(problemOf('https://x/', 200, 1e9)).toMatchObject({ route: '/', kind: 'slow' });
});

test('traced keeps the answer, sends one row for a problem, and rethrows', async () => {
  const sent = [];
  const env = { TRACE_KEY: 'k', TRACES: { fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); } } };
  const ok = traced(async () => new Response('fine'));
  expect(await (await ok(new Request('https://x/a'), env)).text()).toBe('fine');
  expect(sent).toEqual([]);
  const bad = traced(async () => new Response('no', { status: 503 }));
  expect((await bad(new Request('https://x/a'), env)).status).toBe(503);
  expect(sent).toHaveLength(1);
  const boom = traced(async () => { throw new Error('oops'); });
  await expect(boom(new Request('https://x/a'), env)).rejects.toThrow('oops');
  expect(sent[1]).toMatchObject({ kind: 'error' });
});

test('sendTrace does nothing without a key and never throws', async () => {
  let n = 0;
  await sendTrace({}, { kind: 'error' }, async () => { n++; });
  expect(n).toBe(0);
  await sendTrace({ TRACE_KEY: 'k' }, { kind: 'error' }, async () => { throw new Error('down'); });
});
