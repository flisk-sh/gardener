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

async function getRaw(fetchImpl, owner, repo, ref, path, limit = 200_000) {
  try {
    const r = await fetchImpl(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { headers: UA });
    return r.ok ? (await r.text()).slice(0, limit) : null;
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
  let viaJsdelivr = false;
  let sizes = null;
  if (res.json) {
    meta = res.json;
    branch = typeof meta.default_branch === 'string' ? meta.default_branch : 'HEAD';
  } else {
    if (res.status === 404) return { error: 'not-found', status: 404 };
    const alt = await jsdelivrFiles(fetchImpl, owner, repo);
    if (alt.status === 404) return { error: 'not-found', status: 404 };
    if (!alt.files) return { error: res.status === 403 || res.status === 429 ? 'github-rate-limited' : 'github-error', status: 503 };
    viaJsdelivr = true;
    meta = { description: '', stargazers_count: null, topics: [] };
    tree = { json: { tree: alt.files.map((f) => ({ type: 'blob', path: f.path })), truncated: false } };
    sizes = alt.files;
  }

  const [apiTree, apiLanguages, readme, agents, rootPkg] = await Promise.all([
    viaJsdelivr ? null : getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, headers),
    viaJsdelivr ? null : getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/languages`, headers),
    getRaw(fetchImpl, owner, repo, branch, 'README.md', 60_000),
    getRaw(fetchImpl, owner, repo, branch, 'AGENTS.md', 6_000).then((t) => t ?? getRaw(fetchImpl, owner, repo, branch, 'CLAUDE.md', 6_000)),
    getRaw(fetchImpl, owner, repo, branch, 'package.json'),
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
  let tests = 0;
  const byExt = {};
  const top = {};
  const workspaces = {};
  let patches = 0;
  let generated = 0;
  const native = new Set();
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
  const deps = pkg ? Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 30).map(([n, v]) => `${n}@${String(v).slice(0, 24)}`) : [];

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
  const headings = [...readmeText.matchAll(/^#{1,3}\s+(.{1,80})$/gm)].map((m) => m[1].trim()).slice(0, 18);
  const langBytes = languages?.json && typeof languages.json === 'object' ? Object.entries(languages.json).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, bytes]) => ({ name, bytes })) : [];

  return {
    repo: `${owner}/${repo}`,
    description: typeof meta.description === 'string' ? meta.description.slice(0, 200) : '',
    stars: Number.isFinite(meta.stargazers_count) ? meta.stargazers_count : null,
    topics: Array.isArray(meta.topics) ? meta.topics.slice(0, 8) : [],
    languages: langBytes,
    source: viaJsdelivr ? 'jsdelivr' : 'github',
    treeTruncated: Boolean(tree?.json?.truncated) || (tree?.json?.tree?.length || 0) > MAX_PATHS,
    counts: { files, tests, patches, generated, nativeDirs: [...native].slice(0, 8), filesByLanguage: Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 6) },
    topLevel: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, files: count })),
    workspaceCount: Object.keys(workspaces).length,
    workspaceGroups: Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    workspaces: Object.entries(workspaces).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, count]) => ({ name, files: count })),
    stack: {
      packageManager: pkg?.packageManager || null,
      engines: pkg?.engines || null,
      rootDependencies: deps,
      workspaceVersions: wsDeps,
    },
    readme: { headings, excerpt: readmeText.slice(0, 1800).replace(/\s+/g, ' ').trim() },
    agentsFile: agents ? agents.slice(0, 1500).replace(/\s+/g, ' ').trim() : null,
  };
}
