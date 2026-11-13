import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cp, lstat, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { contents, permissions, validateManifest } from './manifest.mjs';
import { readJson, saveJson, within } from '../util.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const here = path.dirname(fileURLToPath(import.meta.url));
const allowedFiles = /\.(json|md|html|js|css|svg|png|jpe?g|webp|txt)$/i;
const MAX_FILES = 200, MAX_BYTES = 5 * 1024 * 1024;

// Every regular file of a plugin folder, with the limits a plugin must fit in.
async function pluginFiles(root) {
  const files = []; let bytes = 0;
  const walk = async folder => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(folder, entry.name), info = await lstat(full);
      if (info.isSymbolicLink()) throw fail('В плагине есть ссылка на файл вне его папки. Такой плагин не устанавливается.');
      if (info.isDirectory()) { await walk(full); continue; }
      if (!info.isFile() || !allowedFiles.test(entry.name)) throw fail(`В плагине есть файл недопустимого типа: ${entry.name}.`);
      bytes += info.size; files.push(path.relative(root, full).split(path.sep).join('/'));
      if (files.length > MAX_FILES || bytes > MAX_BYTES) throw fail('Плагин слишком большой: допустимо до 200 файлов и 5 МБ.');
    }
  };
  await walk(root);
  return files;
}
async function readPlugin(folder, { builtin = false } = {}) {
  let raw;
  try { raw = JSON.parse(await readFile(path.join(folder, 'plugin.json'), 'utf8')); }
  catch (error) { throw fail(error.code === 'ENOENT' ? 'В папке нет файла plugin.json.' : 'plugin.json не читается как JSON.'); }
  const manifest = validateManifest(raw, { builtin }), files = await pluginFiles(folder);
  const referenced = [...manifest.flows, ...manifest.instructions, ...manifest.views.filter(view => view.render.type === 'code').map(view => view.render.entry)];
  for (const file of referenced) if (!files.includes(file)) throw fail(`Плагин ссылается на файл «${file}», которого нет в его папке.`);
  return { manifest, folder, files };
}

export class Plugins {
  constructor({ repo, changed = () => {}, allowFileGit = false }) {
    this.builtinDir = path.join(here, 'builtin'); this.catalogDir = path.join(here, 'catalog');
    this.installedDir = path.join(repo, 'workspace', 'devspace', 'plugins');
    this.draftsDir = path.join(repo, 'workspace', 'devspace', 'proposals', 'plugins');
    this.tempDir = path.join(repo, '.devspace', 'plugin-inspect');
    this.changed = changed; this.allowFileGit = allowFileGit;
    this.items = new Map(); this.catalogItems = []; this.pending = new Map();
  }
  async init() {
    await mkdir(this.installedDir, { recursive: true }); await mkdir(this.draftsDir, { recursive: true });
    await rm(this.tempDir, { recursive: true, force: true });
    await this.reload();
    return this;
  }
  async reload() {
    const items = new Map(), index = await readJson(path.join(this.installedDir, 'index.json'), {});
    const folders = async root => (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    for (const name of await folders(this.builtinDir)) { const plugin = await readPlugin(path.join(this.builtinDir, name), { builtin: true }); items.set(plugin.manifest.id, { ...plugin, origin: 'builtin' }); }
    for (const name of await folders(this.installedDir)) {
      try { const plugin = await readPlugin(path.join(this.installedDir, name)); if (plugin.manifest.id === name && !items.has(name)) items.set(name, { ...plugin, origin: 'installed', installed: index[name] || {} }); }
      catch (error) { items.set(name, { manifest: { id: name, name, version: '', description: '', views: [], boards: [], connections: [], blocks: [], flows: [], instructions: [] }, folder: path.join(this.installedDir, name), files: [], origin: 'installed', installed: index[name] || {}, error: error.message }); }
    }
    this.items = items;
    this.catalogItems = [];
    for (const name of await folders(this.catalogDir)) try { this.catalogItems.push(await readPlugin(path.join(this.catalogDir, name))); } catch { /* A broken catalogue entry is not offered. */ }
  }
  describe(plugin) {
    const { manifest } = plugin;
    return { ...manifest, origin: plugin.origin, source: plugin.installed?.source || null, commit: plugin.installed?.commit || null, installedAt: plugin.installed?.at || null, error: plugin.error || null, permissions: permissions(manifest), contents: contents(manifest) };
  }
  list() { return [...this.items.values()].map(plugin => this.describe(plugin)); }
  catalog() { return this.catalogItems.filter(item => !this.items.has(item.manifest.id)).map(item => ({ ...this.describe({ ...item, origin: 'catalog' }), source: 'catalog:' + item.manifest.id })); }
  get(id) { return this.items.get(id); }
  // «plugin/part» references used by zones and boards.
  view(ref) { const [pluginId, viewId] = String(ref).split('/'), plugin = this.items.get(pluginId), view = plugin?.manifest.views.find(item => item.id === viewId); return view ? { plugin: plugin.manifest, view } : null; }
  connections() { return [...this.items.values()].flatMap(plugin => plugin.manifest.connections.map(connection => ({ id: `${plugin.manifest.id}-${connection.id}`, plugin: plugin.manifest, connection }))); }
  blocks() { return [...this.items.values()].flatMap(plugin => plugin.manifest.blocks.map(block => ({ ...block, id: `${plugin.manifest.id}/${block.id}`, plugin: plugin.manifest.name }))); }
  async flows() {
    const result = [];
    for (const plugin of this.items.values()) for (const file of plugin.manifest.flows) try { result.push({ plugin: plugin.manifest, file, flow: JSON.parse(await readFile(path.join(plugin.folder, file), 'utf8')) }); } catch { /* Reported by the flow library as unreadable. */ }
    return result;
  }
  async instructions() {
    const result = [];
    for (const plugin of this.items.values()) for (const file of plugin.manifest.instructions) result.push({ plugin: plugin.manifest.name, title: path.basename(file), text: (await readFile(path.join(plugin.folder, file), 'utf8')).slice(0, 20000) });
    return result;
  }
  async viewCode(pluginId, viewId) {
    const plugin = this.items.get(pluginId), view = plugin?.manifest.views.find(item => item.id === viewId);
    if (view?.render.type !== 'code') throw fail('У этого вида нет своего кода.', 404);
    const file = path.join(plugin.folder, view.render.entry);
    if (!within(plugin.folder, file) || (await stat(file)).size > 1024 * 1024) throw fail('Файл вида недоступен.', 404);
    return { html: await readFile(file, 'utf8'), hosts: view.render.hosts || [] };
  }

  // Looks at a plugin before anything is installed: where it comes from, what is
  // inside and what it would be able to do. The answer carries a short-lived
  // ticket; install() accepts only that ticket, so what was shown is what lands.
  async inspect(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > 500) throw fail('Укажите папку плагина или ссылку на Git-репозиторий.');
    source = source.trim();
    const ticket = randomUUID(), target = path.join(this.tempDir, ticket);
    let origin;
    await mkdir(this.tempDir, { recursive: true });
    try {
      if (source.startsWith('catalog:')) { const item = this.catalogItems.find(entry => entry.manifest.id === source.slice(8)); if (!item) throw fail('Плагин не найден в каталоге.', 404); await this.copy(item.folder, target); origin = { type: 'catalog', value: source }; }
      else if (source.startsWith('draft:')) { const id = source.slice(6); if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw fail('Черновик плагина не найден.', 404); await this.copy(path.join(this.draftsDir, id), target); origin = { type: 'draft', value: source }; }
      else if (/^(https:\/\/|git@|file:\/\/)/.test(source) || /^[\w.-]+\.[a-z]{2,}\/[\w./-]+$/.test(source)) { origin = { type: 'git', ...(await this.clone(source, target)) }; }
      else { const folder = path.resolve(source); if (!(await stat(folder).catch(() => null))?.isDirectory()) throw fail('Папка плагина не найдена.'); await this.copy(folder, target); origin = { type: 'folder', value: folder }; }
      const plugin = await readPlugin(target), existing = this.items.get(plugin.manifest.id);
      if (existing?.origin === 'builtin') throw fail(`Плагин «${plugin.manifest.id}» уже встроен в Dev Space.`);
      this.pending.set(ticket, { target, origin, id: plugin.manifest.id, at: Date.now() });
      for (const [key, item] of this.pending) if (Date.now() - item.at > 30 * 60000) { this.pending.delete(key); await rm(item.target, { recursive: true, force: true }); }
      return { ticket, origin, replaces: existing ? existing.manifest.version : null, plugin: this.describe({ ...plugin, origin: origin.type }) };
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  }
  async copy(from, to) {
    await pluginFiles(from);
    await cp(from, to, { recursive: true, filter: source => !path.basename(source).startsWith('.') || source === from });
  }
  async clone(source, target) {
    let url = /^[\w.-]+\.[a-z]{2,}\//.test(source) ? 'https://' + source : source;
    if (url.startsWith('file://') && !this.allowFileGit) throw fail('Установка по ссылке работает с адресами https://.');
    if (!/^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+|git@[\w.-]+:[\w./~-]+|file:\/\/\/[\w./~ -]+)$/.test(url)) throw fail('Ссылка на репозиторий выглядит некорректно.');
    const run = promisify(execFile), env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    try { await run('git', ['clone', '--depth', '1', '--no-tags', '--single-branch', '--', url, target], { env, timeout: 90000, windowsHide: true }); }
    catch (error) { throw fail('Не удалось получить репозиторий: ' + String(error.stderr || error.message).split('\n').filter(Boolean).pop()?.slice(0, 200)); }
    const commit = (await run('git', ['-C', target, 'rev-parse', 'HEAD'], { env, windowsHide: true })).stdout.trim();
    await rm(path.join(target, '.git'), { recursive: true, force: true });
    return { value: url, commit };
  }
  async install(ticket) {
    const pending = this.pending.get(ticket);
    if (!pending) throw fail('Предпросмотр устарел. Откройте плагин ещё раз.', 409);
    const plugin = await readPlugin(pending.target), id = plugin.manifest.id, destination = path.join(this.installedDir, id);
    await rm(destination, { recursive: true, force: true });
    await cp(pending.target, destination, { recursive: true });
    await rm(pending.target, { recursive: true, force: true }); this.pending.delete(ticket);
    const index = await readJson(path.join(this.installedDir, 'index.json'), {});
    index[id] = { source: pending.origin.value, type: pending.origin.type, commit: pending.origin.commit || null, version: plugin.manifest.version, at: new Date().toISOString() };
    await saveJson(path.join(this.installedDir, 'index.json'), index);
    await this.reload(); this.changed();
    return this.describe(this.items.get(id));
  }
  async uninstall(id) {
    const plugin = this.items.get(id);
    if (!plugin || plugin.origin !== 'installed') throw fail('Удалить можно только установленный плагин.');
    await rm(plugin.folder, { recursive: true, force: true });
    const index = await readJson(path.join(this.installedDir, 'index.json'), {}); delete index[id];
    await saveJson(path.join(this.installedDir, 'index.json'), index);
    await this.reload(); this.changed();
    return { removed: id };
  }
  // Plugins an agent has prepared and nobody has accepted yet.
  async drafts() {
    const result = [];
    for (const entry of await readdir(this.draftsDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.name)) continue;
      const folder = path.join(this.draftsDir, entry.name);
      const extra = { request: (await readFile(path.join(folder, 'request.md'), 'utf8').catch(() => '')).slice(0, 4000), sample: await readJson(path.join(folder, 'sample.json'), null) };
      try { const plugin = await readPlugin(folder); result.push({ id: entry.name, ...extra, plugin: this.describe({ ...plugin, origin: 'draft' }) }); }
      catch (error) { result.push({ id: entry.name, ...extra, error: error.message }); }
    }
    return result;
  }
  async discardDraft(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw fail('Черновик плагина не найден.', 404);
    await rm(path.join(this.draftsDir, id), { recursive: true, force: true }); this.changed();
    return { removed: id };
  }
  // Checks a draft folder the way a flow step does: the manifest must pass and
  // the sample data must be present.
  async checkDraft(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(id))) throw fail('ID плагина — латинские буквы, цифры и дефис.');
    const folder = path.join(this.draftsDir, id), plugin = await readPlugin(folder);
    if (plugin.manifest.id !== id) throw fail(`В plugin.json указан ID «${plugin.manifest.id}», а папка называется «${id}».`);
    const sample = await readJson(path.join(folder, 'sample.json'), null);
    if (!Array.isArray(sample?.things) || !sample.things.length) throw fail('В sample.json нужен список «things» с примером данных.');
    return this.describe({ ...plugin, origin: 'draft' });
  }
}
