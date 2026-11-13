import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DevSpace } from '../devspace.mjs';
import { zoneThings } from '../things.mjs';

const tempRepo = () => mkdtemp(path.join(os.tmpdir(), 'devspace-boards-'));
async function store() {
  const repo = await tempRepo(), space = await new DevSpace(repo).init();
  const op = async change => space.mutate({ ...change, baseRevision: (await space.read()).revision });
  return { repo, space, op };
}

test('a store saved before boards opens with a board per project and loses nothing', async () => {
  const repo = await tempRepo(), folder = path.join(repo, 'workspace', 'devspace');
  await mkdir(folder, { recursive: true });
  const old = { schemaVersion: 1, revision: 7, projects: [{ id: 'p1', name: 'Игра', path: repo, homePageId: 'home', topics: [{ id: 'world', name: 'Локации', icon: 'steel:game' }, { id: 'refs', name: 'Референсы' }] }],
    materials: [{ id: 'm1', projectId: 'p1', topicId: 'world', title: 'Маяк', text: 'Старт', kind: 'note', files: [], archived: false, created: '2026-01-01', updated: '2026-01-01' }, { id: 'm2', projectId: 'p1', topicId: 'unfiled', title: 'Мысль', text: '', kind: 'note', files: [], archived: false, created: '2026-01-02', updated: '2026-01-02' }],
    pages: [{ id: 'home', projectId: 'p1', topicId: 'unfiled', title: 'Wiki', blocks: [], sourceIds: [], revision: 0, layout: 'wiki', updated: '2026-01-01', collections: [{ topicId: 'world', view: 'tiles', pinnedIds: ['m1'] }, { topicId: 'refs', view: 'gallery', pinnedIds: [] }] }],
    tasks: [{ id: 't1', projectId: 'p1', topicId: 'world', title: 'Собрать маяк', status: 'working', sourceId: 'm1' }] };
  await writeFile(path.join(folder, 'space.json'), JSON.stringify(old));
  const space = await new DevSpace(repo).init(), state = await space.read();
  for (const key of ['projects', 'materials', 'pages', 'tasks']) assert.deepEqual(state[key], old[key], key + ' are untouched');
  assert.equal(state.schemaVersion, 1); assert.equal(state.revision, 8);
  const board = state.boards[0];
  assert.deepEqual(board.zones.map(zone => [zone.name, zone.view, zone.source.kind]), [['Локации', 'core/tiles', 'topic'], ['Референсы', 'core/gallery', 'topic'], ['Без темы', 'core/list', 'topic'], ['Документы', 'core/list', 'pages'], ['Задачи', 'tasks/checklist', 'tasks']]);
  assert.deepEqual(board.zones[0].pinnedIds, ['m1']); assert.equal(board.zones[0].icon, 'steel:game');
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'space.before-boards.json'), 'utf8')), old, 'a copy from before the change is kept');
  // The step can be undone like any other change.
  const undone = await space.mutate({ action: 'undo', baseRevision: state.revision });
  assert.equal(undone.boards, undefined); assert.deepEqual(undone.materials, old.materials);
  // Opening again adds the board again; an existing board is never rebuilt.
  const again = await (await new DevSpace(repo).init()).read();
  assert.equal(again.boards.length, 1);
  assert.equal((await (await new DevSpace(repo).init()).read()).boards[0].id, again.boards[0].id);
});

test('zones overlap nowhere after the first layout and keep their place afterwards', async () => {
  const { space, op } = await store();
  const state = await op({ action: 'import-template', templateId: 'wind-islands' }), board = state.boards.at(-1);
  const hits = board.zones.flatMap((a, i) => board.zones.slice(i + 1).filter(b => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  assert.equal(hits.length, 0);
  assert.equal(board.zones.find(zone => zone.name === 'Ассеты и 3D').view, 'core/tiles', 'a topic of models reads as tiles');
  const moved = await op({ action: 'zone-layout', boardId: board.id, zones: [{ id: board.zones[0].id, x: 44, y: 60, w: 30, h: 12 }] });
  assert.deepEqual((({ x, y, w, h }) => ({ x, y, w, h }))(moved.boards.at(-1).zones[0]), { x: 44, y: 60, w: 30, h: 12 });
  await assert.rejects(space.mutate({ action: 'zone-layout', boardId: board.id, zones: [], baseRevision: 0 }), error => error.status === 409);
});

test('a card is a reference: one thing lies in several zones and deleting a zone keeps it', async () => {
  const { op } = await store();
  let state = await op({ action: 'create-topic', projectId: 'default', name: 'Идеи' });
  const topicId = state.projects[0].topics[0].id, boardId = state.boards[0].id;
  state = await op({ action: 'create-material', projectId: 'default', topicId, text: 'Фонарь светит на 12 шагов' });
  const ref = 'material:' + state.materials[0].id;
  state = await op({ action: 'zone-create', boardId, name: 'Уровень 1', source: { kind: 'refs', refs: [ref] } });
  state = await op({ action: 'board-create', projectId: 'default', name: 'Вторая' });
  state = await op({ action: 'zone-create', boardId: state.boards[1].id, name: 'Тоже фонарь', source: { kind: 'refs', refs: [ref, 'material:missing'] } });
  assert.deepEqual(state.boards[1].zones[0].source.refs, [ref], 'unknown references are not stored');
  assert.equal(state.materials.length, 1);
  const picked = state.boards[0].zones.find(zone => zone.name === 'Уровень 1');
  assert.equal(zoneThings(state, 'default', picked)[0].title, 'Фонарь светит на 12 шагов');
  state = await op({ action: 'zone-delete', boardId, zoneId: picked.id });
  assert.equal(state.materials.length, 1, 'the thing stays');
  // A thing made inside a hand-picked zone lands in that zone.
  const zone = state.boards[1].zones[0];
  state = await op({ action: 'create-task', projectId: 'default', title: 'Проверить фонарь', boardId: state.boards[1].id, zoneId: zone.id });
  assert.ok(state.boards[1].zones[0].source.refs.includes('task:' + state.tasks[0].id));
  // Deleting the material clears its references everywhere.
  state = await op({ action: 'delete-materials', ids: [state.materials[0].id] });
  assert.deepEqual(state.boards[1].zones[0].source.refs, ['task:' + state.tasks[0].id]);
  await assert.rejects(op({ action: 'board-delete', boardId: state.boards[0].id }).then(() => op({ action: 'board-delete', boardId: state.boards[1].id })), /хотя бы одна доска/);
});

test('a new zone gets its own topic, renames with it, and a deleted topic keeps its things visible', async () => {
  const { op } = await store();
  let state = await op({ action: 'zone-create', boardId: (await op({ action: 'create-topic', projectId: 'default', name: 'x' })).boards[0].id, name: 'Локации', view: 'core/tiles' });
  const zone = state.boards[0].zones.find(item => item.name === 'Локации'), topicId = zone.source.topicId;
  assert.equal(state.projects[0].topics.find(topic => topic.id === topicId).name, 'Локации');
  state = await op({ action: 'zone-update', boardId: state.boards[0].id, zoneId: zone.id, name: 'Места', collapsed: true, hidden: true, color: '#AABBCC' });
  assert.equal(state.projects[0].topics.find(topic => topic.id === topicId).name, 'Места');
  assert.deepEqual([zone.id, true, true, '#aabbcc'], (z => [z.id, z.collapsed, z.hidden, z.color])(state.boards[0].zones.find(item => item.id === zone.id)));
  state = await op({ action: 'create-material', projectId: 'default', topicId, text: 'Гавань' });
  state = await op({ action: 'delete-topic', projectId: 'default', id: topicId });
  assert.equal(state.materials[0].topicId, 'unfiled');
  assert.ok(state.boards[0].zones.some(item => item.source.topicId === 'unfiled'), 'the things are still on the board');
  await assert.rejects(op({ action: 'zone-update', boardId: state.boards[0].id, zoneId: state.boards[0].zones[0].id, view: '../etc' }), /Вид зоны/);
});

test('a new project starts from a ready layout instead of an empty board', async () => {
  const { repo, op } = await store();
  const state = await op({ action: 'create-project', name: 'Приложение', path: repo, preset: 'app' });
  assert.deepEqual(state.boards.at(-1).zones.map(zone => zone.name), ['Требования', 'Экраны', 'Решения', 'Задачи', 'Документы']);
  assert.equal(state.projects.at(-1).topics.length, 3, 'only zones for notes and files get a topic');
  await assert.rejects(op({ action: 'create-project', name: 'Нет', path: repo, preset: 'nope' }), /Раскладка не найдена/);
});
