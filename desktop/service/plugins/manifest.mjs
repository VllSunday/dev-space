import { rolePlayProblems, roles } from './roles.mjs';

// plugin.json is the whole contract between Dev Space and a plugin. Built-in
// and third-party plugins are described by the same file. This module checks it
// and derives what the plugin reads, changes and reaches on the network, so a
// plugin cannot describe itself more mildly than it is.
const fail = message => Object.assign(new Error(message), { status: 400 });
const idPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const filePattern = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._/-]{0,119}$/;
const hostPattern = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
export const thingKinds = ['note', 'image', 'file', 'link', 'model', 'page', 'task', 'external'];
export const viewActions = { 'thing.open': 'открывать вещь', 'thing.status': 'менять статус задачи', 'thing.create': 'добавлять вещи в зону' };
export const partNames = ['list', 'tiles', 'gallery', 'columns', 'table', 'counter', 'outline'];
export const thingFields = ['title', 'text', 'kind', 'status', 'statusGroup', 'key', 'assignee', 'url', 'updated'];
export const nativeComponents = ['materials', 'document', 'model', 'image', 'material', 'task'];
const lookValues = { background: ['dots', 'grid', 'plain'], zone: ['card', 'outline', 'flat'], density: ['cozy', 'compact'] };

const text = (value, what, max = 300) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) throw fail(`Плагин: ${what} — нужен текст до ${max} знаков.`); return value.trim(); };
const optional = (value, what, max) => value === undefined || value === null || value === '' ? undefined : text(value, what, max);
const ident = (value, what) => { if (typeof value !== 'string' || !idPattern.test(value)) throw fail(`Плагин: ${what} — латинские буквы, цифры и дефис.`); return value; };
const list = (value, what, max = 60) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw fail(`Плагин: ${what} — нужен список до ${max} записей.`); return value; };
const unique = (items, what) => { const seen = new Set(); for (const item of items) { if (seen.has(item.id)) throw fail(`Плагин: ${what} «${item.id}» объявлен дважды.`); seen.add(item.id); } return items; };
const file = (value, what) => { if (typeof value !== 'string' || !filePattern.test(value) || value.startsWith('/')) throw fail(`Плагин: ${what} — путь внутри папки плагина.`); return value; };
const clean = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function part(value) {
  if (!value || !partNames.includes(value.part)) throw fail(`Плагин: деталь вида — одна из ${partNames.join(', ')}.`);
  const field = (name, what) => { if (!thingFields.includes(name)) throw fail(`Плагин: ${what} — одно из полей ${thingFields.join(', ')}.`); return name; };
  if (value.part === 'list') return clean({ part: 'list', fields: value.fields ? list(value.fields, 'поля списка', 4).map(name => field(name, 'поле списка')) : undefined });
  if (value.part === 'tiles') return clean({ part: 'tiles', columns: Number.isInteger(value.columns) && value.columns >= 1 && value.columns <= 6 ? value.columns : undefined });
  if (value.part === 'columns') return clean({ part: 'columns', by: field(value.by || 'statusGroup', 'поле колонок'), columns: value.columns ? list(value.columns, 'колонки', 12).map(column => ({ value: text(String(column?.value ?? ''), 'значение колонки', 80), title: text(column?.title, 'название колонки', 60) })) : undefined });
  if (value.part === 'table') return { part: 'table', columns: list(value.columns, 'столбцы таблицы', 8).map(column => ({ field: field(column?.field, 'поле столбца'), title: text(column?.title, 'название столбца', 60) })) };
  if (value.part === 'counter') return { part: 'counter', counters: list(value.counters, 'счётчики', 8).map(counter => clean({ title: text(counter?.title, 'название счётчика', 60), where: counter?.where ? { field: field(counter.where.field, 'поле счётчика'), equals: text(String(counter.where.equals ?? ''), 'значение счётчика', 80) } : undefined })) };
  return { part: value.part };
}
function render(value, builtin) {
  if (value?.type === 'parts') { const parts = list(value.parts, 'детали вида', 6).map(part); if (!parts.length) throw fail('Плагин: в виде нет ни одной детали.'); return { type: 'parts', parts }; }
  if (value?.type === 'code') return { type: 'code', entry: file(value.entry, 'файл вида'), hosts: hosts(value.hosts) };
  if (value?.type === 'native' && builtin && nativeComponents.includes(value.component)) return { type: 'native', component: value.component };
  throw fail('Плагин: показ вида — «parts» (из готовых деталей) или «code» (свой HTML).');
}
function hosts(value) {
  return list(value, 'адреса сети', 10).map(host => { if (typeof host !== 'string' || !hostPattern.test(host)) throw fail('Плагин: адрес сети — имя сайта без протокола и пути, например api.example.com.'); return host.toLowerCase(); });
}
function view(value, builtin) {
  const accepts = list(value?.accepts ?? ['*'], 'типы вещей', 10);
  if (accepts.some(kind => kind !== '*' && !thingKinds.includes(kind))) throw fail(`Плагин: тип вещи — один из ${thingKinds.join(', ')} или «*».`);
  const actions = list(value?.actions, 'действия вида', 10);
  if (actions.some(action => !viewActions[action])) throw fail(`Плагин: действие вида — одно из ${Object.keys(viewActions).join(', ')}.`);
  if (!['zone', 'thing'].includes(value?.level)) throw fail('Плагин: уровень вида — «zone» или «thing».');
  return clean({ id: ident(value.id, 'ID вида'), title: text(value.title, 'название вида', 60), description: optional(value.description, 'описание вида'), level: value.level, accepts, actions, render: render(value.render, builtin) });
}
function board(value) {
  if (!['free', 'columns'].includes(value?.layout)) throw fail('Плагин: раскладка доски — «free» или «columns».');
  const look = {};
  for (const [key, allowed] of Object.entries(lookValues)) if (value.look?.[key] !== undefined) { if (!allowed.includes(value.look[key])) throw fail(`Плагин: оформление доски «${key}» — одно из ${allowed.join(', ')}.`); look[key] = value.look[key]; }
  if (value.look?.accent !== undefined) { if (typeof value.look.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.look.accent)) throw fail('Плагин: цвет доски — в формате #RRGGBB.'); look.accent = value.look.accent.toLowerCase(); }
  return clean({ id: ident(value.id, 'ID вида доски'), title: text(value.title, 'название вида доски', 60), description: optional(value.description, 'описание вида доски'), layout: value.layout, links: value.links === true, look });
}
// Request templates may only carry strings, numbers, booleans, lists and objects.
function template(value, depth = 0) {
  if (depth > 8) throw fail('Плагин: слишком глубокий шаблон запроса.');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) { if (typeof value === 'string' && value.length > 6000) throw fail('Плагин: слишком длинная строка в шаблоне запроса.'); return value; }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => template(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [key, template(item, depth + 1)]));
  throw fail('Плагин: в шаблоне запроса допустимы только простые значения.');
}
function operation(name, value, connection, builtin) {
  if (!['read', 'event', 'action'].includes(value?.kind)) throw fail(`Плагин: вид операции «${name}» — read, event или action.`);
  const result = { kind: value.kind, title: text(value.title, `название операции «${name}»`, 80), params: {} };
  for (const [param, definition] of Object.entries(value.params || {}).slice(0, 12)) { ident(param.toLowerCase(), 'параметр операции'); result.params[param] = clean({ title: text(definition?.title || param, 'название параметра', 80), required: definition?.required === true || undefined }); }
  const request = value.request;
  if (request?.native) { if (!builtin || typeof request.native !== 'string') throw fail('Плагин: встроенные операции доступны только встроенным плагинам.'); result.request = { native: request.native }; }
  else {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request?.method)) throw fail(`Плагин: метод запроса операции «${name}» — GET, POST, PUT, PATCH или DELETE.`);
    const url = text(request.url, `адрес операции «${name}»`, 600);
    const host = /^https:\/\/([^/?#{}]+)(?=[/?#]|$)/.exec(url)?.[1];
    if (!host || !connection.hosts.includes(host.toLowerCase())) throw fail(`Плагин: адрес операции «${name}» должен начинаться с https:// и одного из объявленных адресов сети.`);
    result.request = clean({ method: request.method, url, headers: request.headers ? template(request.headers) : undefined, query: request.query ? template(request.query) : undefined, body: request.body === undefined ? undefined : template(request.body) });
    for (const header of Object.keys(result.request.headers || {})) if (/^(authorization|cookie|host|proxy-authorization)$/i.test(header)) throw fail('Плагин: заголовки входа подставляет Dev Space; объявите их в «auth».');
  }
  if (value.items !== undefined) result.items = text(value.items, 'путь к списку в ответе', 200);
  if (value.result !== undefined) result.result = text(value.result, 'путь к результату в ответе', 200);
  if (value.map) {
    result.map = {};
    for (const [field, rule] of Object.entries(value.map)) {
      if (!['id', ...thingFields].includes(field)) throw fail(`Плагин: поле вещи «${field}» неизвестно.`);
      if (typeof rule === 'string') result.map[field] = { path: text(rule, 'путь к полю', 200) };
      else result.map[field] = clean({ path: text(rule?.path, 'путь к полю', 200), values: rule.values ? Object.fromEntries(Object.entries(rule.values).slice(0, 60).map(([from, to]) => [from, text(String(to), 'значение поля', 120)])) : undefined, prefix: optional(rule.prefix, 'приставка поля', 60) });
    }
  }
  if (value.lookup) {
    result.lookup = {};
    for (const [param, rule] of Object.entries(value.lookup).slice(0, 4)) result.lookup[param] = { operation: text(rule?.operation, 'операция поиска', 60), where: template(rule?.where || {}), take: text(rule?.take || 'id', 'поле поиска', 60) };
  }
  return result;
}
function connection(value, builtin) {
  const result = { id: ident(value?.id, 'ID подключения'), title: text(value.title, 'название подключения', 80), description: optional(value.description, 'описание подключения'), hosts: hosts(value.hosts), itemKind: thingKinds.includes(value.itemKind) ? value.itemKind : 'external', settings: [], operations: {} };
  if (value.auth) {
    if (!['bearer', 'header'].includes(value.auth.type)) throw fail('Плагин: способ входа — «bearer» или «header».');
    result.auth = clean({ type: value.auth.type, header: value.auth.type === 'header' ? text(value.auth.header, 'заголовок входа', 60) : undefined, prefix: optional(value.auth.prefix, 'приставка ключа', 30), label: text(value.auth.label || 'Ключ доступа', 'подпись ключа', 80), help: optional(value.auth.help, 'подсказка ключа', 300) });
    if (!result.hosts.length) throw fail('Плагин: подключение с ключом должно объявить адреса сети.');
  }
  for (const setting of list(value.settings, 'настройки подключения', 8)) result.settings.push(clean({ id: ident(setting?.id, 'ID настройки'), title: text(setting.title, 'название настройки', 80), placeholder: optional(setting.placeholder, 'пример настройки', 80), required: setting.required === true || undefined }));
  const entries = Object.entries(value.operations || {});
  if (!entries.length || entries.length > 30) throw fail('Плагин: у подключения должна быть от 1 до 30 операций.');
  for (const [name, definition] of entries) { if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) throw fail('Плагин: имя операции — латинские буквы и цифры.'); result.operations[name] = operation(name, definition, result, builtin); }
  for (const [name, item] of Object.entries(result.operations)) for (const rule of Object.values(item.lookup || {})) if (result.operations[rule.operation]?.kind !== 'read') throw fail(`Плагин: операция «${name}» ищет значение через «${rule.operation}», а это не чтение.`);
  if (value.plays) {
    result.plays = { role: text(value.plays.role, 'роль', 40), version: Number.isInteger(value.plays.version) ? value.plays.version : 1, operations: {}, statuses: {} };
    for (const [roleOperation, own] of Object.entries(value.plays.operations || {})) result.plays.operations[roleOperation] = text(own, 'операция роли', 60);
    for (const [group, value_] of Object.entries(value.plays.statuses || {})) { if (!['todo', 'doing', 'done'].includes(group)) throw fail('Плагин: группа статуса — todo, doing или done.'); result.plays.statuses[group] = text(String(value_), 'статус сервиса', 80); }
    const problems = rolePlayProblems(result);
    if (problems.length) throw fail(`Плагин: подключение «${result.title}» не может играть роль: ${problems.join('; ')}.`);
  }
  return clean(result);
}
function block(value) {
  const result = { id: ident(value?.id, 'ID блока'), title: text(value.title, 'название блока', 60), summary: optional(value.summary, 'пояснение блока', 120), base: ident(value.base, 'базовый блок'), with: template(value.with || {}), params: {} };
  for (const [name, definition] of Object.entries(value.params || {}).slice(0, 12)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(name)) throw fail('Плагин: имя параметра блока — латинские буквы и цифры.');
    if (!['text', 'number', 'enum', 'role', 'need'].includes(definition?.type)) throw fail('Плагин: тип параметра блока — text, number, enum, role или need.');
    result.params[name] = clean({ type: definition.type, title: text(definition.title || name, 'название параметра', 80), required: definition.required === true || undefined, values: definition.type === 'enum' ? list(definition.values, 'значения параметра', 20).map(item => text(String(item), 'значение параметра', 80)) : undefined, default: ['string', 'number'].includes(typeof definition.default) ? definition.default : undefined });
  }
  return clean(result);
}

export function validateManifest(raw, { builtin = false } = {}) {
  if (!raw || typeof raw !== 'object' || raw.plugin !== 1) throw fail('Это не плагин Dev Space: в plugin.json нет «"plugin": 1».');
  const manifest = {
    plugin: 1, id: ident(raw.id, 'ID плагина'), name: text(raw.name, 'название', 60), version: text(String(raw.version ?? '0.1.0'), 'версия', 30),
    description: text(raw.description, 'описание', 400), author: optional(raw.author, 'автор', 80), homepage: optional(raw.homepage, 'страница плагина', 300),
    views: unique(list(raw.views, 'виды').map(item => view(item, builtin)), 'вид'),
    boards: unique(list(raw.boards, 'виды доски', 12).map(board), 'вид доски'),
    connections: unique(list(raw.connections, 'подключения', 12).map(item => connection(item, builtin)), 'подключение'),
    blocks: unique(list(raw.blocks, 'блоки', 30).map(block), 'блок'),
    flows: list(raw.flows, 'флоу', 30).map(item => file(item, 'файл флоу')),
    instructions: list(raw.instructions, 'инструкции', 12).map(item => file(item, 'файл инструкции')),
  };
  if (!manifest.views.length && !manifest.boards.length && !manifest.connections.length && !manifest.blocks.length && !manifest.flows.length && !manifest.instructions.length) throw fail('Плагин пуст: в нём нет видов, подключений, блоков, флоу или инструкций.');
  return clean(manifest);
}

// What a plugin can read, change and reach. Computed from the manifest alone.
export function permissions(manifest) {
  const kinds = new Set(), changes = new Set(), network = new Set();
  for (const item of manifest.views) { for (const kind of item.accepts) kinds.add(kind); for (const action of item.actions) if (action !== 'thing.open') changes.add(viewActions[action]); for (const host of item.render.hosts || []) network.add(host); }
  const reads = [];
  if (manifest.views.length) reads.push(kinds.has('*') ? 'вещи зоны, в которой включён вид' : 'вещи зоны: ' + [...kinds].join(', '));
  for (const item of manifest.connections) {
    for (const host of item.hosts) network.add(host);
    for (const definition of Object.values(item.operations)) {
      if (definition.kind === 'action') changes.add(`${item.title}: ${definition.title}`); else reads.push(`${item.title}: ${definition.title}`);
    }
  }
  const code = manifest.views.some(item => item.render.type === 'code');
  return {
    reads, changes: [...changes], network: [...network], code,
    keys: manifest.connections.filter(item => item.auth).map(item => `${item.title}: ключ хранит Dev Space, плагин его не получает`),
    never: ['читать и менять файлы на диске', 'получать пароли и ключи', network.size ? 'обращаться к другим адресам сети' : 'выходить в сеть', 'менять что-либо, кроме перечисленного'],
    roles: manifest.connections.filter(item => item.plays).map(item => roles[item.plays.role]?.title || item.plays.role),
  };
}
// One line per part, for the «Что внутри» list.
export function contents(manifest) {
  return [
    ...manifest.views.map(item => ({ kind: 'Вид', title: item.title, where: item.level === 'zone' ? 'встанет в список «Вид» у зоны' : 'открывает вещь на весь экран', how: item.render.type === 'parts' ? 'настройкой, без кода' : item.render.type === 'code' ? 'кодом в песочнице' : 'встроенный' })),
    ...manifest.boards.map(item => ({ kind: 'Вид доски', title: item.title, where: 'встанет в список «Вид доски»', how: 'настройкой, без кода' })),
    ...manifest.connections.map(item => ({ kind: 'Подключение', title: item.title, where: 'встанет в «Добавить» на доске; операции доступны флоу', how: item.hosts.length ? 'запросы выполняет Dev Space' : 'встроенное' })),
    ...manifest.blocks.map(item => ({ kind: 'Блок', title: item.title, where: 'встанет в блоки флоу', how: 'настройкой, без кода' })),
    ...manifest.flows.map(item => ({ kind: 'Флоу', title: item.split('/').pop().replace(/\.flow\.json$/, ''), where: 'встанет в библиотеку флоу', how: 'из блоков' })),
    ...manifest.instructions.map(item => ({ kind: 'Инструкции агенту', title: item.split('/').pop(), where: 'попадут в справочник агентов', how: 'текстом' })),
  ];
}
