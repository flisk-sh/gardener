const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function validRepo(owner, repo) {
  return NAME.test(owner) && NAME.test(repo) && owner !== '.' && owner !== '..' && repo !== '.' && repo !== '..';
}

const UA = { 'user-agent': 'gardener' };

// { json } on success, { status } otherwise: a rate limit must not look like a missing repo.
async function getJson(fetchImpl, url, headers) {
  const r = await fetchImpl(url, { headers });
  return r.ok ? { json: await r.json() } : { status: r.status };
}

// Go, Rust and Python repos have no package.json: read their manifests for a runtime version and the direct dependencies.
// Names are the short form people say ("chi", not "github.com/go-chi/chi/v5").
export function otherEcosystem({ goMod, cargo, pyproject, requirements }) {
  const deps = [];
  let runtime = '';
  if (goMod) {
    const v = /^go\s+(\d[\d.]*)/m.exec(goMod)?.[1];
    if (v) runtime = `GO ${v}`;
    for (const m of goMod.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[^\s]+)\s+(v[\w.+-]+)(?!.*\/\/ indirect)/gm)) {
      const parts = m[1].split('/').filter((x) => !/^v\d+$/.test(x));
      deps.push(`${parts[parts.length - 1]}@${m[2].slice(0, 24)}`);
    }
  } else if (cargo) {
    const v = /^rust-version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] || /^edition\s*=\s*"(\d+)"/m.exec(cargo)?.[1];
    if (v) runtime = /^\d{4}$/.test(v) ? `RUST ${v} EDITION` : `RUST ${v}`;
    const block = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] || '';
    for (const m of block.matchAll(/^([\w-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) deps.push(`${m[1]}@${(m[2] || m[3]).slice(0, 24)}`);
  } else if (pyproject || requirements) {
    const v = /requires-python\s*=\s*"([^"]+)"/.exec(pyproject || '')?.[1];
    if (v) runtime = `PYTHON ${v}`;
    const list = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(pyproject || '')?.[1] || '';
    for (const m of list.matchAll(/"([A-Za-z0-9_.-]+)\s*([<>=!~][^"]*)?"/g)) deps.push(`${m[1]}@${(m[2] || '').replace(/\s+/g, '').slice(0, 24) || 'any'}`);
    for (const l of (requirements || '').split('\n')) {
      const m = /^([A-Za-z0-9_.-]+)\s*([<>=!~]=?[^\s;#]*)?/.exec(l.trim());
      if (m && !l.startsWith('-') && !l.startsWith('#')) deps.push(`${m[1]}@${m[2] || 'any'}`);
    }
  }
  return { deps: [...new Set(deps)].slice(0, 30), runtime };
}

async function getRaw(fetchImpl, owner, repo, ref, path, limit = 200_000) {
  try {
    const r = await fetchImpl(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { headers: UA });
    return r.ok ? (await r.text()).slice(0, limit) : null;
  } catch {
    return null;
  }
}

// ungh.cc (unjs/ungh) is a free proxy for GitHub's public data: stars, description, last push and the complete file list, so counts are exact.
// It is the first fallback; jsDelivr is the second.
async function unghData(fetchImpl, owner, repo) {
  try {
    const [m, f] = await Promise.all([fetchImpl(`https://ungh.cc/repos/${owner}/${repo}`, { headers: UA }), fetchImpl(`https://ungh.cc/repos/${owner}/${repo}/files/HEAD`, { headers: UA })]);
    if (!m.ok || !f.ok) return null;
    const r = (await m.json()).repo;
    const files = (await f.json()).files;
    if (!r || !Array.isArray(files) || files.length === 0) return null;
    return {
      meta: { description: r.description || '', stargazers_count: Number.isFinite(r.stars) ? r.stars : null, topics: [], default_branch: r.defaultBranch || 'HEAD', pushed_at: r.pushedAt || null },
      files: files.filter((x) => x && typeof x.path === 'string').map((x) => ({ path: x.path, size: Number(x.size) || 0 })),
    };
  } catch {
    return null;
  }
}

// GitHub's API rate-limits the shared IPs of Cloudflare Workers (HTTP 403). jsDelivr lists a repo's files (name and size, default branch with
// @HEAD) with no such limit and no key, and raw.githubusercontent.com serves the files. What the API gave on top (stars, description, topics)
// is missing then; everything else is the same.
async function jsdelivrFiles(fetchImpl, owner, repo) {
  try {
    const r = await fetchImpl(`https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@HEAD?structure=flat`, { headers: UA });
    if (r.status === 404) return { status: 404 };
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return Array.isArray(j.files) ? { files: j.files.filter((f) => typeof f.name === 'string').map((f) => ({ path: f.name.replace(/^\//, ''), size: Number(f.size) || 0 })) } : { status: 502 };
  } catch {
    return { status: 502 };
  }
}

const EXT_LANG = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', py: 'Python', rs: 'Rust', go: 'Go', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', java: 'Java', kt: 'Kotlin', swift: 'Swift', rb: 'Ruby', php: 'PHP', cs: 'C#', zig: 'Zig', star: 'Starlark', sh: 'Shell', md: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML' };
const TEST_FILE = /(\.|_)(test|spec)\.[a-z]+$|(^|\/)(tests?|__tests__)\//i;
// Hidden folders (.repos, .github, .claude...) are tooling and vendored copies, not the product, and an alphabetical file list would spend its cap on them first.
const SKIP = /(^|\/)(node_modules|dist|build|vendor|\.git|\.next|coverage|target)\/|^\.[^/]+\//;

// Repo facts from GitHub: metadata, README, the file tree, the manifests. No model, no guessing: counts are counted.
// fetchImpl is injectable for tests.
export async function loadFacts(owner, repo, { fetchImpl = fetch, token } = {}) {
  const headers = { ...UA, accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}`, headers);
  let meta;
  let branch = 'HEAD';
  let tree = null;
  let languages = null;
  let viaJsdelivr = false; // true for either mirror
  let mirror = 'github';
  let sizes = null;
  if (res.json) {
    meta = res.json;
    branch = typeof meta.default_branch === 'string' ? meta.default_branch : 'HEAD';
  } else {
    if (res.status === 404) return { error: 'not-found', status: 404 };
    const ungh = await unghData(fetchImpl, owner, repo);
    if (ungh) {
      mirror = 'ungh';
      meta = ungh.meta;
      branch = ungh.meta.default_branch;
      tree = { json: { tree: ungh.files.map((f) => ({ type: 'blob', path: f.path })), truncated: false } };
      sizes = ungh.files;
    } else {
      const alt = await jsdelivrFiles(fetchImpl, owner, repo);
      if (alt.status === 404) return { error: 'not-found', status: 404 };
      if (!alt.files) return { error: res.status === 403 || res.status === 429 ? 'github-rate-limited' : 'github-error', status: 503 };
      mirror = 'jsdelivr';
      meta = { description: '', stargazers_count: null, topics: [], pushed_at: null };
      tree = { json: { tree: alt.files.map((f) => ({ type: 'blob', path: f.path })), truncated: false } };
      sizes = alt.files;
    }
    viaJsdelivr = true;
  }

  const [apiTree, apiLanguages, readme, agents, rootPkg, goMod, cargo, pyproject, requirements, wrangler] = await Promise.all([
    viaJsdelivr ? null : getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, headers),
    viaJsdelivr ? null : getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/languages`, headers),
    getRaw(fetchImpl, owner, repo, branch, 'README.md', 60_000),
    getRaw(fetchImpl, owner, repo, branch, 'AGENTS.md', 12_000).then((t) => t ?? getRaw(fetchImpl, owner, repo, branch, 'CLAUDE.md', 12_000)),
    getRaw(fetchImpl, owner, repo, branch, 'package.json'),
    getRaw(fetchImpl, owner, repo, branch, 'go.mod', 60_000),
    getRaw(fetchImpl, owner, repo, branch, 'Cargo.toml', 60_000),
    getRaw(fetchImpl, owner, repo, branch, 'pyproject.toml', 60_000),
    getRaw(fetchImpl, owner, repo, branch, 'requirements.txt', 20_000),
    getRaw(fetchImpl, owner, repo, branch, 'wrangler.toml', 20_000),
  ]);
  if (!viaJsdelivr) {
    tree = apiTree;
    languages = apiLanguages;
  } else {
    // no languages endpoint: bytes per language from the file sizes
    const bytes = {};
    for (const f of sizes) {
      const ext = f.path.includes('.') ? f.path.split('.').pop().toLowerCase() : '';
      if (EXT_LANG[ext] && !/^(Markdown|JSON|YAML)$/.test(EXT_LANG[ext])) bytes[EXT_LANG[ext]] = (bytes[EXT_LANG[ext]] || 0) + f.size;
    }
    languages = { json: bytes };
  }

  const MAX_PATHS = 30_000;
  const paths = Array.isArray(tree?.json?.tree) ? tree.json.tree.filter((t) => t.type === 'blob' && typeof t.path === 'string' && !SKIP.test(t.path)).map((t) => t.path).slice(0, MAX_PATHS) : [];
  const files = paths.length;
  // the biggest source files: material for the labels when a repo has few dependencies
  const sizeOf = new Map([...(sizes || []).map((f) => [f.path, f.size]), ...((tree?.json?.tree || []).map((t) => [t.path, t.size]))].filter(([, v]) => Number.isFinite(v) && v > 0));
  const keyFiles = paths
    .filter((x) => /\.(m?[jt]sx?|py|go|rs|rb|java|kt|swift|c|cc|cpp|cs|php|lua|ex|zig)$/i.test(x) && !/(^|\/)(tests?|__tests__|spec|vendor|node_modules)\//i.test(x) && !/\.(test|spec)\./i.test(x) && sizeOf.has(x))
    .sort((a, b) => sizeOf.get(b) - sizeOf.get(a))
    .slice(0, 5)
    .map((x) => ({ path: x, bytes: sizeOf.get(x) }));
  let tests = 0;
  const byExt = {};
  const top = {};
  const workspaces = {};
  let patches = 0;
  let generated = 0;
  const native = new Set();
  const hints = new Set();
  for (const item of Array.isArray(tree?.json?.tree) ? tree.json.tree : []) {
    if (hints.size >= 4) break;
    const p = typeof item.path === 'string' ? item.path : '';
    const base = p.split('/').pop();
    if (p.startsWith('.github/workflows/')) hints.add('GITHUB ACTIONS');
    else if (/^(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(base)) hints.add('DOCKER');
    else if (/^wrangler\.(toml|jsonc?)$/.test(base)) hints.add('CLOUDFLARE WORKERS');
    else if (base === 'vercel.json') hints.add('VERCEL');
    else if (base === 'netlify.toml') hints.add('NETLIFY');
    else if (base === 'fly.toml') hints.add('FLY.IO');
    else if (base === 'render.yaml') hints.add('RENDER');
    else if (/\.tf$/.test(base)) hints.add('TERRAFORM');
    else if (base === 'Chart.yaml' || /^(k8s|kubernetes)\//.test(p)) hints.add('KUBERNETES');
  }
  for (const p of paths) {
    if (TEST_FILE.test(p)) tests++;
    const ext = p.includes('.') ? p.split('.').pop().toLowerCase() : '';
    if (EXT_LANG[ext]) byExt[EXT_LANG[ext]] = (byExt[EXT_LANG[ext]] || 0) + 1;
    const parts = p.split('/');
    const head = parts.length > 1 ? parts[0] : '(root)';
    top[head] = (top[head] || 0) + 1;
    if (parts.length > 2 && ['apps', 'packages', 'services', 'crates', 'libs'].includes(parts[0])) {
      const key = `${parts[0]}/${parts[1]}`;
      workspaces[key] = (workspaces[key] || 0) + 1;
    }
    if (parts[0] === 'patches') patches++;
    if (/(^|[/_.-])(generated|gen)([/_.-]|$)/i.test(p) && /\.(ts|js|py|go|rs|json)$/.test(p)) generated++;
    if (parts[0] === 'native' && parts.length > 2) native.add(parts[1]);
  }

  let pkg = null;
  try {
    pkg = rootPkg ? JSON.parse(rootPkg) : null;
  } catch {
    pkg = null;
  }
  const jsDeps = pkg ? Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 30).map(([n, v]) => `${n}@${String(v).slice(0, 24)}`) : [];
  const other = otherEcosystem({ goMod, cargo, pyproject, requirements });
  // a root manifest without dependencies in a monorepo: read a few nested ones (services/app/web/package.json)
  let nestedDeps = [];
  if (!jsDeps.length && !other.deps.length) {
    const nested = paths.filter((x) => /(^|\/)package\.json$/.test(x) && x !== 'package.json' && x.split('/').length <= 5).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 4);
    const raws = await Promise.all(nested.map((x) => getRaw(fetchImpl, owner, repo, branch, x, 100_000)));
    for (const raw of raws) {
      try {
        const j = raw ? JSON.parse(raw) : null;
        for (const [n, v] of Object.entries({ ...(j?.dependencies || {}), ...(j?.devDependencies || {}) })) nestedDeps.push(`${n}@${String(v).slice(0, 24)}`);
      } catch {
        // an unreadable nested manifest only means fewer facts
      }
    }
    nestedDeps = [...new Set(nestedDeps)].slice(0, 30);
  }
  const deps = jsDeps.length ? jsDeps : other.deps.length ? other.deps : nestedDeps;
  const compat = /^compatibility_date\s*=\s*"([\d-]+)"/m.exec(wrangler || '')?.[1];
  if (!other.runtime && compat) other.runtime = `WORKERS ${compat}`;
  const lockfileSeen = paths.some((x) => /(^|\/)(bun\.lockb?|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(x));
  const noDependencies = Boolean(pkg) && deps.length === 0 && !lockfileSeen && paths.filter((x) => /(^|\/)package\.json$/.test(x)).length <= 1;

  // The workspaces' own manifests carry the versions that matter (Electron, Expo, React Native...).
  const wsNames = Object.entries(workspaces).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  const wsPkgs = await Promise.all(wsNames.map((k) => getRaw(fetchImpl, owner, repo, branch, `${k}/package.json`, 100_000)));
  const wsDeps = {};
  const NOTABLE = /^(electron|expo|react|react-native|vite|next|effect|typescript|tailwindcss|@tanstack\/react-router|prisma|hono|express|fastify|bun|svelte|vue|solid-js|@angular\/core|three|tauri|@tauri-apps\/api)$/;
  for (const raw of wsPkgs) {
    try {
      const j = JSON.parse(raw);
      for (const [n, v] of Object.entries({ ...(j.dependencies || {}), ...(j.devDependencies || {}) })) {
        if (NOTABLE.test(n) && !/^(catalog|workspace):/.test(String(v))) wsDeps[n] = String(v).slice(0, 24);
        else if (NOTABLE.test(n)) wsDeps[n] = 'catalog';
      }
    } catch {
      // a workspace without a readable manifest only means fewer facts
    }
  }

  const groups = {};
  for (const key of Object.keys(workspaces)) {
    const [kind, name] = key.split('/');
    const g = kind === 'packages' && name.includes('-') ? name.split('-')[0] : kind;
    groups[g] = (groups[g] || 0) + 1;
  }

  const readmeText = readme || '';
  // The first shell command in a fenced block: what a user types first.
  const isCommand = (l) => l && !l.startsWith('#') && /^[A-Za-z][\w./@:-]*(\s|$)/.test(l) && !/-->|--\(|│|→|[├└┌]/.test(l);
  const firstCommand = [...readmeText.matchAll(/```(?:bash|sh|shell|console)?\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n').map((l) => l.trim().replace(/^\$\s*/, ''))).find(isCommand) || '';
  const LOCKS = { 'bun.lock': 'bun', 'bun.lockb': 'bun', 'pnpm-lock.yaml': 'pnpm', 'package-lock.json': 'npm', 'yarn.lock': 'yarn', 'Cargo.lock': 'cargo', 'go.sum': 'go', 'poetry.lock': 'poetry', 'uv.lock': 'uv' };
  const lockfile = paths.map((x) => LOCKS[x]).find(Boolean) || null;
  const headings = [...readmeText.matchAll(/^#{1,3}\s+(.{1,80})$/gm)].map((m) => m[1].trim()).slice(0, 18);
  const langBytes = languages?.json && typeof languages.json === 'object' ? Object.entries(languages.json).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, bytes]) => ({ name, bytes })) : [];

  return {
    repo: `${owner}/${repo}`,
    description: typeof meta.description === 'string' ? meta.description.slice(0, 200) : '',
    stars: Number.isFinite(meta.stargazers_count) ? meta.stargazers_count : null,
    topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [],
    languages: langBytes,
    source: mirror,
    pushedAt: meta.pushed_at || null,
    hints: [...hints],
    treeTruncated: Boolean(tree?.json?.truncated) || (tree?.json?.tree?.length || 0) > MAX_PATHS,
    counts: { files, tests, patches, generated, nativeDirs: [...native].slice(0, 8), filesByLanguage: Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 6) },
    keyFiles,
    topLevel: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, files: count })),
    workspaceCount: Object.keys(workspaces).length,
    workspaceGroups: Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    workspaces: Object.entries(workspaces).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, count]) => ({ name, files: count })),
    stack: {
      packageManager: pkg?.packageManager || null,
      engines: pkg?.engines || null,
      runtime: other.runtime,
      noDependencies,
      rootDependencies: deps,
      workspaceVersions: wsDeps,
      scripts: pkg?.scripts ? Object.keys(pkg.scripts).slice(0, 8) : [],
      lockfile,
    },
    readme: { headings, firstLine: (readmeText.split(/\n{2,}/).map((x) => x.replace(/!?\[[^\]]*\]\([^)]*\)|<[^>]+>|[#*_`>]/g, '').replace(/\s+/g, ' ').trim()).find((x) => x.length >= 30 && !/^(\||-|\d+\.)/.test(x)) || '').slice(0, 200), firstCommand: firstCommand.slice(0, 80), excerpt: readmeText.slice(0, 1800).replace(/\s+/g, ' ').trim() },
    agentsFile: agents ? agents.slice(0, 1500).replace(/\s+/g, ' ').trim() : null,
    // what the agent file forbids, one short sentence each: the best material for the "never do this" drawing
    agentsRules: agents
      ? [...new Set(agents.replace(/[`*_#>]/g, '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim().replace(/^[-\d.\s]+/, '')).filter((x) => /\b(never|do not|don't|must not)\b/i.test(x) && x.length >= 12 && x.length <= 90))].slice(0, 4)
      : [],
  };
}
