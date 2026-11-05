import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth, clipboardPermissions } from './browser.mjs';
const root = process.cwd();
const repo = await mkdtemp(path.join(root, '.cache/qa-intake-ui-'));
await mkdir(path.join(repo, 'workspace'));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
const sections = ['inbox', 'bugs', 'ux-ui', 'wishlist', 'test-runs', 'context'].map(id => ({ id, name: id }));
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [], spaces: [{ id: 'app-qa', name: 'App QA', sections }] }));
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: clipboardPermissions });
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(service.urls.workspace);
  await page.getByRole('button', { name: 'Баг', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая запись' });
  await dialog.getByLabel('Короткое название').fill('Settings reset on restart');
  await dialog.getByLabel('Описание и мысли').fill('Changed the theme. After reopening, my choice was lost.');
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 20, height: 20 } });
  await dialog.getByLabel('Прикрепить файлы', { exact: true }).setInputFiles([{ name: 'screen.png', mimeType: 'image/png', buffer: png }, { name: 'app.log', mimeType: 'text/plain', buffer: Buffer.from('Fixture log: setting not restored') }]);
  await expect(dialog.locator('.intake-attachments li')).toHaveCount(2);
  // Force one attachment failure; retry must reuse the saved card and user notes.
  await page.route('**/api/workspace/cards/*/0/images?*', route => route.fulfill({ status: 503, json: { error: 'Temporary upload error' } }), { times: 1 });
  await dialog.getByRole('button', { name: 'Сохранить запись', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Запись сохранена');
  await dialog.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings reset on restart' })).toBeVisible();
  let registry = JSON.parse(await readFile(path.join(repo, 'workspace/workspace.json'), 'utf8'));
  assert.equal(registry.entities.length, 1);
  const entity = registry.entities[0]; assert.equal(entity.category, 'bugs');
  const file = path.join(repo, 'workspace', entity.folder, 'content.card.json');
  let document = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(document.items.length, 3); assert.match(document.items[0].body, /choice was lost/);
  assert.equal(await readFile(path.join(repo, 'workspace', entity.folder, 'app.log'), 'utf8'), 'Fixture log: setting not restored');
  await page.getByRole('button', { name: 'Задание для агента', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /project-qa.md/);
  // Paste onto an existing card; save explicitly, reload and check persistence.
  await page.locator('.editable-card').evaluate((el, bytes) => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' })); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true })); }, [...png]);
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.card-save-status')).toHaveText('Сохранено');
  await page.reload();
  document = JSON.parse(await readFile(file, 'utf8')); assert.equal(document.items.length, 4);
  await page.locator('.sidebar-overview').click();
  await page.getByRole('button', { name: 'UI / UX', exact: true }).click();
  await dialog.getByLabel('Короткое название').fill('Navigation needs a clearer hierarchy');
  await dialog.getByLabel('Описание и мысли').fill('I am still exploring alternatives, not asking for implementation yet.');
  await dialog.evaluate((el, bytes) => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true })); }, [...png]);
  await expect(dialog.locator('.intake-attachments li')).toHaveCount(1);
  for (const width of [1400, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Dialog fits');
    await page.screenshot({ path: path.join(root, `.cache/qa-intake-${width}.png`) });
  }
  await dialog.getByRole('button', { name: 'Сохранить запись', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Navigation needs a clearer hierarchy' })).toBeVisible();
  registry = JSON.parse(await readFile(path.join(repo, 'workspace/workspace.json'), 'utf8'));
  assert.equal(registry.entities.length, 2); assert.equal(registry.entities[1].category, 'ux-ui');
  assert.deepEqual(errors, []);
  console.log('QA intake passed: bug/UX routing, notes, screenshot/log uploads, partial-failure retry without duplicate cards, paste/drop, saved attachments, clipboard brief and 1400/768/390px.');
} finally { await browser.close(); await service.close(); }
