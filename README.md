# Gardener

**gardener.flisk.si**: paste a GitHub repo, get its dependency tower, the hand-drawn "everything stands on one tiny thing" meme. Same shape as [diagram.flisk.si](https://diagram.flisk.si) (a Cloudflare Worker, one URL per repo, nothing to sign up for), but the words come from the Wolf model.

```
repo --(code)--> facts --(Wolf)--> labels JSON --(code: checked)--> SVG
```

- `src/github.js`: counts the facts from GitHub (file tree, tests, patches, generated files, native code, workspace groups, pinned versions, README). No model.
- `src/wolf.js`: asks Wolf for the labels (two worked examples, one JSON object back) and **checks** the answer. A number that is not in the facts is dropped, a drawing the facts do not back is dropped (`shark` needs a database in the README, `tape` needs `patches/`, and so on), a caption copied from the prompt is dropped, and `^`/`~` ranges are not called pins. Whatever is dropped falls back to plain facts, so a dead model still gives a tower.
- `src/tower.js`: the drawing. Pure code, seeded: the same repo always wobbles the same.
- `src/index.js`: the Worker. `/` home, `/check?repo=` form, `/<owner>/<repo>` page, `/<owner>/<repo>.svg` the tower, `/<owner>/<repo>.json` the labels and what was dropped, `/sample.svg`, `POST /render` (a tower JSON in, SVG out).

## Growing takes up to 30 seconds

Wolf needs 15 to 25 seconds, longer than the image proxies in front of READMEs wait. So:

- The repo page asks for `<repo>.svg?wait=1`, waits, and shows the tower.
- A bare `<repo>.svg` (a README `<img>`) that is not cached yet gets a "growing" placeholder at once while the tower grows in the background (`ctx.waitUntil`, one job per repo). Open the repo page first, copy the snippet, then paste it.
- Finished towers are cached in KV for 7 days (1 hour when the model was skipped).

## Limits

The model is the expensive part. It is capped at `DAILY_MODEL_CAP` calls a day (200) and `IP_HOURLY` per visitor (6). Over a cap a tower is still drawn, from facts only, and the page says so. The model call has a 24 s deadline.

## Run it

```bash
bun test                                     # 19 tests, fake GitHub and fake model
PORT=8787 WOLF_KEY=fi-... bun scripts/serve.mjs     # local site on the hosted flisk-wolf
bun scripts/make.mjs pingdotgg/t3code        # one tower to a file (WOLF_KEY=fi-... for the hosted flisk-wolf, else facts only)
```

## Deploy (done 2026-11-12: Worker + KV `GARDENER` on the Flisk Cloudflare account, custom domain gardener.flisk.si)

1. `bunx wrangler@4 kv namespace create GARDENER`, then put the printed id in `wrangler.toml`.
2. Optional: `bunx wrangler@4 secret put GITHUB_TOKEN` (GitHub allows 60 API calls an hour without one; each new tower needs about 12), and `WOLF_KEY` to call the hosted flisk-wolf at inference.flisk.si instead of the Workers AI binding. The binding runs the same Qwen2.5-Coder 32B and needs no secret; the hosted model has its own shared daily limit (100) that a public site would use up.
3. `bunx wrangler@4 deploy`. The custom domain `gardener.flisk.si` is created on the flisk.si zone.
4. Probably needs the **Workers Paid** plan (not tested: the live site could not reach GitHub, see below): growing a tower takes about 40 to 60 ms of CPU for a big repo (a 32,000-file tree), over the 10 ms of the free plan.
5. Then: add Gardener to the flisk.si product catalog (the bar), an icon in flisk-emoji, a GitHub repo, and a Source link in the footer of `src/page.js`.

Bump `VERSION` in `src/index.js` whenever the prompt or the drawing changes, so old towers are not served from the cache.

## Status after the first deploy

- **No cost:** nothing was bought. `DAILY_MODEL_CAP = "0"` keeps the model off, so every tower is drawn from facts only. Workers AI is free only up to a small daily allowance (about 10,000 neurons, a few towers a day); raise the cap on purpose, and only if the account cannot be billed for overage.
- **jsDelivr fallback (added 2026-11-12):** when GitHub's API refuses, the file list comes from jsDelivr (`data.jsdelivr.com/v1/packages/gh/<owner>/<repo>@HEAD?structure=flat`) and the README and manifests from raw.githubusercontent.com, both free and unlimited by key. jsDelivr cuts the list of big repos (948 of about 32,000 files for t3code), so in that mode every count is a lower bound and is written `N+`, and stars and description are missing. A GitHub token (secret `GITHUB_TOKEN`) still gives exact counts.
- **GitHub rate limit (why the fallback exists):** unauthenticated GitHub API calls from a Cloudflare Worker share IPs and are rate limited (HTTP 403). Until a `GITHUB_TOKEN` secret is set (a personal access token with no scopes is enough, and free), live towers answer 503 "GitHub is limiting requests". Locally it works.
