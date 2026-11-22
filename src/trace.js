// Sends a problem to traces.flisk.si (flisk-sh/traces): only a refused (429), failed (5xx), thrown or slow request. A normal request writes nothing.
// Never throws, never waits more than 2 s, does nothing until TRACE_KEY is set, and sends no name, prompt, answer or key: the route is the first path part only.
export const SLOW_MS = 15_000;

export async function sendTrace(env, event, fetchImpl = fetch) {
  if (!env?.TRACE_KEY) return;
  try {
    const init = { method: 'POST', headers: { authorization: `Bearer ${env.TRACE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000) };
    if (env.TRACES) await env.TRACES.fetch('https://traces.flisk.si/v1/trace', init);
    else await fetchImpl('https://traces.flisk.si/v1/trace', init);
  } catch { /* tracing must never break a request */ }
}

const routeOf = (url) => `/${new URL(url).pathname.split('/')[1] || ''}`;
export function problemOf(url, status, ms) {
  const route = routeOf(url);
  if (status === 429) return { route, kind: 'capped', why: 'a request was refused by a limit', status, ms };
  if (status >= 500) return { route, kind: 'error', why: `a request failed with ${status}`, status, ms };
  if (ms > SLOW_MS) return { route, kind: 'slow', why: `a request took ${Math.round(ms / 1000)} s`, status, ms };
  return null;
}

// Wraps a Worker's fetch: the answer is unchanged; a problem becomes one row, sent after the answer.
export function traced(fetchFn) {
  return async (request, env, ctx) => {
    const started = Date.now();
    let res;
    try {
      res = await fetchFn(request, env, ctx);
    } catch (e) {
      const t = sendTrace(env, { route: routeOf(request.url), kind: 'error', why: `the Worker threw: ${String(e?.message || e).slice(0, 150)}`, ms: Date.now() - started });
      if (ctx?.waitUntil) ctx.waitUntil(t); else await t;
      throw e;
    }
    const p = problemOf(request.url, res.status, Date.now() - started);
    if (p) { const t = sendTrace(env, p); if (ctx?.waitUntil) ctx.waitUntil(t); else await t; }
    return res;
  };
}
