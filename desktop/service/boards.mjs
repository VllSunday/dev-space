import { randomUUID } from 'node:crypto';

// A board is a surface with zones. A zone groups things by a source and shows
// them through a plugin view. Things are referenced, never copied.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = prefix => `${prefix}-${randomUUID().slice(0, 12)}`;
export const zoneColors = ['#7fb0a8', '#96b2d7', '#d9a37f', '#b7a3d9', '#9cc5a3', '#e5c07b', '#d99ab0', '#8fb7c9'];
export const defaultBoardKind = 'core/free';
const pluginRef = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,39}$/;
const refPattern = /^(material|page|task):[a-zA-Z0-9-]{1,100}$/;
const COLUMN = 16, GAP = 1;

const title = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail('Введите название.');
  return value.trim();
};
const cell = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

export function zoneSource(value, state, project) {
  if (!value || typeof value !== 'object') throw fail('У зоны нет источника.');
  if (value.kind === 'topic') {
    if (!['all', 'unfiled'].includes(value.topicId) && !project.topics.some(topic => topic.id === value.topicId)) throw fail('Тема зоны не найдена.');
    return { kind: 'topic', topicId: value.topicId };
  }
  if (value.kind === 'pages' || value.kind === 'tasks' || value.kind === 'outline') return { kind: value.kind };
  if (value.kind === 'refs') {
    if (!Array.isArray(value.refs) || value.refs.length > 500 || value.refs.some(ref => typeof ref !== 'string' || !refPattern.test(ref))) throw fail('Некорректный список вещей зоны.');
    return { kind: 'refs', refs: [...new Set(value.refs)].filter(ref => refExists(state, project.id, ref)) };
  }
  if (value.kind === 'connection') {
    if (typeof value.connectionId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value.connectionId)) throw fail('Подключение зоны не найдено.');
    return { kind: 'connection', connectionId: value.connectionId };
  }
  throw fail('Неизвестный источник зоны.');
}
export function refExists(state, projectId, ref) {
  const [kind, value] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  const list = kind === 'material' ? state.materials : kind === 'page' ? state.pages : kind === 'task' ? state.tasks : [];
  return list.some(item => item.id === value && item.projectId === projectId);
}

// Fields a caller may set on a zone. Anything else in the request is ignored.
export function zonePatch(data, state, project) {
  const patch = {};
  if (data.name !== undefined) patch.name = title(data.name);
  if (data.color !== undefined) { if (data.color !== null && (typeof data.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.color))) throw fail('Выберите цвет в формате #RRGGBB.'); patch.color = data.color?.toLowerCase() || null; }
  if (data.icon !== undefined) { if (typeof data.icon !== 'string' || data.icon.length > 32 || /[\x00-\x1f\x7f]/.test(data.icon)) throw fail('Некорректный значок.'); patch.icon = data.icon.trim(); }
  if (data.view !== undefined) { if (typeof data.view !== 'string' || !pluginRef.test(data.view)) throw fail('Вид зоны не найден.'); patch.view = data.view; }
  if (data.collapsed !== undefined) patch.collapsed = !!data.collapsed;
  if (data.hidden !== undefined) patch.hidden = !!data.hidden;
  if (data.source !== undefined) patch.source = zoneSource(data.source, state, project);
  if (data.pinnedIds !== undefined) { if (!Array.isArray(data.pinnedIds) || data.pinnedIds.length > 8 || data.pinnedIds.some(value => typeof value !== 'string' || value.length > 100)) throw fail('Можно закрепить до 8 записей.'); patch.pinnedIds = data.pinnedIds; }
  if (data.options !== undefined) { if (!data.options || typeof data.options !== 'object' || JSON.stringify(data.options).length > 4000) throw fail('Некорректные настройки вида.'); patch.options = data.options; }
  for (const [key, min, max] of [['x', 0, 4000], ['y', 0, 4000], ['w', 9, 120], ['h', 3, 160]]) if (data[key] !== undefined) patch[key] = cell(data[key], min, max, min);
  return patch;
}
export function boardKind(value) {
  if (typeof value !== 'string' || !pluginRef.test(value)) throw fail('Вид доски не найден.');
  return value;
}
export const boardName = title;

// How tall a zone needs to be to show a short preview of its things.
function estimateHeight(view, count) {
  const shown = Math.min(count, 8);
  if (view === 'core/tiles') return 3 + Math.max(1, Math.ceil(shown / 2)) * 7;
  if (view === 'core/gallery') return 3 + Math.max(1, Math.ceil(shown / 2)) * 6;
  if (view === 'tasks/columns') return 6 + Math.min(5, Math.max(2, count)) * 3;
  return Math.max(5, 3 + Math.ceil(Math.max(1, shown) * 1.5));
}
// Places zones without positions into columns, shortest column first.
export function arrange(zones, columns = 3) {
  const heights = Array(columns).fill(0);
  for (const zone of zones) {
    if (Number.isFinite(zone.x) && Number.isFinite(zone.y)) { const at = Math.min(columns - 1, Math.max(0, Math.round(zone.x / (COLUMN + GAP)))); heights[at] = Math.max(heights[at], zone.y + zone.h + GAP); continue; }
    const at = heights.indexOf(Math.min(...heights));
    zone.x = at * (COLUMN + GAP); zone.y = heights[at]; zone.w ||= COLUMN;
    heights[at] += zone.h + GAP;
  }
  return zones;
}
const count = (state, projectId, source) => source.kind === 'topic' ? state.materials.filter(item => item.projectId === projectId && !item.archived && item.topicId === source.topicId).length : source.kind === 'pages' ? state.pages.filter(item => item.projectId === projectId).length : source.kind === 'tasks' ? state.tasks.filter(item => item.projectId === projectId).length : 0;
export function makeZone(state, projectId, { name, view, source, color, icon, pinnedIds }) {
  return { id: id('zone'), name, color: color || null, ...(icon ? { icon } : {}), w: COLUMN, h: estimateHeight(view, count(state, projectId, source)), view, source, ...(pinnedIds?.length ? { pinnedIds } : {}) };
}

// The first board of an existing project: every topic becomes a zone, in the
// view it had on the project's Wiki home page; pages and tasks get zones too.
// Nothing in materials, pages, tasks or topics is changed.
export function defaultBoard(state, project) {
  const home = state.pages.find(page => page.id === project.homePageId && page.projectId === project.id);
  const collections = (home?.flow?.filter(node => node.type === 'collection') || home?.collections || []);
  // A topic made mostly of pictures and models reads better as tiles than as a list.
  const visual = topicId => { const items = state.materials.filter(item => item.projectId === project.id && !item.archived && item.topicId === topicId); return items.length > 0 && items.filter(item => item.files?.some(file => file.image || /\.glb$/i.test(file.path))).length * 2 >= items.length; };
  const viewOf = topicId => { const found = collections.find(item => item.topicId === topicId), view = found?.view && found.view !== 'list' ? found.view : visual(topicId) ? 'tiles' : 'list'; return { view: 'core/' + view, pinnedIds: found?.pinnedIds || [] }; };
  const has = source => count(state, project.id, source) > 0;
  const zones = [];
  let color = 0;
  for (const topic of project.topics) zones.push(makeZone(state, project.id, { name: topic.name, icon: topic.icon, ...viewOf(topic.id), source: { kind: 'topic', topicId: topic.id }, color: zoneColors[color++ % zoneColors.length] }));
  if (has({ kind: 'topic', topicId: 'unfiled' }) || !project.topics.length) zones.push(makeZone(state, project.id, { name: project.topics.length ? 'Без темы' : 'Заметки', ...viewOf('unfiled'), source: { kind: 'topic', topicId: 'unfiled' }, color: zoneColors[color++ % zoneColors.length] }));
  if (has({ kind: 'pages' })) zones.push(makeZone(state, project.id, { name: 'Документы', view: 'core/list', source: { kind: 'pages' }, color: zoneColors[color++ % zoneColors.length] }));
  if (has({ kind: 'tasks' })) zones.push(makeZone(state, project.id, { name: 'Задачи', view: 'tasks/checklist', source: { kind: 'tasks' }, color: zoneColors[color++ % zoneColors.length] }));
  return { id: id('board'), projectId: project.id, name: 'Главная', kind: defaultBoardKind, zones: arrange(zones) };
}

// Ready layouts for a new project, so the first board is never empty.
export const boardPresets = [
  { id: 'empty', name: 'Пустая', description: 'Одна зона для заметок. Остальное добавите сами.', zones: [{ name: 'Заметки', view: 'core/list' }] },
  { id: 'game', name: 'Игра', description: 'Идея, локации, персонажи, модели, референсы и задачи.', zones: [{ name: 'Идея', view: 'core/list' }, { name: 'Локации', view: 'core/tiles' }, { name: 'Персонажи', view: 'core/tiles' }, { name: 'Модели', view: 'core/tiles' }, { name: 'Референсы', view: 'core/gallery' }, { name: 'Задачи', view: 'tasks/columns', source: 'tasks' }, { name: 'Документы', view: 'core/list', source: 'pages' }] },
  { id: 'app', name: 'Приложение', description: 'Требования, экраны, решения и задачи разработки.', zones: [{ name: 'Требования', view: 'core/list' }, { name: 'Экраны', view: 'core/gallery' }, { name: 'Решения', view: 'core/list' }, { name: 'Задачи', view: 'tasks/columns', source: 'tasks' }, { name: 'Документы', view: 'core/list', source: 'pages' }] },
  { id: 'study', name: 'Учёба', description: 'Конспекты, источники, вопросы и план.', zones: [{ name: 'Конспекты', view: 'core/list' }, { name: 'Источники', view: 'core/tiles' }, { name: 'Вопросы', view: 'core/list' }, { name: 'План', view: 'tasks/checklist', source: 'tasks' }] },
  { id: 'work', name: 'Рабочие задачи', description: 'Входящие, заметки по встречам, задачи и документы.', zones: [{ name: 'Входящие', view: 'core/list' }, { name: 'Встречи', view: 'core/list' }, { name: 'Задачи', view: 'tasks/columns', source: 'tasks' }, { name: 'Документы', view: 'core/list', source: 'pages' }] },
];
// Adds a preset's topics to the project and returns its board.
export function presetBoard(state, project, presetId = 'empty') {
  const preset = boardPresets.find(item => item.id === presetId);
  if (!preset) throw fail('Раскладка не найдена.');
  const zones = preset.zones.map((item, index) => {
    let source;
    if (item.source === 'tasks' || item.source === 'pages') source = { kind: item.source };
    else { const topic = { id: id('topic'), name: item.name }; project.topics.push(topic); source = { kind: 'topic', topicId: topic.id }; }
    const zone = makeZone(state, project.id, { name: item.name, view: item.view, source, color: zoneColors[index % zoneColors.length] });
    zone.h = Math.max(zone.h, item.view === 'tasks/columns' ? 12 : 9);
    return zone;
  });
  return { id: id('board'), projectId: project.id, name: 'Главная', kind: defaultBoardKind, zones: arrange(zones) };
}

// Gives every project without a board its first one. Returns true if it added any.
export function ensureBoards(state) {
  state.boards ||= [];
  let added = false;
  for (const project of state.projects) if (!state.boards.some(board => board.projectId === project.id)) { state.boards.push(defaultBoard(state, project)); added = true; }
  return added;
}

// A free spot below everything already on the board.
export function nextPlace(board, width = COLUMN) {
  const visible = board.zones.filter(zone => !zone.hidden), columns = 3, heights = Array(columns).fill(0);
  for (const zone of visible) for (let column = 0; column < columns; column++) { const left = column * (COLUMN + GAP); if (zone.x < left + COLUMN && zone.x + zone.w > left) heights[column] = Math.max(heights[column], zone.y + zone.h + GAP); }
  const at = heights.indexOf(Math.min(...heights));
  return { x: at * (COLUMN + GAP), y: heights[at], w: width };
}

// References to things or topics that no longer exist are dropped; the zone stays.
export function pruneBoards(state) {
  for (const board of state.boards || []) for (const zone of board.zones) {
    if (zone.source.kind === 'refs') zone.source.refs = zone.source.refs.filter(ref => refExists(state, board.projectId, ref));
    if (zone.pinnedIds) zone.pinnedIds = zone.pinnedIds.filter(value => state.materials.some(item => item.id === value) || state.pages.some(item => item.id === value) || state.tasks.some(item => item.id === value));
  }
}
