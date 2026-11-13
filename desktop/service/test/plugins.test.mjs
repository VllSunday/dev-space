import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Plugins } from '../plugins/registry.mjs';
import { Operations } from '../plugins/operations.mjs';
import { permissions, validateManifest } from '../plugins/manifest.mjs';

const temp = name => mkdtemp(path.join(os.tmpdir(), `devspace-${name}-`));
const fixture = async name => JSON.parse(await readFile(new URL(`../../../checks/fixtures/linear/${name}.json`, import.meta.url), 'utf8'));
const view = { id: 'v', title: 'Вид', level: 'zone', accepts: ['task'], actions: ['thing.status'], render: { type: 'parts', parts: [{ part: 'list' }] } };
const base = { plugin: 1, id: 'demo', name: 'Демо', description: 'Пример.' };

test('built-in views are plugins described by the same manifest as third-party ones', async () => {
  const plugins = await new Plugins({ repo: await temp('repo') }).init();
  const list = plugins.list();
  assert.deepEqual(list.map(item => item.id).sort(), ['columns', 'core', 'documents', 'model3d', 'tasks']);
  assert.ok(list.every(item => item.origin === 'builtin' && !item.error));
  assert.equal(plugins.view('core/tiles').view.render.type, 'parts');
  assert.equal(plugins.view('model3d/viewer').view.accepts[0], 'model');
  assert.equal(plugins.view('tasks/columns').plugin.id, 'tasks');
  assert.ok(list.find(item => item.id === 'columns').boards[0].layout === 'columns', 'a plugin changes the board itself');
  // Native components and built-in operations are not available to other plugins.
  assert.throws(() => validateManifest({ ...base, views: [{ ...view, render: { type: 'native', component: 'model' } }] }), /parts.*code/);
  assert.throws(() => validateManifest({ ...base, connections: [{ id: 'c', title: 'C', operations: { list: { kind: 'read', title: 'x', request: { native: 'tasks.list' } } } }] }), /встроенным плагинам/);
});

test('what a plugin reads, changes and reaches is computed from the manifest', () => {
  const manifest = validateManifest({ ...base, views: [view, { ...view, id: 'c', actions: ['thing.open'], render: { type: 'code', entry: 'view.html', hosts: ['cdn.example.com'] } }],
    connections: [{ id: 'api', title: 'Сервис', hosts: ['api.example.com'], auth: { type: 'bearer', label: 'Ключ' }, operations: { list: { kind: 'read', title: 'список', request: { method: 'GET', url: 'https://api.example.com/items' } }, close: { kind: 'action', title: 'закрыть', request: { method: 'POST', url: 'https://api.example.com/close' } } } }] });
  const rights = permissions(manifest);
  assert.deepEqual(rights.reads, ['вещи зоны, в которой включён вид: задачи', 'Сервис: список']);
  assert.deepEqual(rights.changes, ['менять статус задачи', 'Сервис: закрыть']);
  assert.deepEqual(rights.network, ['cdn.example.com', 'api.example.com']);
  assert.equal(rights.code, true);
  assert.match(rights.keys[0], /плагин его не получает/);
});

test('a manifest cannot reach undeclared hosts, set login headers or ask for unknown actions', () => {
  const connection = (operation, extra = {}) => ({ ...base, connections: [{ id: 'api', title: 'Сервис', hosts: ['api.example.com'], operations: { list: { kind: 'read', title: 'список', request: operation } }, ...extra }] });
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'https://evil.example.org/x' })), /объявленных адресов/);
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'http://api.example.com/x' })), /https/);
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'https://api.example.com.evil.org/x' })), /объявленных адресов/);
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'https://{{setting.host}}/x' })), /объявленных адресов/);
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'https://api.example.com/x', headers: { Authorization: 'Bearer {{setting.key}}' } })), /подставляет Dev Space/);
  assert.throws(() => validateManifest({ ...base, views: [{ ...view, actions: ['fs.write'] }] }), /действие вида/);
  assert.throws(() => validateManifest({ ...base, views: [{ ...view, render: { type: 'code', entry: '../../secret.html' } }] }), /путь внутри папки/);
  assert.throws(() => validateManifest({ ...base, boards: [{ id: 'b', title: 'B', layout: 'free', look: { background: 'url(javascript:1)' } }] }), /оформление доски/);
  assert.throws(() => validateManifest({ ...base }), /Плагин пуст/);
  // A connection that claims a role must provide what the role requires.
  assert.throws(() => validateManifest(connection({ method: 'GET', url: 'https://api.example.com/x' }, { plays: { role: 'tracker', operations: { list: 'list' } } })), /сменить статус/);
});

test('a plugin is installed from a folder or a Git link only after its rights are shown', async () => {
  const repo = await temp('repo'), plugins = await new Plugins({ repo, allowFileGit: true }).init();
  const folder = path.join(await temp('plugin'), 'chart');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'plugin.json'), JSON.stringify({ ...base, id: 'chart', name: 'График', views: [{ ...view, render: { type: 'code', entry: 'view.html' } }] }));
  await writeFile(path.join(folder, 'view.html'), '<p>chart</p>');
  const shown = await plugins.inspect(folder);
  assert.equal(shown.origin.type, 'folder'); assert.equal(shown.plugin.permissions.code, true);
  assert.ok(!plugins.get('chart'), 'looking installs nothing');
  await assert.rejects(plugins.install('00000000-0000-0000-0000-000000000000'), /Предпросмотр устарел/);
  await plugins.install(shown.ticket);
  assert.equal(plugins.get('chart').origin, 'installed');
  assert.equal((await plugins.viewCode('chart', 'v')).html, '<p>chart</p>');
  // From Git: the commit is recorded, so the plugin stays on the version it was installed with.
  const git = (...args) => execFileSync('git', ['-C', folder, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args]);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'plugin');
  await plugins.uninstall('chart');
  const fromGit = await plugins.inspect('file://' + folder);
  assert.equal(fromGit.origin.type, 'git'); assert.match(fromGit.origin.commit, /^[0-9a-f]{40}$/);
  const installed = await plugins.install(fromGit.ticket);
  assert.equal(installed.commit, fromGit.origin.commit);
  assert.ok(!(await readdir(path.join(repo, 'workspace/devspace/plugins/chart'))).includes('.git'));
  // Refused before anything is copied.
  await symlink('/etc/passwd', path.join(folder, 'leak.txt'));
  await assert.rejects(plugins.inspect(folder), /ссылка на файл вне его папки/);
  await assert.rejects(new Plugins({ repo }).clone('file://' + folder, path.join(repo, 'x')), /https/);
  await assert.rejects(plugins.inspect('https://example.com/$(touch pwned)'), /выглядит некорректно/);
  await assert.rejects(plugins.inspect(path.join(repo, 'workspace')), /plugin\.json/);
  const core = path.join(await temp('plugin'), 'core'); await mkdir(core);
  await writeFile(path.join(core, 'plugin.json'), JSON.stringify({ ...base, id: 'core', views: [view] }));
  await assert.rejects(plugins.inspect(core), /уже встроен/);
});

async function linear(answers) {
  const repo = await temp('repo'), stateDir = path.join(repo, '.devspace'), calls = [];
  const plugins = await new Plugins({ repo }).init();
  await plugins.install((await plugins.inspect('catalog:linear')).ticket);
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), ...options, body: JSON.parse(options.body) });
    const answer = await answers(calls.at(-1));
    return { ok: (answer.status || 200) < 300, status: answer.status || 200, text: async () => JSON.stringify(answer.body) };
  };
  const operations = await new Operations({ plugins, repo, stateDir, fetch: fetcher }).init();
  return { repo, stateDir, plugins, operations, calls };
}

test('the Linear connection reads issues and changes a status on recorded answers', async () => {
  const issues = await fixture('issues'), states = await fixture('states'), updated = await fixture('issue-update');
  const { repo, stateDir, operations, calls } = await linear(call => ({ body: call.body.query.includes('issueUpdate') ? updated : call.body.query.includes('workflowStates') ? states : issues }));
  await assert.rejects(operations.call('linear-issues', 'list'), /не настроено: Ключ команды, Личный ключ API Linear/);
  assert.equal(calls.length, 0, 'nothing is sent before the connection is set up');
  const described = await operations.configure('linear-issues', { settings: { team: 'ENG' }, secret: 'lin_api_secret_value' });
  assert.equal(described.ready, true); assert.equal(described.auth.saved, true);
  assert.ok(!JSON.stringify(described).includes('lin_api_secret_value'), 'the key is never returned');
  assert.ok(!(await readFile(path.join(repo, 'workspace/devspace/connections.json'), 'utf8')).includes('lin_api_secret_value'), 'the key is not kept with project data');
  assert.equal(JSON.parse(await readFile(path.join(stateDir, 'secrets.json'), 'utf8'))['linear-issues'], 'lin_api_secret_value');

  const { items } = await operations.callRole('linear-issues', 'tracker', 'list');
  assert.deepEqual(items.map(item => [item.key, item.statusGroup, item.status, item.assignee]), [['ENG-13', 'doing', 'In Progress', 'Женя'], ['ENG-14', 'todo', 'Todo', undefined], ['ENG-15', 'todo', 'Backlog', undefined], ['ENG-16', 'done', 'Done', 'Каир']]);
  assert.equal(items[0].kind, 'task'); assert.equal(items[0].ref, 'ext:linear-issues:9f1c2a50-3d1b-4c1e-9a55-1a2b3c4d5e01');
  assert.equal(calls[0].url, 'https://api.linear.app/graphql'); assert.equal(calls[0].headers.Authorization, 'lin_api_secret_value');
  assert.deepEqual(calls[0].body.variables, { team: 'ENG' }); assert.equal(calls[0].redirect, 'manual');

  // The role speaks in status groups; the plugin finds its own state for the group.
  await operations.callRole('linear-issues', 'tracker', 'setStatus', { id: items[1].id, status: 'doing' });
  assert.deepEqual(calls.at(-1).body.variables, { id: items[1].id, stateId: 'st-progress' });
  await operations.callRole('linear-issues', 'tracker', 'setStatus', { id: items[1].id, status: 'done' });
  assert.equal(calls.at(-1).body.variables.stateId, 'st-done');
  await assert.rejects(operations.callRole('linear-issues', 'tracker', 'setStatus', { id: items[1].id, status: 'archived' }), /Группа статуса/);
  await assert.rejects(operations.callRole('tasks-local', 'tracker', 'comment', { id: 'x', text: 'y' }), /не умеет/);
});

test('service errors, redirects and changed answers are reported, not passed on', async () => {
  const denied = await linear(async () => ({ body: await fixture('error-auth') }));
  await denied.operations.configure('linear-issues', { settings: { team: 'ENG' }, secret: 'bad' });
  await assert.rejects(denied.operations.call('linear-issues', 'list'), /ответил ошибкой: Authentication required/);
  const moved = await linear(() => ({ status: 302, body: {} }));
  await moved.operations.configure('linear-issues', { settings: { team: 'ENG' }, secret: 'k' });
  await assert.rejects(moved.operations.call('linear-issues', 'list'), /перенаправляет на другой адрес/);
  const changed = await linear(() => ({ body: { data: { issues: { edges: [] } } } }));
  await changed.operations.configure('linear-issues', { settings: { team: 'ENG' }, secret: 'k' });
  await assert.rejects(changed.operations.call('linear-issues', 'list'), /сервис изменился/);
  await assert.rejects(changed.operations.configure('linear-issues', { secret: 'a\nb' }), /недопустимые символы/);
  await assert.rejects(changed.operations.call('linear-issues', 'nope'), /нет операции/);
});
