// Local dev server around the Worker: bun scripts/serve.mjs  (PORT=8787; WOLF_KEY=... for the hosted flisk-wolf, else --no-model)
import worker from '../src/index.js';

const env = { PUBLIC_ORIGIN: `http://localhost:${process.env.PORT || 8787}`, GITHUB_TOKEN: process.env.GITHUB_TOKEN, WOLF_KEY: process.env.WOLF_KEY, WOLF_URL: process.env.WOLF_URL };
const server = Bun.serve({ port: Number(process.env.PORT || 8787), idleTimeout: 120, fetch: (req) => worker.fetch(req, env, { waitUntil() {} }) });
console.log(`gardener on http://localhost:${server.port} (${env.WOLF_KEY ? 'hosted flisk-wolf' : 'no model: facts only'})`);
