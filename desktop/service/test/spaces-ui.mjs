import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';
const root = process.cwd();
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/spaces-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(service.urls.workspace);
  await page.getByRole('button', { name: 'Новый space', exact: true }).click();
  await page.getByLabel('Название space', { exact: true }).fill('App QA');
  await page.getByRole('button', { name: 'Создать space', exact: true }).click();
  await expect(page.locator('.space-tab-list .selected')).toHaveText('App QA');
  await page.locator('.section-link').filter({ hasText: 'Bugs' }).click();
  await page.getByRole('button', { name: '+ Новая карточка', exact: true }).click();
  await page.getByRole('dialog').locator('input[maxlength="200"]').fill('Settings do not persist');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.getByRole('heading', { name: 'Settings do not persist', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  const cardUrl = page.url();
  await page.locator('.sidebar-overview').click();
  await page.getByLabel('Статус: Settings do not persist', { exact: true }).selectOption('review');
  await expect(page.getByLabel('Статус: Settings do not persist')).toBeEnabled();
  await page.getByLabel('Приоритет: Settings do not persist', { exact: true }).selectOption('urgent');
  await expect(page.getByLabel('Приоритет: Settings do not persist')).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Статус: Settings do not persist')).toHaveValue('review');
  await expect(page.getByLabel('Приоритет: Settings do not persist')).toHaveValue('urgent');
  await page.getByRole('button', { name: 'Настроить space', exact: true }).click();
  await page.getByLabel('Название новой вкладки').fill('Release checks');
  await page.getByRole('button', { name: 'Добавить вкладку', exact: true }).click();
  await expect(page.getByLabel('Название вкладки: Release checks', { exact: true })).toBeVisible();
  await page.getByLabel('Название вкладки: Release checks', { exact: true }).fill('Regression');
  await page.getByLabel('Название вкладки: Release checks', { exact: true }).locator('..').getByRole('button', { name: 'Сохранить: Release checks', exact: true }).click();
  await expect(page.getByLabel('Название вкладки: Regression', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.space-tab-list').getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.space-tab-list .selected')).toHaveText('App QA');
  await expect(page.locator('.task-row')).toHaveCount(1);
  // Archive must remain accessible, and restoring must persist.
  await page.getByRole('button', { name: 'В архив: Settings do not persist', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.locator('.sidebar-archive-toggle').click();
  await page.getByRole('button', { name: 'Вернуть: Settings do not persist', exact: true }).click();
  await expect(page.getByRole('button', { name: 'В архив: Settings do not persist', exact: true })).toBeEnabled();
  await page.locator('.sidebar-archive-toggle').count().then(async count => { if (count) await page.locator('.sidebar-archive-toggle').click(); });
  // Use actual data for visual density, not placeholder-only screenshots.
  const headers = { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' };
  const state = JSON.parse(await readFile(path.join(repo, 'workspace/workspace.json'), 'utf8'));
  const qa = state.spaces.find(s => s.name === 'App QA');
  for (const [title, category] of [['Review onboarding flow', 'section-3'], ['Keyboard navigation', 'section-1'], ['Save custom filters', 'section-2'], ['Windows smoke test', 'section-4']]) {
    const response = await fetch(service.origin + '/api/workspace/cards', { method: 'POST', headers, body: JSON.stringify({ title, template: 'research', spaceId: qa.id, category }) });
    assert.equal(response.status, 201);
  }
  await page.reload(); await expect(page.locator('.task-row')).toHaveCount(5);
  for (const theme of ['dark', 'light']) {
    await fetch(service.origin + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ workspaceTheme: theme }) });
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 950 });
      if (width === 390) await page.reload();
      if (width > 719) {
        if (await page.locator('.sidebar-reopen').isVisible()) await page.locator('.sidebar-reopen').click();
        await expect.poll(async () => (await page.locator('.sidebar').boundingBox()).x).toBeGreaterThanOrEqual(0);
        const sidebar = await page.locator('.sidebar').boundingBox(), main = await page.locator('.main').boundingBox();
        assert.ok(main.x >= sidebar.x + sidebar.width - 1, 'Sidebar must not cover content');
      }
      await expect(page.locator('.space-tabs')).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      if (width === 1440) await page.screenshot({ path: path.join(root, `.cache/spaces-${theme}.png`) });
      if (width === 390) await page.screenshot({ path: path.join(root, `.cache/spaces-narrow-${theme}.png`) });
    }
  }
  await page.goto(cardUrl);
  await expect(page.getByRole('heading', { name: 'Settings do not persist', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Spaces UI passed: create, sections, scope, history, persistence, workflow, priority, archive, deep link, dark/light and 1440/768/390px.');
} finally { await browser.close(); await service.close(); }
