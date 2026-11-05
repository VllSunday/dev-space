// Run from the user's normal terminal, where GitHub networking is available.
// Uses the existing GitHub CLI login; never reads or prints its credentials.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'VllSunday', repository = `${owner}/dev-space`;
const oldFork = `${owner}/workspace-for-game-dev`, oldForkId = 1446593957;
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const tag = `v${version}`;
const gh = process.platform === 'win32' && existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
function command(program, args, { input, allowFailure = false, live = false } = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', input, windowsHide: true, stdio: live ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
  if (!allowFailure && (result.error || result.status !== 0)) throw Error(result.error?.message || result.stderr?.trim() || `${program} failed (${result.status})`);
  return result;
}
const git = (...args) => command('git', args).stdout.trim();
const api = (endpoint, options = {}) => {
  const result = command(gh, ['api', endpoint, ...(options.method ? ['--method', options.method] : []), ...(options.body ? ['--input', '-'] : [])], { input: options.body ? JSON.stringify(options.body) : undefined, allowFailure: options.allowFailure });
  if (result.status !== 0) { if (options.allowFailure && (/HTTP 404|Not Found/.test(result.stderr || '') || options.allowEmpty && /Git Repository is empty|HTTP 409/.test(result.stderr || ''))) return null; throw Error(result.stderr?.trim() || 'GitHub request failed'); }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const head = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw Error('Commit or review source changes before publishing. Local user data and release files stay ignored.');
const roots = git('rev-list', '--max-parents=0', 'HEAD').split('\n');
if (roots.length !== 1) throw Error('Expected an independent Git history');
const files = git('ls-tree', '-r', '--name-only', 'HEAD').split('\n');
for (const file of files) if (/^(?:\.env(?:\.|$)|\.devspace\/|\.mrmak\/|\.cache\/|release\/|workspace\/devspace\/)|(?:^|\/)(?:auth|credentials|tokens?)\.json$/.test(file)) throw Error(`Private local file in commit: ${file}`);
for (const file of ['.github/workflows/release-build.yml', 'LICENSE', 'src/devspace/DevSpace.tsx']) if (!files.includes(file)) throw Error(`Required source file missing: ${file}`);
if (process.argv.includes('--check')) { console.log(`Publication preflight passed: ${repository}, ${tag}, ${head}, ${files.length} source files.`); process.exit(0); }

console.log(`Publishing ${repository} ${tag}. No proxy or security settings are changed.`);
const profile = api('user');
if (profile.login.toLowerCase() !== owner.toLowerCase()) throw Error(`GitHub CLI must be signed in as ${owner}; current account: ${profile.login}`);
let remote = api(`repos/${repository}`, { allowFailure: true });
if (!remote) remote = api('user/repos', { method: 'POST', body: { name: 'dev-space', description: 'Local projects, materials and agent terminals', private: true, auto_init: false } });
if (remote.fork || remote.owner?.login.toLowerCase() !== owner.toLowerCase()) throw Error('The target must be an independent repository owned by the expected account');
const origin = command('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
const url = `https://github.com/${repository}.git`;
if (origin.status !== 0) git('remote', 'add', 'origin', url);
else if (origin.stdout.trim() !== url) throw Error('Origin points to another repository; it was not changed');
// Per-command credential helper: no global Git configuration or token copies.
const credentialArgs = ['-c', 'credential.helper=', '-c', `credential.helper=!"${gh}" auth git-credential`];
const branch = api(`repos/${repository}/commits/main`, { allowFailure: true, allowEmpty: true });
if (branch && branch.sha !== head) throw Error('Remote main differs from the prepared source. No force push was attempted.');
const localTag = command('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { allowFailure: true });
if (localTag.status === 0 && localTag.stdout.trim() !== head) throw Error('Local release tag points to a different commit');
if (localTag.status !== 0) git('tag', tag, head);
command('git', [...credentialArgs, 'push', '--atomic', '--set-upstream', 'origin', 'main', `refs/tags/${tag}`], { live: true });
const published = api(`repos/${repository}/commits/main`);
if (published.sha !== head) throw Error('Uploaded source verification failed');
const rootCommit = api(`repos/${repository}/commits/${roots[0]}`);
if (rootCommit.parents.length !== 0) throw Error('New repository contains unexpected parent history');

console.log(`Source verified. Waiting for Windows, Linux and macOS builds: https://github.com/${repository}/actions`);
let run;
for (let attempt = 0; attempt < 36; attempt++) {
  const result = command(gh, ['run', 'list', '--repo', repository, '--workflow', 'release-build.yml', '--commit', head, '--limit', '20', '--json', 'databaseId,headBranch,event,status,conclusion']);
  run = JSON.parse(result.stdout).find(item => item.headBranch === tag && item.event === 'push');
  if (run) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!run) throw Error('Source is uploaded, but the release workflow did not start. Check repository Actions settings. The old fork is retained.');
if (run.conclusion !== 'success') command(gh, ['run', 'watch', String(run.databaseId), '--repo', repository, '--interval', '15', '--exit-status'], { live: true });

const release = api(`repos/${repository}/releases/tags/${tag}`);
const expected = [
  `Dev-Space-${tag}-windows-x64-setup.exe`, `Dev-Space-${tag}-windows-x64.exe`, `Dev-Space-${tag}-windows-x64-portable.zip`,
  `Dev-Space-${tag}-linux-x86_64`, `Dev-Space-${tag}-x86_64.AppImage`, `Dev-Space-${tag}-linux-x86_64-portable.tar.gz`,
  ...['arm64', 'x64'].flatMap(arch => [`Dev-Space-${tag}-macos-${arch}.dmg`, `Dev-Space-${tag}-macos-${arch}.app.zip`]), 'SHA256SUMS.txt',
];
for (const name of expected) if (!release.assets.some(asset => asset.name === name && asset.size > 0)) throw Error(`Release asset missing: ${name}. The old fork is retained.`);
const download = path.join(root, 'release', `github-${tag}`);
mkdirSync(download, { recursive: true });
command(gh, ['release', 'download', tag, '--repo', repository, '--dir', download, '--clobber'], { live: true });
const checksums = new Map(readFileSync(path.join(download, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').map(line => {
  const match = /^([a-f0-9]{64})\s+\*?([^/\\]+)$/.exec(line.trim());
  if (!match) throw Error('Invalid asset checksum manifest');
  return [match[2], match[1]];
}));
for (const name of expected.filter(name => name !== 'SHA256SUMS.txt')) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(download, name))) hash.update(chunk);
  if (hash.digest('hex') !== checksums.get(name)) throw Error(`Downloaded asset checksum mismatch: ${name}. The old fork is retained.`);
}
writeFileSync(path.join(root, 'release', 'publication-result.json'), JSON.stringify({ repository, tag, commit: head, release: release.html_url, assets: expected, verifiedAt: new Date().toISOString() }, null, 2));
console.log(`Release and all ${expected.length - 1} packages verified: ${release.html_url}`);

// User explicitly requested removal of this exact fork, after successful transfer.
const old = api(`repos/${oldFork}`, { allowFailure: true });
if (old) {
  if (old.id !== oldForkId || !old.fork || old.owner?.login.toLowerCase() !== owner.toLowerCase()) throw Error('Old fork identity does not match; deletion refused');
  api(`repos/${oldFork}`, { method: 'DELETE' });
  if (api(`repos/${oldFork}`, { allowFailure: true })) throw Error('Could not verify old fork removal');
  console.log(`Removed the verified old fork: ${oldFork}. Its local checkout is unchanged.`);
}
console.log('Publication complete.');
