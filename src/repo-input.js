// "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo/", ".../tree/main", "...git" -> "owner/repo" or ''.
// Self-contained: page.js ships this function to the browser through toString().
export function parseRepoInput(raw) {
  let s = String(raw || '').trim().replace(/^git@github\.com:/i, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  s = s.split(/[?#]/)[0].replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = s.split('/');
  if (parts.length < 2) return '';
  const ok = /^[A-Za-z0-9._-]{1,100}$/;
  const [owner, repo] = parts;
  return ok.test(owner) && ok.test(repo) && !/^\.+$/.test(owner) && !/^\.+$/.test(repo) ? `${owner}/${repo}` : '';
}
