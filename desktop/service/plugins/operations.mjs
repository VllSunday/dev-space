import path from 'node:path';
import { readJson, saveJson } from '../util.mjs';
import { plainText } from '../things.mjs';
import { roles } from './roles.mjs';

// Runs the operations that plugin connections declare. An operation is data: a
// request template and a rule for reading the answer. Dev Space makes the
// request itself, only to the hosts the connection declared, and adds the key
// from its own store. The plugin never sees the key and has no code here.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_RESPONSE = 2 * 1024 * 1024;
const pick = (value, dotted) => String(dotted).split('.').reduce((current, key) => current == null ? undefined : current[key], value);

// Fills «{{setting.team}}», «{{param.id}}» and «{{status.native}}» in a template.
// A string that is exactly one placeholder keeps the value's own type.
function fill(template, scope, encode = value => value) {
  if (typeof template === 'string') {
    const whole = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(template);
    const lookup = name => { const value = pick(scope, name); if (value === undefined || value === null || value === '') throw fail(`Для операции не задано значение «${name}».`); return value; };
    if (whole) return lookup(whole[1]);
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name) => encode(String(lookup(name))));
  }
  if (Array.isArray(template)) return template.map(item => fill(item, scope, encode));
  if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([key, item]) => [key, fill(item, scope, encode)]));
  return template;
}

export class Operations {
  constructor({ plugins, repo, stateDir, native = {}, fetch: fetcher = globalThis.fetch }) {
    this.plugins = plugins; this.native = native; this.fetch = fetcher;
    this.configFile = path.join(repo, 'workspace', 'devspace', 'connections.json');
    this.secretFile = path.join(stateDir, 'secrets.json');
    this.config = {}; this.secrets = {};
  }
  async init() { this.config = await readJson(this.configFile, {}); this.secrets = await readJson(this.secretFile, {}); return this; }
  find(id) {
    const found = this.plugins.connections().find(item => item.id === id);
    if (!found) throw fail('Подключение не найдено. Возможно, его плагин удалён.', 404);
    return found;
  }
  describe({ id, plugin, connection }) {
    const settings = this.config[id]?.settings || {}, missing = connection.settings.filter(item => item.required && !settings[item.id]).map(item => item.title);
    if (connection.auth && !this.secrets[id]) missing.push(connection.auth.label);
    return {
      id, pluginId: plugin.id, pluginName: plugin.name, title: connection.title, description: connection.description || '', hosts: connection.hosts, itemKind: connection.itemKind,
      role: connection.plays?.role || null, roleTitle: roles[connection.plays?.role]?.title || null, statuses: connection.plays?.statuses || {},
      settings: connection.settings.map(item => ({ ...item, value: settings[item.id] || '' })),
      auth: connection.auth ? { label: connection.auth.label, help: connection.auth.help || '', saved: !!this.secrets[id] } : null,
      operations: Object.entries(connection.operations).map(([name, item]) => ({ name, kind: item.kind, title: item.title, role: Object.entries(connection.plays?.operations || {}).find(([, own]) => own === name)?.[0] || null })),
      ready: !missing.length, missing,
    };
  }
  list() { return this.plugins.connections().map(item => this.describe(item)); }
  players(roleId) { return this.list().filter(item => item.role === roleId); }
  async configure(id, { settings, secret } = {}) {
    const { connection } = this.find(id);
    if (settings !== undefined) {
      const next = {};
      for (const item of connection.settings) { const value = settings?.[item.id]; if (value === undefined || value === '') continue; if (typeof value !== 'string' || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) throw fail(`Настройка «${item.title}» заполнена некорректно.`); next[item.id] = value.trim(); }
      this.config = { ...this.config, [id]: { settings: next } }; await saveJson(this.configFile, this.config);
    }
    if (secret !== undefined) {
      if (!connection.auth) throw fail('Этому подключению ключ не нужен.');
      if (secret !== null && (typeof secret !== 'string' || !secret.trim() || secret.length > 2000 || /[\x00-\x1f\x7f]/.test(secret))) throw fail('Ключ пуст или содержит недопустимые символы.');
      this.secrets = { ...this.secrets }; if (secret === null) delete this.secrets[id]; else this.secrets[id] = secret.trim();
      await saveJson(this.secretFile, this.secrets);
    }
    return this.describe(this.find(id));
  }

  // Calls one declared operation. `context.projectId` tells built-in operations
  // which project they work in.
  async call(id, name, params = {}, context = {}, depth = 0) {
    const found = this.find(id), { connection } = found, operation = connection.operations[name];
    if (!operation) throw fail(`У подключения «${connection.title}» нет операции «${name}».`, 404);
    if (operation.kind === 'event') throw fail('За событиями следит Dev Space; вызвать их нельзя.');
    params = { ...params };
    for (const [key, definition] of Object.entries(operation.params)) if (definition.required && (params[key] === undefined || params[key] === '')) throw fail(`Операции «${operation.title}» нужен параметр «${definition.title}».`);
    if (operation.request.native) {
      const run = this.native[operation.request.native];
      if (!run) throw fail('Встроенная операция недоступна.', 500);
      return run(params, context);
    }
    const status = this.describe(found);
    if (!status.ready) throw fail(`Подключение «${connection.title}» не настроено: ${status.missing.join(', ')}.`, 409);
    const scope = { setting: this.config[id]?.settings || {}, param: params, status: { native: connection.plays?.statuses?.[params.status] } };
    for (const [key, rule] of Object.entries(operation.lookup || {})) {
      if (depth > 1) throw fail('Операции плагина ссылаются друг на друга по кругу.');
      const wanted = fill(rule.where, scope), { items } = await this.call(id, rule.operation, params, context, depth + 1);
      const match = items.find(item => Object.entries(wanted).every(([field, value]) => String(item[field] ?? '') === String(value)));
      if (!match) throw fail(`В сервисе не нашлось значения для «${key}».`, 409);
      scope.param[key] = match[rule.take];
    }
    const payload = await this.request(connection, operation, scope, id);
    if (operation.kind === 'read') return { items: this.items(id, connection, operation, payload) };
    return { ok: true, result: operation.result ? pick(payload, operation.result) ?? null : null };
  }
  async request(connection, operation, scope, id) {
    const url = new URL(fill(operation.request.url, scope, encodeURIComponent));
    for (const [key, value] of Object.entries(fill(operation.request.query || {}, scope))) url.searchParams.set(key, String(value));
    if (url.protocol !== 'https:' || !connection.hosts.includes(url.hostname.toLowerCase()) || url.username || url.password) throw fail('Операция обращается к адресу, который плагин не объявлял.', 403);
    const headers = { Accept: 'application/json', ...fill(operation.request.headers || {}, scope) };
    if (connection.auth) headers[connection.auth.type === 'bearer' ? 'Authorization' : connection.auth.header] = (connection.auth.type === 'bearer' ? 'Bearer ' : connection.auth.prefix || '') + this.secrets[id];
    let body;
    if (operation.request.body !== undefined) { const filled = fill(operation.request.body, scope); body = typeof filled === 'string' ? filled : JSON.stringify(filled); if (typeof filled !== 'string') headers['Content-Type'] = 'application/json'; }
    let response;
    try { response = await this.fetch(url, { method: operation.request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
    catch (error) { throw fail(`Сервис ${url.hostname} не ответил: ${error.name === 'TimeoutError' ? 'истекло время ожидания' : 'нет соединения'}.`, 502); }
    if (response.status >= 300 && response.status < 400) throw fail(`Сервис ${url.hostname} перенаправляет на другой адрес. Запрос отменён.`, 502);
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE) throw fail('Ответ сервиса слишком большой.', 502);
    let payload = null; try { payload = raw ? JSON.parse(raw) : null; } catch { /* Reported below. */ }
    const detail = payload?.errors?.[0]?.message || payload?.message || payload?.error;
    if (!response.ok || Array.isArray(payload?.errors) && payload.errors.length) throw fail(`Сервис ${url.hostname} ответил ошибкой${response.ok ? '' : ' ' + response.status}${detail ? ': ' + plainText(typeof detail === 'string' ? detail : JSON.stringify(detail), 200) : ''}.`, 502);
    if (payload === null && raw) throw fail(`Сервис ${url.hostname} вернул ответ, который не читается как JSON.`, 502);
    return payload;
  }
  // Answers become things of the usual shape. All text is trimmed and cleaned:
  // it is data from outside, shown to people and quoted to agents, never run.
  items(id, connection, operation, payload) {
    const list = operation.items ? pick(payload, operation.items) : payload;
    if (!Array.isArray(list)) throw fail('Ответ сервиса не содержит списка, который ожидает плагин. Возможно, сервис изменился.', 502);
    return list.slice(0, 500).map(source => {
      const value = field => { const rule = operation.map?.[field]; if (!rule) return undefined; const found = pick(source, rule.path); if (found === undefined || found === null) return undefined; const mapped = rule.values ? rule.values[String(found)] : found; return mapped === undefined ? undefined : (rule.prefix || '') + plainText(mapped, field === 'text' ? 4000 : 300); };
      const itemId = value('id');
      if (!itemId) throw fail('В ответе сервиса у записи нет ID. Возможно, сервис изменился.', 502);
      const group = value('statusGroup'), link = value('url');
      return { ref: `ext:${id}:${itemId}`, id: itemId, kind: connection.itemKind, external: id, title: value('title') || itemId, text: value('text') || '', key: value('key'), status: value('status'), statusGroup: ['todo', 'doing', 'done'].includes(group) ? group : undefined, assignee: value('assignee'), url: link && /^https:\/\//.test(link) ? link : undefined, updated: value('updated') };
    });
  }
  // Calls an operation through the role a connection plays, so flows never name a service.
  async callRole(id, roleId, roleOperation, params = {}, context = {}) {
    const { connection } = this.find(id), role = roles[roleId];
    if (!role || connection.plays?.role !== roleId) throw fail(`Подключение «${connection.title}» не играет роль «${role?.title || roleId}».`, 409);
    const own = connection.plays.operations[roleOperation];
    if (!own) throw fail(`«${connection.title}» не умеет «${role.operations[roleOperation]?.title || roleOperation}».`, 409);
    if (roleOperation === 'setStatus' && !['todo', 'doing', 'done'].includes(params.status)) throw fail('Группа статуса — todo, doing или done.');
    return this.call(id, own, params, context);
  }
}
