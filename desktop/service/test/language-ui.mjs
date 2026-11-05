// Isolated repositories, browser profiles and fake terminals; no live user state.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, '.cache/localization-previews');
await mkdir(output, { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/language-ui-'));
await mkdir(path.join(repo, 'workspace/guide'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(root, 'dist/assets'), { recursive: true });
await writeFile(path.join(repo, 'workspace/guide/start.md'), '# Getting started\n\nYour original guide.');
await writeFile(path.join(repo, 'workspace/guide/start.ru.md'), '# Первые шаги\n\nСправка на русском языке.');
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [{
  id: 'guide', title: 'Getting started', folder: 'guide', category: 'dev', created: '2026-11-05', status: 'active', sample: true,
  steps: [{ name: 'Start', path: 'start.md' }], locales: { ru: { title: 'Первые шаги', steps: [{ name: 'Начало', path: 'start.ru.md' }] } },
}] }));
const transport = { probe: async () => ({ ready: true, installed: true }), enable: async origin => ({ origin }), disable: async () => {} };
let browser, service;
const views = [], errors = [], writes = [];
try {
  service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} }, mobileOptions: { transport } });
  const session = service.sessions.make({ id: randomUUID(), name: 'Настройки проекта', group: 'Команда', agent: 'codex', cwd: repo, status: 'running', open: true, cols: 90, rows: 30, createdAt: new Date().toISOString() });
  session.process = { write: value => writes.push(value), resize() {}, kill() {} };
  service.sessions.items.set(session.id, session);
  await service.sessions.hydrate(session);
  await new Promise(resolve => session.terminal.write('Terminal content stays in its original language.\r\n', resolve));
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage(), chats = await context.newPage(); views.push(page, chats);
  for (const view of views) { view.setDefaultTimeout(12000); view.on('pageerror', error => errors.push(error.message)); }
  await chats.route(`**/api/sessions/${session.id}/messages`, route => route.fulfill({ json: { supported: true, messages: [{ id: 'u1', role: 'user', text: 'Settings', at: '2026-11-05T12:00:00Z' }, { id: 'a1', role: 'assistant', text: 'Исходный ответ агента.', at: '2026-11-05T12:00:01Z' }] } }));
  await page.goto(service.urls.workspace + '#/guide/0');
  await chats.goto(service.urls.chats);
  await expect(page.locator('.mak-markdown h1')).toHaveText('Первые шаги');
  await expect(chats.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(chats.getByRole('button', { name: 'Переписка', exact: true })).toBeVisible();
  const terminal = await chats.locator('.terminal-host .xterm').elementHandle();
  await page.getByRole('button', { name: 'Открыть или закрыть настройки', exact: true }).click();
  await page.getByLabel('Язык интерфейса', { exact: true }).selectOption('en');
  await expect(chats.getByRole('button', { name: 'Conversation', exact: true })).toBeVisible();
  assert.equal(await terminal.evaluate(node => node.isConnected), true);
  await expect(page.locator('.mak-markdown h1')).toHaveText('Getting started');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await chats.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(chats.locator('.conversation-copy-text').getByText('Settings', { exact: true })).toBeVisible();
  const draft = chats.locator('.conversation-composer textarea');
  await draft.fill('Несохранённый черновик');
  await chats.getByRole('button', { name: 'Chat appearance', exact: true }).click();
  await chats.getByLabel('Interface language', { exact: true }).selectOption('ru');
  await expect(draft).toHaveValue('Несохранённый черновик');
  await expect(chats.locator('.conversation-copy-text').getByText('Settings', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.mak-markdown h1')).toHaveText('Первые шаги');
  await expect(chats.locator('.chats-brand img')).toHaveAttribute('src', '/assets/brand-chats.svg');
  await expect(page.locator('img[src="/assets/brand-workspace.svg"]:visible').first()).toBeVisible();
  await chats.screenshot({ path: path.join(output, 'chats-language.png') });
  await chats.getByRole('button', { name: 'Оформление чатов', exact: true }).click();
  await chats.getByRole('tab', { name: /^Настройки проекта/ }).dblclick();
  const rename = chats.getByLabel('Название чата', { exact: true });
  await rename.fill('Разработка интерфейса'); await rename.press('Enter');
  await expect(chats.getByRole('tab', { name: /^Разработка интерфейса/ })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть или закрыть настройки', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'workspace-language.png') });
  for (const width of [620, 900]) {
    await chats.setViewportSize({ width, height: 850 });
    assert.equal(await chats.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  }
  await chats.screenshot({ path: path.join(output, 'chats-russian.png') });
  assert.deepEqual(writes, [], 'Language changes and renaming must not send CLI input');
  await service.mobile.enable();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await mobileContext.newPage(); views.push(phone); phone.setDefaultTimeout(12000); phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(service.mobile.origin + '/mobile/');
  await expect(phone.getByLabel('Язык интерфейса', { exact: true })).toBeVisible();
  await phone.getByLabel('Язык интерфейса', { exact: true }).selectOption('en');
  await expect(phone.getByRole('heading', { name: 'Start in Dev Space Chats' })).toBeVisible();
  await phone.reload(); await expect(phone.locator('html')).toHaveAttribute('lang', 'en');
  await phone.getByLabel('Interface language', { exact: true }).selectOption('ru');
  await phone.screenshot({ path: path.join(output, 'mobile-language.png') });
  // A connected phone receives the explicit guide variant while retaining its own language preference.
  const pairing = await service.mobile.newPairing();
  const pending = service.mobile.claim({ token: new URL(pairing.url).hash.slice(6), name: 'Телефон' });
  await service.mobile.approve(pending.id);
  const finish = await fetch(service.mobile.origin + '/mobile/api/pair/finish', { method: 'POST', headers: { Origin: service.mobile.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
  const cookie = finish.headers.get('set-cookie').split(';')[0], index = cookie.indexOf('=');
  await mobileContext.addCookies([{ name: cookie.slice(0, index), value: cookie.slice(index + 1), url: service.mobile.origin, httpOnly: true, sameSite: 'Strict' }]);
  await phone.reload();
  await phone.getByRole('button', { name: 'Настройки телефона', exact: true }).click();
  await expect(phone.getByLabel('Язык интерфейса', { exact: true })).toHaveValue('ru');
  await phone.getByLabel('Язык интерфейса', { exact: true }).selectOption('en');
  await expect(chats.locator('html')).toHaveAttribute('lang', 'ru');
  await phone.getByRole('button', { name: 'Phone settings', exact: true }).click();
  await phone.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(phone.getByText('Getting started', { exact: true })).toBeVisible();
  assert.equal(await phone.locator('html').evaluate(node => node.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('Language UI passed: two windows, persisted setting, live terminal, draft, Cyrillic rename, bilingual guide, mobile and distinct stars.');
} catch (error) {
  for (let i = 0; i < views.length; i++) await views[i].screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
  throw error;
} finally { await browser?.close(); await service?.close(); }
