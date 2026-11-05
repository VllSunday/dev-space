// Run from the user's normal terminal, where GitHub networking is available.
// Uses the existing GitHub CLI login; never reads or prints its credentials.
import { runReleaseCommand } from './release-command.mjs';
import { readFileSync, existsSync, mkdirSync, createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'VllSunday', repository = `${owner}/dev-space`;
// Optional, private one-time migration instructions; never distributed in Git.
const cleanupFile = path.join(root, 'release', 'migration-cleanup.json');
const cleanup = existsSync(cleanupFile) ? JSON.parse(readFileSync(cleanupFile, 'utf8')) : null;
if (cleanup && (!new RegExp(`^${owner}/[A-Za-z0-9_.-]+$`).test(cleanup.repository) || cleanup.repository === repository || !Number.isSafeInteger(cleanup.repositoryId) || cleanup.removeAfterVerifiedRelease !== true)) throw Error('Invalid migration cleanup instructions');
const resume = process.argv.includes('--resume');
const makePublic = process.argv.includes('--public');
const tagOption = process.argv.indexOf('--tag');
const requestedTag = tagOption < 0 ? null : process.argv[tagOption + 1];
if (tagOption >= 0 && (!resume || !/^v\d+\.\d+\.\d+$/.test(requestedTag || ''))) throw Error('--tag vMAJOR.MINOR.PATCH requires --resume');
const version = requestedTag?.slice(1) || JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid release version');
const tag = `v${version}`;
const gh = process.platform === 'win32' && existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
function command(program, args, { input, allowFailure = false, live = false } = {}) {
  return runReleaseCommand(program, args, { cwd: root, input, allowFailure, live });
}
const git = (...args) => command('git', args).stdout.trim();
const api = (endpoint, options = {}) => {
  const result = command(gh, ['api', endpoint, ...(options.method ? ['--method', options.method] : []), ...(options.body ? ['--input', '-'] : []), ...(options.pick ? ['--jq', options.pick] : [])], { input: options.body ? JSON.stringify(options.body) : undefined, allowFailure: options.allowFailure });
  if (result.status !== 0) { if (options.allowFailure && (/HTTP 404|Not Found/.test(result.stderr || '') || options.allowEmpty && /Git Repository is empty|HTTP 409/.test(result.stderr || ''))) return null; throw Error(result.stderr?.trim() || 'GitHub request failed'); }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const localTag = command('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { allowFailure: true });
if (resume && localTag.status !== 0) throw Error(`Cannot resume: local ${tag} is missing`);
const head = resume ? git('rev-parse', `${tag}^{commit}`) : git('rev-parse', 'HEAD');
if (!resume && git('status', '--porcelain')) throw Error('Commit or review source changes before publishing. Local user data and release files stay ignored.');
if (resume && JSON.parse(git('show', `${tag}:package.json`)).version !== version) throw Error('Release tag and source version do not match');
const roots = git('rev-list', '--max-parents=0', head).split('\n');
if (roots.length !== 1) throw Error('Expected an independent Git history');
const files = git('ls-tree', '-r', '--name-only', head).split('\n');
for (const file of files) if (/^(?:\.env(?:\.|$)|\.devspace\/|\.mrmak\/|\.cache\/|release\/|workspace\/devspace\/)|(?:^|\/)(?:auth|credentials|tokens?)\.json$/.test(file)) throw Error(`Private local file in commit: ${file}`);
for (const file of ['.github/workflows/release-build.yml', 'LICENSE', 'src/devspace/DevSpace.tsx']) if (!files.includes(file)) throw Error(`Required source file missing: ${file}`);
if (process.argv.includes('--check')) { console.log(`Publication preflight passed: ${repository}, ${tag}, ${head}, ${files.length} source files.`); process.exit(0); }

console.log(`${resume ? 'Resuming' : 'Publishing'} ${repository} ${tag}. No proxy or security settings are changed.`);
const progress = value => { mkdirSync(path.join(root, 'release'), { recursive: true }); writeFileSync(path.join(root, 'release/publication-progress.json'), JSON.stringify({ repository, tag, commit: head, updatedAt: new Date().toISOString(), ...value }, null, 2)); };
const profile = api('user', { pick: '{login}' });
if (profile.login.toLowerCase() !== owner.toLowerCase()) throw Error(`GitHub CLI must be signed in as ${owner}; current account: ${profile.login}`);
let remote = api(`repos/${repository}`, { allowFailure: true, pick: '{id, fork, private, owner: {login: .owner.login}}' });
if (!remote && resume) throw Error('Cannot resume: published repository is not accessible');
if (!remote) remote = api('user/repos', { method: 'POST', body: { name: 'dev-space', description: 'Local projects, materials and agent terminals', private: true, auto_init: false }, pick: '{id, fork, private, owner: {login: .owner.login}}' });
if (remote.fork || remote.owner?.login.toLowerCase() !== owner.toLowerCase()) throw Error('The target must be an independent repository owned by the expected account');
if (!resume) {
const origin = command('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
const url = `https://github.com/${repository}.git`;
if (origin.status !== 0) git('remote', 'add', 'origin', url);
else if (origin.stdout.trim() !== url) throw Error('Origin points to another repository; it was not changed');
// Per-command credential helper: no global Git configuration or token copies.
const credentialArgs = ['-c', 'credential.helper=', '-c', `credential.helper=!"${gh}" auth git-credential`];
const branch = api(`repos/${repository}/commits/main`, { allowFailure: true, allowEmpty: true, pick: '{sha}' });
if (branch && branch.sha !== head) {
  command('git', [...credentialArgs, 'fetch', '--no-tags', 'origin', 'main']);
  const ancestor = command('git', ['merge-base', '--is-ancestor', branch.sha, head], { allowFailure: true });
  if (ancestor.status !== 0) throw Error('Remote main has additional changes. Review and merge them before publishing. No force push was attempted.');
}
if (localTag.status === 0 && localTag.stdout.trim() !== head) throw Error('Local release tag points to a different commit');
if (localTag.status !== 0) git('tag', tag, head);
command('git', [...credentialArgs, 'push', '--atomic', '--set-upstream', 'origin', 'main', `refs/tags/${tag}`], { live: true });
const published = api(`repos/${repository}/commits/main`, { pick: '{sha}' });
if (published.sha !== head) throw Error('Uploaded source verification failed');
}
const publishedTag = api(`repos/${repository}/commits/${tag}`, { pick: '{sha}' });
if (publishedTag.sha !== head) throw Error('Published release tag points to a different source commit');
const rootCommit = api(`repos/${repository}/git/commits/${roots[0]}`, { pick: '{sha,parents}' });
if (rootCommit.parents.length !== 0) throw Error('New repository contains unexpected parent history');
progress({stage:'source-verified',visibility:remote.private?'private':'public'});

console.log(`Source verified. Waiting for Windows, Linux and macOS builds: https://github.com/${repository}/actions`);
let run;
for (let attempt = 0; attempt < 36; attempt++) {
  const result = command(gh, ['run', 'list', '--repo', repository, '--workflow', 'release-build.yml', '--commit', head, '--limit', '20', '--json', 'databaseId,headBranch,event,status,conclusion']);
  run = JSON.parse(result.stdout).find(item => item.headBranch === tag && item.event === 'push');
  if (run) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!run) { progress({stage:'workflow-not-found'}); throw Error('Source is uploaded, but the release workflow did not start. Check repository Actions settings.'); }
progress({stage:'building',runId:run.databaseId,runUrl:`https://github.com/${repository}/actions/runs/${run.databaseId}`});
const watched = run.conclusion === 'success' ? {status:0} : command(gh, ['run', 'watch', String(run.databaseId), '--repo', repository, '--interval', '15', '--exit-status'], { live: true, allowFailure: true });
if (watched.status !== 0) {
  const failed = command(gh, ['run','view',String(run.databaseId),'--repo',repository,'--log-failed'], {allowFailure:true});
  writeFileSync(path.join(root,'release/publication-failed-jobs.log'), failed.stdout || failed.stderr || 'No job logs returned');
  progress({stage:'build-failed',runId:run.databaseId,runUrl:`https://github.com/${repository}/actions/runs/${run.databaseId}`,logs:'release/publication-failed-jobs.log'});
  throw Error('Release build failed. Logs saved to release/publication-failed-jobs.log; the published tag was preserved.');
}

const release = api(`repos/${repository}/releases/tags/${tag}`, { pick: '{html_url,assets:[.assets[]|{name,size}]}' });
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
progress({stage:'verified',runId:run.databaseId,release:release.html_url,assets:expected});
console.log(`Release and all ${expected.length - 1} packages verified: ${release.html_url}`);
if(makePublic){
  const visible=api(`repos/${repository}`,{method:'PATCH',body:{private:false},pick:'{private}'});
  if(visible.private!==false)throw Error('Release is verified, but public visibility could not be confirmed.');
  console.log(`Public downloads enabled: ${release.html_url}`);
  progress({stage:'public',runId:run.databaseId,release:release.html_url,assets:expected,visibility:'public'});
}

// Cleanup is opt-in through a separately prepared private migration file.
if (cleanup) {
  const old = api(`repos/${cleanup.repository}`, { allowFailure: true, pick: '{id,fork,owner:{login:.owner.login}}' });
  if (old) {
    if (old.id !== cleanup.repositoryId || !old.fork || old.owner?.login.toLowerCase() !== owner.toLowerCase()) throw Error('Migration source identity does not match; deletion refused');
    api(`repos/${cleanup.repository}`, { method: 'DELETE' });
    if (api(`repos/${cleanup.repository}`, { allowFailure: true })) throw Error('Could not verify migration cleanup');
    console.log(`Removed the verified migration source: ${cleanup.repository}. Its local checkout is unchanged.`);
  }
}
console.log('Publication complete.');
progress({stage:'complete',runId:run.databaseId,release:release.html_url,assets:expected,visibility:makePublic||!remote.private?'public':'private'});
