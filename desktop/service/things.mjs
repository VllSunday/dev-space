// One shape for everything a board shows. Views, commands and flow blocks work
// with it and never need to know whether a thing is a material, a page, a task
// or an item fetched by a plugin connection.
export const statusGroups = ['todo', 'doing', 'done'];
export const statusGroupNames = { todo: 'Не начато', doing: 'В работе', done: 'Завершено' };
export const taskStatusGroup = status => status === 'done' ? 'done' : status === 'todo' ? 'todo' : 'doing';
export const taskStatusNames = { todo: 'Надо', working: 'В работе', review: 'На проверке', done: 'Готово' };
export const kindNames = { note: 'Заметка', image: 'Изображение', file: 'Файл', link: 'Ссылка', model: '3D-модель', page: 'Документ', task: 'Задача', external: 'Запись' };

const isModel = file => /\.glb$/i.test(file.path);
export const materialKind = material => material.files?.some(isModel) ? 'model' : material.kind === 'legacy' ? 'note' : material.kind;
const firstLine = text => (text || '').split('\n').find(line => line.trim())?.trim() || '';
const pageText = page => firstLine(page.blocks.filter(block => ['text', 'bullet', 'quote', 'check'].includes(block.type)).map(block => block.text).join('\n'));

export function materialThing(material) {
  const image = material.files?.find(file => file.image), model = material.files?.find(isModel);
  return { ref: 'material:' + material.id, id: material.id, kind: materialKind(material), title: material.title, text: material.text || '', image: image?.path, model: model?.path, files: material.files?.length || 0, topicId: material.topicId, updated: material.updated, created: material.created, archived: !!material.archived };
}
export function pageThing(page) {
  const image = page.blocks.find(block => block.type === 'image');
  return { ref: 'page:' + page.id, id: page.id, kind: 'page', title: page.title, text: pageText(page), image: image?.asset, icon: page.icon, topicId: page.topicId, updated: page.updated };
}
export function taskThing(task) {
  return { ref: 'task:' + task.id, id: task.id, kind: 'task', title: task.title, text: '', status: taskStatusNames[task.status] || task.status, statusGroup: taskStatusGroup(task.status), topicId: task.topicId, sourceId: task.sourceId || undefined };
}

export function thingByRef(state, ref) {
  const at = String(ref).indexOf(':'), kind = String(ref).slice(0, at), id = String(ref).slice(at + 1);
  if (kind === 'material') { const value = state.materials.find(item => item.id === id); return value && materialThing(value); }
  if (kind === 'page') { const value = state.pages.find(item => item.id === id); return value && pageThing(value); }
  if (kind === 'task') { const value = state.tasks.find(item => item.id === id); return value && taskThing(value); }
  return undefined;
}

const newest = (a, b) => String(b.created || b.updated || '').localeCompare(String(a.created || a.updated || '')) || a.id.localeCompare(b.id);
// The things of a zone. Connection zones are filled by the service, which passes
// the fetched items in `external`.
export function zoneThings(state, projectId, zone, external = []) {
  const source = zone.source || {}, pinned = zone.pinnedIds || [];
  let things;
  if (source.kind === 'topic') things = state.materials.filter(item => item.projectId === projectId && !item.archived && (source.topicId === 'all' || item.topicId === source.topicId)).map(materialThing).sort(newest);
  else if (source.kind === 'pages') things = state.pages.filter(item => item.projectId === projectId).map(pageThing);
  else if (source.kind === 'tasks') things = state.tasks.filter(item => item.projectId === projectId).map(taskThing);
  else if (source.kind === 'refs') things = (source.refs || []).map(ref => thingByRef(state, ref)).filter(thing => thing && !thing.archived);
  else if (source.kind === 'connection') things = external;
  else things = [];
  if (!pinned.length) return things;
  return [...things].sort((a, b) => {
    const ai = pinned.indexOf(a.id), bi = pinned.indexOf(b.id);
    return ai >= 0 || bi >= 0 ? (ai < 0 ? 1 : bi < 0 ? -1 : ai - bi) : 0;
  });
}

// Text from a file, a material or an outside service is reference data. This
// trims it and removes control characters before it is shown or quoted.
export function plainText(value, max = 2000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f  ]/g, ' ').slice(0, max);
}
