import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { t, setLocale, getLocale, countLabel, formatDate, subscribeLocale } from '../../../src/i18n/core.ts';
import { ru } from '../../../src/i18n/ru.ts';
import { localizeEntity } from '../workspace-locales.mjs';
import { createService } from '../server.mjs';
import { chatTitle, groupLabel } from '../titles.mjs';

test('locale switches immediately, preserves placeholders and handles Russian plurals', () => {
  setLocale('ru');
  assert.equal(getLocale(), 'ru');
  assert.equal(t('Settings'), 'Настройки');
  for (const [n, expected] of [[1, '1 чат'], [2, '2 чата'], [5, '5 чатов'], [11, '11 чатов'], [21, '21 чат'], [22, '22 чата']]) assert.equal(countLabel(n, 'chat'), expected);
  const tokens = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const [key, value] of Object.entries(ru)) assert.deepEqual(tokens(value), tokens(key), key);
  assert.equal(t('Request failed ({0})', 403).includes('403'), true);
  assert.equal(t('Unknown external error'), 'Unknown external error');
  assert.match(formatDate('2026-11-05'), /5/);
  assert.equal(formatDate('not a date'), 'not a date');
  let changes = 0; const off = subscribeLocale(() => changes++);
  setLocale('en'); setLocale('en'); setLocale('invalid');
  assert.equal(changes, 1); assert.equal(t('Settings'), 'Settings');
  assert.equal(countLabel(2, 'chat'), '2 chats');
  off(); setLocale('ru');
});

test('only authored guide translations are selected, preserving original content and identifiers', () => {
  const entity = { id: 'guide', title: 'Guide', status: 'active', steps: [{ name: 'Start', path: 'start.md' }], locales: { ru: { title: 'Справка', steps: [{ name: 'Начало', path: 'start.ru.md' }] } } };
  const localized = localizeEntity(entity, 'ru');
  assert.equal(localized.title, 'Справка'); assert.equal(localized.steps[0].path, 'start.ru.md');
  assert.equal(localized.id, 'guide'); assert.equal(localized.status, 'active');
  assert.equal(entity.steps[0].path, 'start.md');
  assert.equal(localizeEntity(entity, 'en'), entity);
  const custom = { id: 'custom', title: 'Settings', steps: [{ name: 'Help', path: 'my-report.md' }] };
  assert.equal(localizeEntity(custom, 'ru'), custom);
  assert.equal(chatTitle('  Русское   название  '), 'Русское название');
  assert.equal(groupLabel('Команда'), 'Команда');
  assert.throws(() => chatTitle('Invalid\u0000name'), /control/);
});

test('language persists across service restarts and sends native menu updates', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'mrmak-language-'));
  await mkdir(path.join(repo, 'workspace'));
  await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
  const events = [], options = { repo, uiDir: path.join(repo, 'ui'), native: event => events.push(event), mcpOptions: { home: repo, env: {} } };
  let service = await createService(options);
  try {
    assert.deepEqual(events[0], { type: 'language', language: 'ru' });
    const save = language => fetch(service.origin + '/api/settings', { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ language }) }).then(response => response.json());
    assert.equal((await save('en')).language, 'en');
    assert.deepEqual(events.at(-1), { type: 'language', language: 'en' });
    assert.equal((await save('unknown')).language, 'en');
    assert.equal(JSON.parse(await readFile(path.join(repo, '.devspace/settings.json'), 'utf8')).language, 'en');
    await service.close(); service = await createService(options);
    assert.deepEqual(events.at(-1), { type: 'language', language: 'en' });
  } finally { await service.close(); }
});
