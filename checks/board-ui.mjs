// The board in a real browser: the first screen, three levels, moving, resizing,
// collapsing and hiding zones, search, adding things, a plugin that changes the
// board, a plugin view with its own code in the sandbox, and handing cards to an
// agent. Uses an isolated workspace and a scripted agent; no model is called.
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DEVSPACE_STUB_AGENT = path.join(root, 'checks/stub-agent.mjs');
process.env.DEVSPACE_STUB_SCENARIO = path.join(root, 'checks/fixtures/stub-scenario.mjs');
const { createService } = await import('../desktop/service/server.mjs');
const { desktopAuth, launchBrowser } = await import('../desktop/service/test/browser.mjs');

const repo = await mkdtemp(path.join(os.tmpdir(), 'devspace-board-ui-'));
const shots = process.env.DEVSPACE_SHOTS || path.join(root, '.cache');
await mkdir(shots, { recursive: true });
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
const store = async () => JSON.parse(await readFile(path.join(repo, 'workspace/devspace/space.json'), 'utf8'));
let browser;
try {
  browser = await launchBrowser({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage();
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const zone = name => page.locator(`.bd-zone[aria-label="Зона ${name}"]`);
  const board = async () => { const state = await store(); return state.boards.find(item => item.projectId === state.projects.at(-1).id); };
  const saved = async name => (await board()).zones.find(item => item.name === name);
  await page.goto(service.urls.workspace);

  // First screen: agents and the board, with a way in instead of an empty surface.
  await expect(page.locator('.ds-places button')).toHaveText(['Проект', 'Флоу', 'Плагины']);
  await expect(page.locator('.ds-project-sidebar')).toHaveCount(0);
  await expect(page.locator('.bd-welcome h2')).toHaveText('Это доска проекта');
  await expect(page.locator('.bd-welcome')).toBeInViewport({ ratio: 1 });
  await shot('board-first-run');
  await page.getByRole('button', { name: 'Посмотреть пример', exact: true }).click();
  await expect(page.locator('.bd-zone')).toHaveCount(8);
  await expect(page.locator('.bd-welcome')).toHaveCount(0);
  const first = await store(), project = first.projects.at(-1);
  expect([first.materials.length, first.pages.length, first.tasks.length]).toEqual([12, 6, 6]);
  expect(service.sessions.items.size).toBe(0);
  await page.keyboard.press('Control+j');
  await expect(page.locator('.ds-agent-pane')).toHaveCount(0);
  await shot('board-overview');

  // Three levels of one surface: board → zone → thing, and back.
  await zone('Ассеты и 3D').locator('.bd-zone-name').click();
  await expect(page.locator('.bd-crumbs h1')).toHaveText('Ассеты и 3D');
  await expect(page.locator('.bd-desk .pv-tile')).toHaveCount(3);
  await shot('board-zone');
  await page.locator('.bd-desk .pv-tile .pv-open').first().click();
  await expect(page.locator('.ds-model-viewer [role=status]')).toContainText('Вращение', { timeout: 20000 });
  await shot('board-thing');
  await page.locator('.bd-crumbs button').first().click();
  await expect(page.locator('.bd-crumbs h1')).toHaveText('Ассеты и 3D');
  await page.locator('.bd-crumbs button').first().click();
  await expect(page.locator('.bd-zone')).toHaveCount(8);
  // A document opens in the page editor the app already had.
  await zone('Документы').locator('.pv-row .pv-open', { hasText: 'Геймплей · Короткий дизайн' }).click();
  await expect(page.locator('.ds-canvas')).toContainText('Геймплей · Короткий дизайн');
  await page.locator('.ds-location button', { hasText: 'Главная' }).click();
  await expect(page.locator('.bd-zone')).toHaveCount(8);

  // Moving and resizing snap to the grid and are saved as typed operations.
  const before = await saved('Геймплей'), header = await zone('Геймплей').locator('header').boundingBox();
  await page.mouse.move(header.x + 150, header.y + 18); await page.mouse.down();
  await page.mouse.move(header.x + 150 + 200, header.y + 18 + 620, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved('Геймплей')).x).toBe(before.x + 10);
  expect((await saved('Геймплей')).y).toBe(before.y + 31);
  const box = await zone('Геймплей').boundingBox();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5); await page.mouse.down();
  await page.mouse.move(box.x + box.width + 75, box.y + box.height + 55, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await saved('Геймплей')).w).toBe(before.w + 4);
  expect((await saved('Геймплей')).h).toBe(before.h + 3);

  // Collapse to a header; hide to the shelf; bring back.
  await zone('Разработка').hover();
  await zone('Разработка').getByRole('button', { name: 'Свернуть зону' }).click();
  await expect(zone('Разработка').locator('.bd-zone-body')).toHaveCount(0);
  expect((await saved('Разработка')).collapsed).toBe(true);
  await zone('Разработка').getByRole('button', { name: 'Развернуть зону' }).click();
  await zone('Без темы').hover();
  await zone('Без темы').getByRole('button', { name: 'Настройки зоны Без темы' }).click();
  await page.getByRole('menuitem', { name: 'Скрыть с доски' }).click();
  await expect(page.locator('.bd-zone')).toHaveCount(7);
  await expect(page.locator('.bd-shelf button')).toHaveText(/Без темы/);
  await shot('board-hidden-shelf');
  await page.locator('.bd-shelf button').click();
  await expect(page.locator('.bd-zone')).toHaveCount(8);

  // Search dims the zones without matches.
  await page.getByLabel('Найти на доске').fill('обсерватор');
  await expect(zone('Локации').locator('.pv-row')).toHaveCount(1);
  await expect(zone('Геймплей')).toHaveClass(/dim/);
  await expect(zone('Локации')).not.toHaveClass(/dim/);
  await shot('board-search');
  await page.getByLabel('Найти на доске').fill('');
  await expect(zone('Локации').locator('.pv-row')).toHaveCount(4);

  // Add a zone, then a note inside it. The zone gets a topic of its own.
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.locator('.bd-popover [role=menuitem]').first()).toContainText('Описать словами');
  await shot('board-add-menu');
  await page.getByRole('menuitem', { name: 'Зона', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новая зона' }).getByLabel('Название').fill('Идеи');
  await page.getByRole('dialog', { name: 'Новая зона' }).getByRole('button', { name: 'Добавить' }).click();
  await expect(zone('Идеи')).toBeVisible();
  await zone('Идеи').locator('.bd-zone-name').click();
  await page.getByLabel('Новая заметка').fill('Ветер меняет направление каждые 40 секунд');
  await page.locator('.bd-add').getByRole('button', { name: 'Добавить' }).click();
  await expect(page.locator('.bd-desk .pv-row')).toHaveCount(1);
  const withNote = await store(), topic = withNote.projects.at(-1).topics.find(item => item.name === 'Идеи');
  expect(withNote.materials[0]).toMatchObject({ topicId: topic.id, text: 'Ветер меняет направление каждые 40 секунд' });
  await page.locator('.bd-crumbs button').first().click();

  // A card carried to another zone moves there; nothing is copied.
  await zone('Локации').locator('.pv-row', { hasText: 'Облачный сад' }).dragTo(zone('Идеи'));
  await expect(zone('Идеи').locator('.pv-row')).toHaveCount(2);
  await expect(zone('Локации').locator('.pv-row')).toHaveCount(3);
  const moved = (await store()).materials.find(item => item.title === 'Облачный сад');
  expect(moved.topicId).toBe(topic.id); expect((await store()).materials.length).toBe(withNote.materials.length);
  // Selected cards go into a hand-picked zone as references.
  for (const index of [0, 1]) { const row = zone('Геймплей').locator('.pv-row').nth(index); await row.hover(); await row.locator('input[type=checkbox]').check({ force: true }); }
  await page.getByLabel('Положить в подборку').selectOption('new');
  await expect(zone('Подборка').locator('.pv-tile')).toHaveCount(2);
  await expect(zone('Геймплей').locator('.pv-row')).toHaveCount(2);
  expect((await saved('Подборка')).source.refs).toHaveLength(2);
  // A second board; search points to matches on the other one.
  await page.getByRole('button', { name: 'Новая доска' }).click();
  await page.getByRole('dialog', { name: 'Новая доска' }).getByLabel('Название').fill('Уровень 1');
  await page.getByRole('dialog', { name: 'Новая доска' }).getByRole('button', { name: 'Добавить' }).click();
  await expect(page.locator('.bd-blank h2')).toHaveText('На этой доске пока пусто');
  await page.getByLabel('Найти на доске').fill('обсерватор');
  await expect(page.locator('.bd-elsewhere button')).toHaveText('Главная1');
  await page.locator('.bd-elsewhere button').click();
  await expect(zone('Локации').locator('.pv-row')).toHaveCount(1);
  await page.getByLabel('Найти на доске').fill('');

  // A plugin that changes the board itself. The built-in one arranges zones in
  // columns; a third-party one is installed after its rights are shown.
  await page.getByRole('button', { name: 'Вид доски' }).click();
  await page.getByRole('menuitemradio', { name: /Ровные колонки/ }).click();
  await expect(page.locator('.bd-surface')).toHaveClass(/layout-columns/);
  expect((await board()).kind).toBe('columns/tidy');
  await shot('board-columns-plugin');
  await page.getByRole('button', { name: 'Плагины', exact: true }).click();
  await page.locator('.fl-library nav button', { hasText: 'Чертёж' }).click();
  await page.getByRole('button', { name: 'Посмотреть и установить' }).click();
  await expect(page.locator('.bd-rights')).toContainText('Вид доски');
  await expect(page.locator('.bd-rights dl')).toContainText('Сетьнет');
  await expect(page.locator('.bd-rights dl')).toContainText('читать и менять файлы на диске');
  expect(service.plugins.get('blueprint')).toBeUndefined();
  await page.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect.poll(() => service.plugins.get('blueprint')?.origin).toBe('installed');
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('button', { name: 'Вид доски' }).click();
  await page.getByRole('menuitemradio', { name: /Чертёж со связями/ }).click();
  await expect(page.locator('.bd-surface')).toHaveClass(/bg-grid/);
  await expect(page.locator('.bd-links path').first()).toBeAttached();
  await shot('board-blueprint-plugin');

  // A view with its own code runs in a sandbox: its own origin, no network, no way to the app.
  await page.getByRole('button', { name: 'Плагины', exact: true }).click();
  await page.locator('.fl-library nav button', { hasText: 'Прогресс' }).click();
  await page.getByRole('button', { name: 'Посмотреть и установить' }).click();
  await expect(page.locator('.bd-rights dl')).toContainText('есть, работает в песочнице');
  await page.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect.poll(() => service.plugins.get('progress')?.origin).toBe('installed');
  await page.getByRole('button', { name: 'Проект', exact: true }).click();
  await zone('Задачи').hover();
  await zone('Задачи').getByRole('button', { name: 'Настройки зоны Задачи' }).click();
  await page.getByRole('menuitemradio', { name: /Кольцо прогресса/ }).click();
  const frame = zone('Задачи').frameLocator('iframe.pv-sandbox');
  await expect(frame.locator('#share')).toHaveText('17%');
  await expect(zone('Задачи').locator('iframe.pv-sandbox')).toHaveAttribute('sandbox', 'allow-scripts');
  const inside = page.frames().find(item => item.url().includes('/plugin-view/'));
  expect(await inside.evaluate(async api => {
    const reach = async url => { try { await fetch(url); return 'reached'; } catch { return 'blocked'; } };
    let parentDocument; try { parentDocument = parent.document ? 'open' : 'blocked'; } catch { parentDocument = 'blocked'; }
    let storage; try { storage = localStorage ? 'open' : 'blocked'; } catch { storage = 'blocked'; }
    return { app: await reach(api), outside: await reach('https://example.com/'), parentDocument, storage, origin: self.origin === 'null' ? 'opaque' : self.origin };
  }, service.origin + '/api/devspace')).toEqual({ app: 'blocked', outside: 'blocked', parentDocument: 'blocked', storage: 'blocked', origin: 'opaque' });
  const headers = (await fetch(inside.url())).headers.get('content-security-policy');
  expect(headers).toContain('sandbox allow-scripts'); expect(headers).toContain("connect-src 'none'"); expect(headers).toContain("default-src 'none'");
  await shot('board-sandbox-plugin');
  // The view may only ask for the actions its manifest lists; opening a thing is one.
  await frame.locator('#next li').first().click();
  await expect(page.locator('.bd-crumbs small')).toHaveText('Задача');
  await page.getByRole('radio', { name: 'Готово' }).click();
  await expect.poll(async () => (await store()).tasks.filter(task => task.projectId === project.id && task.status === 'done').length).toBe(2);
  await page.locator('.bd-crumbs button').first().click();
  await page.locator('.bd-crumbs button').first().click();
  await expect(zone('Задачи').frameLocator('iframe.pv-sandbox').locator('#share')).toHaveText('33%');

  // Hand cards to an agent: their names are pasted into its terminal, not sent.
  const headersJson = { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' };
  const agent = await (await fetch(service.origin + '/api/sessions', { method: 'POST', headers: headersJson, body: JSON.stringify({ agent: 'stub', name: 'Lantern Prototype', cwd: project.path }) })).json();
  await page.keyboard.press('Control+j');
  await expect(page.locator('.ds-agent-pane')).toBeVisible();
  for (const index of [0, 1]) { const row = zone('Локации').locator('.pv-row').nth(index); await row.hover(); await row.locator('input[type=checkbox]').check({ force: true }); }
  await expect(page.getByRole('toolbar', { name: 'Выбранные вещи' })).toContainText('Выбрано 2');
  await shot('board-selection');
  await page.getByRole('toolbar', { name: 'Выбранные вещи' }).getByRole('button', { name: 'Отдать агенту' }).click();
  await expect.poll(async () => (await service.sessions.read(agent.id)).screen.replace(/\n/g, '')).toMatch(/С доски Dev Space: «[^»]+» \[material:[\w-]+\], «[^»]+» \[material:[\w-]+\]\./);
  expect((await service.sessions.read(agent.id)).screen).not.toContain('stub: step');
  await expect(page.getByRole('toolbar', { name: 'Выбранные вещи' })).toHaveCount(0);

  // Nothing that existed before was changed by any of this.
  const last = await store(), kept = (list, old) => list.filter(item => item.id !== moved.id && old.some(entry => entry.id === item.id));
  expect(kept(last.materials, first.materials)).toEqual(first.materials.filter(item => item.id !== moved.id)); expect(kept(last.pages, first.pages)).toEqual(first.pages);
  console.log('PASS: first run, example board, three levels, move, resize, collapse, hide, search across boards, add zone and note, carry a card, hand-picked zone, board plugins, sandboxed view, hand-off to an agent, data intact');
} catch (error) {
  // What was on screen when a step failed.
  for (const context of browser?.contexts() || []) for (const page of context.pages()) await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser?.close(); await service.close(); }
