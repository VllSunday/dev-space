import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '../workspace.mjs';
import { CardDocuments } from '../card-documents.mjs';
import { spacesOf } from '../space-model.mjs';

test('spaces preserve legacy cards, isolate new cards and serialize moves with section changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mak-spaces-'));
  await mkdir(path.join(repo, 'workspace'));
  const file = path.join(repo, 'workspace/workspace.json');
  const original = { id: 'old', title: 'Existing', folder: 'existing', category: 'dev', status: 'active', created: '2026-01-01', steps: [], custom: 'keep' };
  await writeFile(file, JSON.stringify({ entities: [original], customRoot: true }));
  const ws = new Workspace(repo), cards = new CardDocuments(ws);
  assert.equal(spacesOf(await ws.registry())[0].id, 'default');
  const qa = await ws.organize({ action: 'create-space', name: 'QA', template: 'testing' });
  assert.equal(qa.sections.length, 6);
  const card = await cards.create({ title: 'Regression', template: 'research', spaceId: qa.id, category: qa.sections[1].id });
  await assert.rejects(cards.create({ title: 'Bad', template: 'research', spaceId: 'missing', category: 'no' }), /Space/);
  await assert.rejects(ws.organize({ action: 'delete-space', spaceId: qa.id }), /Move all/);
  await assert.rejects(ws.organize({ action: 'delete-section', spaceId: qa.id, sectionId: qa.sections[1].id }), /Move all/);
  await Promise.all([
    ws.update(card.entity.id, { priority: 'urgent', workflow: 'review' }),
    ws.organize({ action: 'rename-section', spaceId: qa.id, sectionId: qa.sections[1].id, name: 'Defects' }),
    ws.organize({ action: 'create-section', spaceId: qa.id, name: 'UX notes' }),
  ]);
  let state = await ws.registry();
  assert.deepEqual(state.entities[0], original);
  assert.equal(state.customRoot, true);
  assert.equal(state.entities[1].priority, 'urgent');
  assert.equal(state.spaces[1].sections[1].name, 'Defects');
  assert.equal(state.spaces[1].sections.length, 7);
  const beforeMove = state.spaces[1].sections.map(s => s.id);
  await ws.organize({ action: 'move-section', spaceId: qa.id, sectionId: beforeMove[1], direction: 'left' });
  state = await ws.registry();
  assert.deepEqual(state.spaces[1].sections.map(s => s.id), [beforeMove[1], beforeMove[0], ...beforeMove.slice(2)]);
  assert.equal(state.entities[1].category, beforeMove[1], 'Moving a tab preserves task membership');
  await ws.organize({ action: 'move-section', spaceId: qa.id, sectionId: beforeMove[1], direction: 'left' });
  assert.equal((await ws.registry()).spaces[1].sections[0].id, beforeMove[1], 'Boundary move is harmless');
  await assert.rejects(ws.organize({ action: 'move-section', spaceId: qa.id, sectionId: beforeMove[1], direction: 'invalid' }), /left or right/);
  await ws.update(card.entity.id, { workflow: 'done' });
  assert.equal((await ws.registry()).entities[1].status, 'done');
  await ws.update(card.entity.id, { status: 'active', spaceId: 'default' });
  state = await ws.registry();
  assert.equal(state.entities[1].workflow, 'backlog');
  assert.equal(state.entities[1].category, 'dev');
  await ws.organize({ action: 'delete-space', spaceId: qa.id });
  await assert.rejects(ws.update('old', { workflow: 'invalid' }), /workflow/);
  await assert.rejects(ws.update('old', { spaceId: '../foo' }), /Space/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).spaces.length, 1);
});
