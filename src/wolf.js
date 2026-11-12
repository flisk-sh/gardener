// Wolf (flisk-wolf: Qwen2.5-Coder 32B on Workers AI, behind inference.flisk.si) turns repo FACTS into the tower's labels.
// The model only writes words. It never sees a drawing API, and every number it writes must come from the facts.

export const KINDS = ['tests', 'notes', 'nosign', 'scroll', 'ghost', 'tiny', 'tape', 'rocket', 'bird', 'shark'];
// A Worker may keep working about 30 s after it answers; a model that needs longer than this is not waited for.
export const MODEL_TIMEOUT_MS = 24_000;
export const MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

// A drawing only appears when the facts back it. The model proposes, this decides.
export function supported(kind, facts) {
  const c = facts.counts || {};
  const text = `${facts.readme?.excerpt || ''} ${facts.agentsFile || ''} ${(facts.readme?.headings || []).join(' ')} ${JSON.stringify(facts.workspaces || [])} ${JSON.stringify(facts.stack || {})}`;
  const langs = (c.filesByLanguage || []).map(([n]) => n);
  switch (kind) {
    case 'tests': return c.tests > 0;
    case 'notes': return false; // the facts carry no TODO count
    case 'nosign': return /\b(never|do not|don't)\b/i.test(facts.agentsFile || '');
    case 'scroll': return c.generated > 0;
    case 'ghost': return (c.nativeDirs || []).length > 0;
    case 'tape': return c.patches > 0;
    case 'rocket': return (c.nativeDirs || []).length > 0 || langs.some((n) => /^(Rust|Go|Zig|C|C\+\+)$/.test(n));
    case 'bird': return /app store|google play|testflight|\bios\b|android|expo|react-native/i.test(text);
    case 'shark': return /database|sqlite|postgres|userdata|live data/i.test(`${facts.readme?.excerpt || ''} ${facts.agentsFile || ''}`);
    case 'tiny': return (facts.workspaces || []).length > 2;
    default: return false;
  }
}

// Phrases from the prompt that a model sometimes hands back as a caption.
const ECHO = new Set(['the smallest part of the repo', 'smallest part of repo', 'patched or vendored code', 'native rust or go code', 'live data that must not be touched', 'live data', 'a huge generated file', 'large generated files', 'generated file', 'todo or fixme count', 'todo/fixme', 'todos and fixmes', 'a thing the docs say never to do', 'a native or odd dependency', 'an app store or external gatekeeper', 'external gatekeeper'].map((x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')));

const squash = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');

const SCHEMA = `{
 "title": "<repo name, max 24>",
 "foundation": {"stones": ["<up to 4 things the repo stands on, max 12 chars each>"], "text": "<what it stands on, max 56>"},
 "runtime": {"bar": "<runtime + exact version, max 30>", "tool": "<package manager + version, max 30>", "toolNote": "<max 20>"},
 "core": {"title": "<the one library under everything, max 16>", "note": "<max 30>", "disc": "<a second library, max 26>"},
 "middle": {"title": "<N workspaces or packages, max 22>", "note": "<what they are, max 46>"},
 "left": {"title": "<biggest app or dir, max 16>", "stat": "<its file count, max 22>", "note": "<max 40>"},
 "right": {"title": "<second app or dir, max 16>", "stat": "<its file count, max 22>", "note": "<max 24>"},
 "neck": {"title": "<the thin fragile thing everything leans on, max 18>", "note": "<max 34>"},
 "upper": {"pentagon": ["<max 8>", "<max 8>"], "pentagonNote": "<max 14>", "triangle": "<max 12>", "plank": "<max 22>"},
 "red": {"title": "<a pinned or risky dependency, max 20>", "note": "<max 22>"},
 "crane": {"title": "<AI AGENTS or similar, max 14>", "note": "<max 36>"},
 "oss": "<whose unpaid work it stands on, max 48>",
 "cloud": {"word": "<max 10>", "label": "<hosted or external service, max 44>"},
 "badge": "<max 28>",
 "braces": {"left": "<the whole domain, max 22>", "right": "<what the user is doing, max 40>"},
 "zoom": {"say": "<max 16>", "aside": "<max 20>"},
 "insets": [{"kind": "<one of: ${KINDS.join(', ')}>", "caption": "<max 30>"}]
}`;

const EXAMPLE_FACTS = { repo: 'acme/shop', counts: { files: 812, tests: 96, patches: 4, nativeDirs: ['pdf-render'], filesByLanguage: [['TypeScript', 640], ['Go', 90], ['Python', 40]] }, workspaceCount: 9, workspaceGroups: [{ name: 'services', count: 6 }, { name: 'apps', count: 3 }], workspaces: [{ name: 'apps/storefront', files: 300 }, { name: 'services/orders', files: 120 }], stack: { packageManager: 'pnpm@9.1.0', engines: { node: '22.4.0' }, workspaceVersions: { react: '19.0.0', electron: '33.2.0', effect: 'catalog' } } };
const EXAMPLE_TOWER = {
  title: 'ACME/SHOP',
  foundation: { stones: ['TypeScript', 'Go', 'Python'], text: '812 FILES IN 3 LANGUAGES' },
  runtime: { bar: 'NODE 22.4.0 (EXACT)', tool: 'pnpm 9.1.0', toolNote: 'PINNED' },
  core: { title: 'EFFECT', note: 'IN EVERY WORKSPACE', disc: 'react 19.0.0' },
  middle: { title: '9 WORKSPACES', note: '6 SERVICES + 3 APPS' },
  left: { title: 'apps/storefront', stat: '300 FILES', note: 'THE WHOLE SHOP WINDOW' },
  right: { title: 'services/orders', stat: '120 FILES', note: 'WHERE MONEY HAPPENS' },
  neck: { title: '4 PATCHES', note: 'patches/ : EDITED BY HAND' },
  upper: { pentagon: ['ELECTRON', '33.2.0'], pentagonNote: 'DESKTOP SHELL', triangle: 'REACT 19', plank: 'pnpm start' },
  red: { title: 'ELECTRON 33.2.0', note: 'PINNED' },
  crane: { title: 'AI AGENTS', note: 'WRITING THE NEXT PR' },
  oss: 'THE MAINTAINERS OF REACT AND ELECTRON',
  cloud: { word: 'hosted', label: 'THE PAYMENT PROVIDER (NOT IN THE REPO)' },
  badge: '4 PATCHED NPM PACKAGES',
  braces: { left: 'ALL OF E-COMMERCE', right: 'SOMEONE BUYING SOCKS' },
  zoom: { say: 'it shipped?!', aside: '(on my machine)' },
  insets: [{ kind: 'tests', caption: '96 TEST FILES' }, { kind: 'rocket', caption: 'GO DEVS DOING THEIR THING' }, { kind: 'ghost', caption: 'pdf-render (NATIVE)' }],
};

const EXAMPLE2_FACTS = { repo: 'kit/pixelpress', counts: { files: 240, tests: 31, patches: 0, nativeDirs: ['gpu-kernels'], filesByLanguage: [['Rust', 150], ['TypeScript', 60], ['GLSL', 12]] }, workspaceCount: 4, workspaceGroups: [{ name: 'crates', count: 4 }], workspaces: [{ name: 'crates/core', files: 90 }, { name: 'crates/ui', files: 55 }], stack: { packageManager: 'cargo', engines: null, workspaceVersions: { wgpu: '0.19.1', tauri: '1.6.0' } }, readme: { excerpt: 'PixelPress compresses photos in your browser. Drop an image, pick a size, download it.' } };
const EXAMPLE2_TOWER = {
  title: 'KIT/PIXELPRESS',
  foundation: { stones: ['Rust', 'TypeScript', 'GLSL'], text: '240 FILES AND A GRAPHICS CARD' },
  runtime: { bar: 'cargo', tool: 'tauri 1.6.0', toolNote: 'THE SHELL' },
  core: { title: 'WGPU', note: 'TALKS TO EVERY GPU', disc: 'tauri 1.6.0' },
  middle: { title: '4 CRATES', note: 'ALL OF THEM RUST' },
  left: { title: 'crates/core', stat: '90 FILES', note: 'THE ACTUAL COMPRESSOR' },
  right: { title: 'crates/ui', stat: '55 FILES', note: 'THE BUTTON' },
  neck: { title: 'GPU KERNELS', note: 'gpu-kernels/ : ONE SHADER AT A TIME' },
  upper: { pentagon: ['TAURI', '1.6.0'], pentagonNote: 'A WEBVIEW', triangle: 'WGPU 0.19', plank: 'cargo run' },
  red: { title: 'WGPU 0.19.1', note: 'EXACT PIN' },
  crane: { title: 'NO AGENTS', note: 'JUST A COMPRESSOR' },
  oss: 'THE PEOPLE WHO WRITE GPU DRIVERS',
  cloud: { word: 'browser', label: 'YOUR BROWSER (OUT OF REPO)' },
  badge: 'ONE FILE, SMALLER',
  braces: { left: 'ALL OF IMAGE COMPRESSION', right: 'SOMEONE DROPPING A PHOTO' },
  zoom: { say: 'smaller?!', aside: '(by 4 percent)' },
  insets: [{ kind: 'tests', caption: '31 TEST FILES' }, { kind: 'ghost', caption: 'gpu-kernels (NATIVE)' }],
};

// Long labels of the worked examples, to catch a model that copies them (short ones such as AI AGENTS are generic).
const EXAMPLE_STRINGS = new Set(
  (JSON.stringify(EXAMPLE_TOWER) + JSON.stringify(EXAMPLE2_TOWER)).match(/"([^"]{12,})"/g)?.map((x) => squash(x.slice(1, -1))) ?? [],
);

export function buildMessages(facts) {
  const system = [
    'You write the labels for a hand-drawn "Dependency" tower meme about one software repository.',
    'The tower is a huge stack of parts resting on a few foundations. One tiny, fragile piece in the middle holds everything up. "YOU ARE HERE" sits on top, and a person looks at it through a magnifying circle.',
    'Reply with ONE JSON object and nothing else, in exactly this shape (the angle-bracket text says what each field is):',
    SCHEMA,
    'How to choose, from FACTS only:',
    '- foundation.stones: the languages the repo is written in, or what it stands on.',
    '- core: the library listed in stack.workspaceVersions that most workspaces share (prefer effect, react, vite). Never a lint or config tool.',
    '- middle: counts from workspaceCount and workspaceGroups. left and right: the two biggest entries of workspaces, with their file counts.',
    '- neck: the thin fragile thing. If counts.patches is above 0, it is the patches (their count). Otherwise a dependency pinned to an exact version.',
    '- red: an exact-pinned version from stack.workspaceVersions, such as electron.',
    '- braces.right: what the end user is doing, in a few words, as a joke ("SOMEONE BUYING SOCKS"). It is never "YOU ARE HERE". zoom: a hopeful line and a dry aside ("it shipped?!" / "(on my machine)").',
    '- crane: the AI agents, only if the README or AGENTS file talks about agents.',
    'Rules:',
    '- The two examples above are about other repos. Never copy its wording: every label must be about THIS repo, and the jokes must fit it.',
    '- Use ONLY facts from FACTS. Every number, version and name you write must appear in FACTS. If a fact is missing, leave that field out instead of inventing it.',
    '- ALL CAPS, except package names, file paths and versions, which keep their spelling.',
    '- Short and dry. A joke is fine when the fact is already funny. Never insult a person.',
    '- insets: up to 8, each a different kind: tests = the test-file count, notes = TODO or FIXME count, nosign = a thing the docs say never to do, scroll = a huge generated file, ghost = a native or odd dependency, tiny = the smallest part of the repo, tape = patched or vendored code, rocket = native Rust or Go code, bird = an app store or external gatekeeper, shark = live data that must not be touched. Use a kind only when FACTS support it.',
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `FACTS:\n${JSON.stringify(EXAMPLE_FACTS)}` },
    { role: 'assistant', content: JSON.stringify(EXAMPLE_TOWER) },
    { role: 'user', content: `FACTS:\n${JSON.stringify(EXAMPLE2_FACTS)}` },
    { role: 'assistant', content: JSON.stringify(EXAMPLE2_TOWER) },
    { role: 'user', content: `FACTS:\n${JSON.stringify(facts)}` },
  ];
}

// Where the words come from: the hosted Flisk model (OpenAI-compatible, needs a key), else the Workers AI binding the same model runs on.
export async function askWolf(messages, env = {}, fetchImpl = fetch) {
  if (env.WOLF_KEY) {
    const base = (env.WOLF_URL || 'https://inference.flisk.si').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.WOLF_KEY}` },
      body: JSON.stringify({ model: 'flisk-wolf', messages, max_tokens: 1000, temperature: 0.3 }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!r.ok) return { error: `wolf-http-${r.status}` };
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? { text: content, via: 'inference.flisk.si' } : { error: 'wolf-empty' };
  }
  if (env.AI && typeof env.AI.run === 'function') {
    const res = await Promise.race([
      env.AI.run(MODEL, { messages, max_tokens: 1000, temperature: 0.3 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('the model took too long')), MODEL_TIMEOUT_MS)),
    ]);
    const out = res?.response;
    if (out == null) return { error: 'ai-empty' };
    return { text: typeof out === 'string' ? out : JSON.stringify(out), via: 'workers-ai' };
  }
  return { error: 'no-model' };
}

const clip = (s, max) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const whole = s[max] === ' ' ? cut : cut.replace(/\s+\S*$/, '');
  const closed = (whole || cut).replace(/\s*\([^)]*$/, '');
  return closed || whole || cut;
};
const str = (v, max) => (typeof v === 'string' ? clip(v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim(), max) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

// A number in a label counts only when the facts contain it (commas ignored: 1,423 matches 1423).
export function isGrounded(label, factsText) {
  const nums = String(label).match(/\d[\d.,]*\d|\d/g) || [];
  return nums.every((n) => {
    const plain = n.replace(/,/g, '').replace(/\.$/, '');
    return factsText.includes(plain) || factsText.includes(n);
  });
}

// Fields whose numbers do not appear in the facts are dropped, and the caller falls back to the plain tower for them.
export function parseTower(text, facts, { grounded = true } = {}) {
  let obj;
  try {
    const cleaned = String(text).replace(/```(?:json)?/g, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const factsText = JSON.stringify(facts).replace(/,(?=\d{3})/g, '');
  const dropped = [];
  const g = (value, max, path) => {
    const s = str(value, max);
    if (s && /^(braces|oss|cloud\.label|badge|insets)/.test(path) && EXAMPLE_STRINGS.has(squash(s)) && !squash(factsText).includes(squash(s))) {
      dropped.push(`${path} (copied from the example)`);
      return '';
    }
    if (grounded && s && !isGrounded(s, factsText)) {
      dropped.push(path);
      return '';
    }
    return s;
  };
  const o = (v) => (v && typeof v === 'object' ? v : {});
  const t = {
    title: g(obj.title, 24, 'title'),
    foundation: { stones: arr(o(obj.foundation).stones, 4).map((s, i) => g(s, 12, `foundation.stones.${i}`)).filter(Boolean), text: g(o(obj.foundation).text, 56, 'foundation.text') },
    runtime: { bar: g(o(obj.runtime).bar, 30, 'runtime.bar'), tool: g(o(obj.runtime).tool, 30, 'runtime.tool'), toolNote: g(o(obj.runtime).toolNote, 20, 'runtime.toolNote') },
    core: { title: g(o(obj.core).title, 16, 'core.title'), note: g(o(obj.core).note, 30, 'core.note'), disc: g(o(obj.core).disc, 26, 'core.disc') },
    middle: { title: g(o(obj.middle).title, 22, 'middle.title'), note: g(o(obj.middle).note, 46, 'middle.note') },
    left: { title: g(o(obj.left).title, 16, 'left.title'), stat: g(o(obj.left).stat, 22, 'left.stat'), note: g(o(obj.left).note, 40, 'left.note') },
    right: { title: g(o(obj.right).title, 16, 'right.title'), stat: g(o(obj.right).stat, 22, 'right.stat'), note: g(o(obj.right).note, 24, 'right.note') },
    neck: { title: g(o(obj.neck).title, 18, 'neck.title'), note: g(o(obj.neck).note, 34, 'neck.note') },
    upper: {
      pentagon: arr(o(obj.upper).pentagon, 2).map((s, i) => g(s, 8, `upper.pentagon.${i}`)),
      pentagonNote: g(o(obj.upper).pentagonNote, 14, 'upper.pentagonNote'),
      triangle: g(o(obj.upper).triangle, 12, 'upper.triangle'),
      plank: g(o(obj.upper).plank, 22, 'upper.plank'),
    },
    red: { title: g(o(obj.red).title, 20, 'red.title'), note: g(o(obj.red).note, 22, 'red.note') },
    crane: { title: g(o(obj.crane).title, 14, 'crane.title'), note: g(o(obj.crane).note, 36, 'crane.note') },
    oss: g(obj.oss, 48, 'oss'),
    cloud: { word: g(o(obj.cloud).word, 10, 'cloud.word'), label: g(o(obj.cloud).label, 44, 'cloud.label') },
    badge: g(obj.badge, 28, 'badge'),
    braces: { left: g(o(obj.braces).left, 22, 'braces.left'), right: g(o(obj.braces).right, 40, 'braces.right') },
    zoom: { say: g(o(obj.zoom).say, 16, 'zoom.say'), aside: g(o(obj.zoom).aside, 20, 'zoom.aside') },
    insets: [],
  };
  const seen = new Set();
  for (const item of arr(obj.insets, 8)) {
    const kind = str(item?.kind, 12);
    const caption = g(item?.caption, 30, `insets.${kind}`);
    if (!KINDS.includes(kind) || !caption || seen.has(kind)) continue;
    if (ECHO.has(squash(caption))) {
      dropped.push(`insets.${kind} (echoes the prompt)`);
      continue;
    }
    if (grounded && !supported(kind, facts)) {
      dropped.push(`insets.${kind} (facts do not support it)`);
      continue;
    }
    seen.add(kind);
    t.insets.push({ kind, caption });
  }
  for (const [obj, name, note] of [[t.red, 'red.title', 'note'], [t.runtime, 'runtime.tool', 'toolNote']]) {
    const label = name === 'red.title' ? obj.title : obj.tool;
    if (/pin/i.test(obj[note]) && /[\^~]/.test(label)) {
      obj[note] = '';
      dropped.push(`${name.split('.')[0]}.${note} (a ^ or ~ range is not a pin)`);
    }
  }
  t.dropped = dropped;
  return t;
}

const up = (s) => String(s).toUpperCase();
const num = (n) => Number(n).toLocaleString('en-US');

// What the tower says when the model is absent or wrong: plain facts, no jokes, nothing invented.
export function fallbackTower(facts) {
  const name = facts.repo.split('/')[1];
  const ws = facts.workspaces || [];
  const langs = facts.counts.filesByLanguage || [];
  const ver = facts.stack?.workspaceVersions || {};
  const dep = Object.keys(ver)[0];
  const node = facts.stack?.engines?.node;
  const insets = [];
  if (facts.counts.tests > 0) insets.push({ kind: 'tests', caption: `${num(facts.counts.tests)} TEST FILES` });
  if (facts.counts.patches > 0) insets.push({ kind: 'tape', caption: `${num(facts.counts.patches)} PATCH FILES` });
  if ((facts.counts.nativeDirs || []).length > 0) insets.push({ kind: 'rocket', caption: `NATIVE: ${facts.counts.nativeDirs.slice(0, 2).join(', ')}`.slice(0, 30) });
  return {
    title: up(name).slice(0, 24),
    foundation: { stones: langs.slice(0, 4).map(([n]) => up(n).slice(0, 12)), text: `${num(facts.counts.files)} FILES` },
    runtime: { bar: node ? `NODE ${node}` : '', tool: facts.stack?.packageManager ? String(facts.stack.packageManager).replace('@', ' ') : '', toolNote: '' },
    core: { title: dep ? up(dep).slice(0, 16) : '', note: dep && ver[dep] ? String(ver[dep]) : '', disc: '' },
    middle: { title: facts.workspaceCount ? `${facts.workspaceCount} WORKSPACES` : '', note: (facts.workspaceGroups || []).slice(0, 3).map((g) => `${g.count} ${up(g.name)}`).join(' + ').slice(0, 46) },
    left: { title: ws[0] ? ws[0].name.slice(0, 16) : '', stat: ws[0] ? `${num(ws[0].files)} FILES` : '', note: '' },
    right: { title: ws[1] ? ws[1].name.slice(0, 16) : '', stat: ws[1] ? `${num(ws[1].files)} FILES` : '', note: '' },
    neck: { title: facts.counts.patches > 0 ? `${facts.counts.patches} PATCHES` : '', note: facts.counts.patches > 0 ? 'patches/' : '' },
    upper: { pentagon: ['', ''], pentagonNote: '', triangle: '', plank: '' },
    red: { title: ver.electron ? `ELECTRON ${ver.electron}` : '', note: '' },
    crane: { title: '', note: '' },
    oss: '',
    cloud: { word: '', label: '' },
    badge: '',
    braces: { left: `ALL OF ${up(name)}`.slice(0, 22), right: '' },
    zoom: { say: 'it works?!', aside: '(on my machine)' },
    insets,
    dropped: [],
  };
}

// Model words where they are usable, plain facts everywhere else. `filled` counts the fields the model supplied.
export function mergeTower(model, plain) {
  if (!model) return { tower: plain, filled: 0 };
  let filled = 0;
  const pick = (m, p) => {
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      return Object.fromEntries(Object.keys({ ...p, ...m }).map((k) => [k, pick(m[k], p?.[k])]));
    }
    if (Array.isArray(m)) {
      const items = m.filter(Boolean);
      if (items.length) filled++;
      return items.length ? m : p;
    }
    if (m) {
      filled++;
      return m;
    }
    return p;
  };
  const tower = pick(model, plain);
  tower.dropped = model.dropped || [];
  return { tower, filled };
}
