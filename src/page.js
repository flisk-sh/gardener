import { parseRepoInput } from './repo-input.js';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A sprout on a tower of blocks.
export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Gardener"><title>Gardener</title><rect width="64" height="64" rx="14" fill="#1f9d6b"/><rect x="14" y="44" width="36" height="9" rx="2" fill="#fbfaf7"/><rect x="19" y="34" width="26" height="9" rx="2" fill="#fbfaf7"/><rect x="25" y="24" width="14" height="9" rx="2" fill="#fbfaf7"/><path d="M32 23V14" stroke="#fbfaf7" stroke-width="3" stroke-linecap="round"/><path d="M32 16c0-5 4-8 9-8 0 5-4 8-9 8zM32 18c0-4-3-7-8-7 0 4 3 7 8 7z" fill="#bff3d8"/></svg>`;

const CSS = `
:root{--bg:#fbfaf7;--fg:#141413;--muted:#66635c;--line:#e3e0d7;--card:#fff;--accent:#1f9d6b;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#eceae4;--muted:#a29f97;--line:#272a31;--card:#16181d;--accent:#5ee0a0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-underline-offset:3px}.wrap{max-width:880px;margin:0 auto;padding:0 20px}
.stage{position:relative;overflow:hidden;background:#07080c;color:#f4f3ef;--fg:#f4f3ef;--muted:#b0afba;--line:#262833;--card:#11131a;--accent:#5ee0a0}
.stage::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(60% 65% at 50% 38%,#000,transparent 75%);mask-image:radial-gradient(60% 65% at 50% 38%,#000,transparent 75%)}
.stage::after{content:"";position:absolute;inset:-10%;background:radial-gradient(38% 32% at 22% 18%,rgba(94,224,160,.30),transparent 70%),radial-gradient(32% 30% at 82% 30%,rgba(31,157,107,.28),transparent 70%),radial-gradient(40% 36% at 55% 95%,rgba(91,124,255,.22),transparent 70%);pointer-events:none}
.stage>*{position:relative;z-index:1}
header.top{background:#07080c;border-bottom:1px solid #1d2029}header.top::before,header.top::after{display:none}
header.top .wrap{max-width:1080px;display:flex;gap:20px;align-items:center;min-height:60px;font-size:15px}header.top .wrap a:nth-child(2){margin-left:auto}
header.top a{color:var(--muted);text-decoration:none}header.top a:first-child{color:var(--fg);font-weight:750;font-size:17px;display:flex;gap:10px;align-items:center}header.top img{border-radius:6px}
.hero{padding:48px 0 64px;text-align:center}
h1{font-size:clamp(34px,6.5vw,58px);line-height:1.04;letter-spacing:-.04em;font-weight:800;margin:0 auto 16px;max-width:18ch}
.grad{background:linear-gradient(92deg,#5ee0a0,#4ade80 40%,#9db0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-size:clamp(22px,3.4vw,30px);letter-spacing:-.025em;margin:0 0 14px;font-weight:780}
.lede{color:var(--muted);font-size:clamp(17px,2.3vw,19px);max-width:640px;margin:0 auto 26px}
form.repo{display:flex;gap:10px;max-width:620px;margin:0 auto;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:8px}
form.repo input{flex:1;min-width:0;background:transparent;border:0;color:var(--fg);font:15px var(--mono);padding:11px 14px}form.repo input:focus{outline:none}
form.repo:focus-within{border-color:#5ee0a0}
button,a.btn{font:inherit;font-weight:650;padding:12px 22px;border:0;border-radius:10px;background:linear-gradient(135deg,#1f9d6b,#16805a);color:#fff;cursor:pointer;text-decoration:none;display:inline-block;box-shadow:0 8px 24px -10px rgba(31,157,107,.8)}
button:hover,a.btn:hover{filter:brightness(1.1)}button.ghostbtn,a.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--fg);box-shadow:none}
.chips{margin:18px 0 0;font-size:13px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.chip{text-decoration:none;color:var(--fg);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 12px;background:rgba(255,255,255,.05);font-family:var(--mono)}.chip:hover{border-color:var(--accent)}
.reassure{margin:14px 0 0;font-size:13px;color:var(--muted)}.reassure b{color:var(--accent)}
.error{max-width:620px;margin:0 auto 18px;padding:10px 14px;border-radius:10px;background:rgba(255,123,114,.16);color:var(--fg)}
.shot{margin:40px auto 0;max-width:900px;background:#fff;border-radius:18px;padding:12px;box-shadow:0 40px 100px -30px rgba(31,157,107,.55)}
.shot img{display:block;width:100%;height:auto;border-radius:10px}
@media (prefers-color-scheme:dark){.shot{background:#0d1117}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);margin:56px 0 0;border-top:1px solid var(--line);text-align:left}
.stats div{padding:24px 20px 28px 0}.stats div+div{padding-left:20px;border-left:1px solid var(--line)}
.stats b{display:block;font-size:clamp(30px,4vw,48px);line-height:1;font-weight:800;letter-spacing:-.04em}.stats span{display:block;margin-top:8px;color:var(--muted);font-size:14px;line-height:1.4;max-width:22ch}
.kick{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin:72px 0 10px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:10px 0}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:650}
pre{background:#0e0f12;color:#e8e6e1;border:1px solid #272a31;border-radius:12px;padding:12px 14px;overflow-x:auto;font:13px/1.6 var(--mono);white-space:pre-wrap;word-break:break-all;margin:8px 0 0;text-align:left}
.row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:22px 0 0}
.steps{color:var(--muted);font-size:14px;margin-top:14px}
footer{margin-top:96px;border-top:1px solid var(--line);padding:26px 0 44px;color:var(--muted);font-size:14px}
@media (max-width:640px){.stats{grid-template-columns:1fr 1fr}.stats div{padding:18px 12px 20px 0}.stats div+div{padding-left:12px}.stats div:nth-child(3){padding-left:0;border-left:0}.stats div:nth-child(n+3){border-top:1px solid var(--line)}form.repo{flex-direction:column}}
.grow{padding:72px 16px;text-align:center;color:#444;font-size:17px}.grow i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#1f9d6b;margin:0 4px;animation:pulse 1.2s infinite ease-in-out}.grow i:nth-child(2){animation-delay:.2s}.grow i:nth-child(3){animation-delay:.4s}@keyframes pulse{0%,80%,100%{transform:scale(.5);opacity:.4}40%{transform:scale(1);opacity:1}}
.meta{margin:14px 0 0;font-size:13px;color:var(--muted)}.meta b{color:var(--accent)}
`;

const EXAMPLES = ['pingdotgg/t3code', 'flisk-sh/flisk', 'flisk-sh/readme-diagram'];
const DESC = 'Paste a GitHub repo. Gardener grows its dependency tower: the facts are counted from the repo, the words are written by the Wolf model, and the drawing is code.';

function layout({ title, origin, body, path = '/' }) {
  const t = esc(title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<meta name="description" content="${esc(DESC)}">
<link rel="canonical" href="${esc(origin + path)}">
<meta name="theme-color" content="#07080c">
<meta name="color-scheme" content="light dark">${path !== '/' ? '<meta name="robots" content="noindex,nofollow">' : ''}
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:site_name" content="Gardener"><meta property="og:title" content="${t}"><meta property="og:description" content="${esc(DESC)}"><meta property="og:url" content="${esc(origin + path)}">
<style>${CSS}</style><script src="https://flisk.si/assets/bar.js" defer></script></head><body>
<header class="top stage"><nav class="wrap" aria-label="Site"><a href="/"><img src="/icon.svg" alt="" width="26" height="26">Gardener</a><a href="https://flisk.sh">Flisk</a></nav></header>
${body}
<footer><div class="wrap">Gardener: labels by the Wolf model (flisk-wolf), numbers counted from the repo, nothing stored but the finished tower. <a href="https://github.com/flisk-sh/gardener">Open source</a>, made by <a href="https://flisk.sh">Flisk</a>.</div></footer>
</body></html>`;
}

const form = (value = '') => `<form class="repo" action="/check" method="get" role="search"><input type="text" name="repo" value="${esc(value)}" placeholder="github.com/owner/repo" autocomplete="off" spellcheck="false" required aria-label="GitHub repository"><button type="submit">Grow tower</button></form>
<p class="chips">${EXAMPLES.map((e) => `<a class="chip" href="/${e}">${e}</a>`).join('')}</p>`;

export function page(origin, { error = '', value = '' } = {}) {
  return layout({
    title: 'Gardener: grow a dependency tower from any repo',
    origin,
    body: `<main><section class="hero stage"><div class="wrap">
<h1 class="grad">Grow a dependency tower from any repo</h1>
<p class="lede">Paste a GitHub repo. Gardener counts its parts, asks the Wolf model to label the tower, and draws the meme: everything that holds everything up, and the one thing that is holding on by a thread.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}${form(value)}
<p class="reassure"><b>●</b> No sign-up · Public repos · Same repo, same tower</p>
<div class="shot"><img src="/sample.svg" alt="Sample tower of the t3code repo" width="1080" height="1370"></div>
<div class="stats"><div><b>1</b><span>repo in, one SVG out, works in any README</span></div><div><b>0</b><span>numbers the model may invent: each must be in the repo's facts</span></div><div><b>~30 s</b><span>to grow a new tower, then it is cached</span></div><div><b>7 days</b><span>before the same repo is grown again</span></div></div>
</div></section>
<div class="wrap"><p class="kick">How it works</p><h2>Code counts. Wolf writes. Code draws.</h2>
<table><thead><tr><th>Step</th><th>Who</th><th>What</th></tr></thead><tbody>
<tr><td>Facts</td><td>Code</td><td>The file tree, test files, patches, native code, workspaces, pinned versions and the README, read from GitHub</td></tr>
<tr><td>Labels</td><td>Wolf</td><td>Picks what is the foundation, the core, the fragile neck and the jokes, in one JSON answer. A number that is not in the facts is dropped, and so is a drawing the facts do not back</td></tr>
<tr><td>Drawing</td><td>Code</td><td>The hand-drawn tower, always the same for the same repo</td></tr></tbody></table>
<p class="kick">Or type it</p><h2>One URL per repo.</h2>
<pre>https://gardener.flisk.si/owner/repo.svg</pre></div></main>`,
  });
}

export function resultPage(origin, repo) {
  const u = `${origin}/${repo}.svg`;
  const snippet = `<p align="center"><img src="${u}" alt="Dependency tower of ${repo}" width="100%"></p>`;
  return layout({
    title: `${repo} tower · Gardener`,
    origin,
    path: `/${repo}`,
    body: `<main><section class="hero stage"><div class="wrap">
<h1 class="grad">${esc(repo)}</h1>
<p class="lede" id="lede">Growing the tower. A new one takes up to 30 seconds.</p>
<p id="err" class="error" role="alert" hidden>Could not grow a tower for ${esc(repo)}. Is the repo public, and is GitHub answering?</p>
<div class="shot"><div id="grow" class="grow"><i></i><i></i><i></i><br>Counting files, asking Wolf, drawing…</div><img id="img" alt="Dependency tower of ${esc(repo)}" width="1080" height="1370" hidden></div>
<p class="meta" id="meta" hidden></p>
<div class="row"><button id="copy" type="button" class="ghostbtn">Copy README snippet</button><a class="btn ghost" href="/${esc(repo)}.json" id="json" hidden>See the labels</a><a class="btn ghost" href="/">Another repo</a></div>
<pre id="snip">${esc(snippet)}</pre>
</div></section></main>
<script>
const s=${JSON.stringify(snippet).replace(/</g, '\\u003c')},repo=${JSON.stringify(repo).replace(/</g, '\\u003c')},c=document.getElementById('copy'),img=document.getElementById('img');
c.onclick=()=>navigator.clipboard.writeText(s).then(()=>{c.textContent='Copied';setTimeout(()=>c.textContent='Copy README snippet',1500)});
img.onload=()=>{document.getElementById('grow').hidden=true;img.hidden=false;document.getElementById('lede').textContent='Your tower is ready. Copy the snippet to the top of the README.';
fetch('/'+repo+'.json').then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const m=document.getElementById('meta');m.hidden=false;m.textContent='Labels by '+j.source+' · '+j.filled+' fields from the model · '+j.dropped.length+' dropped because the repo does not back them'+(j.note?' · '+j.note:'');document.getElementById('json').hidden=false}).catch(()=>{})};
img.onerror=()=>{document.getElementById('err').hidden=false;document.getElementById('grow').hidden=true;document.getElementById('lede').hidden=true};
img.src='/'+repo+'.svg?wait=1';
</script>`,
  });
}

export { parseRepoInput };
