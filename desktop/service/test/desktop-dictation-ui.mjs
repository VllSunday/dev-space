// Isolated workspace, fake microphone and transcription; no real agent input.
import { expect } from '@playwright/test';
import { launchBrowser, desktopAuth } from './browser.mjs';
import { mkdtemp, mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createService } from '../server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
await mkdir(path.join(root, '.cache'), { recursive: true });
const repo = await mkdtemp(path.join(root, '.cache/desktop-dictation-ui-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), '{"entities":[]}');
await cp(path.join(root, 'dist'), path.join(repo, 'ui'), { recursive: true });
await cp(path.join(root, 'public/assets'), path.join(repo, 'ui/assets'), { recursive: true });
const service = await createService({ repo, uiDir: path.join(repo, 'ui'), mcpOptions: { home: repo, env: {} } });
// A shell may host Claude/Codex manually; dictation must still be manual input.
const session = service.sessions.make({ id: 'dictation-test', createdAt: new Date().toISOString(), cols: 90, rows: 32, name: 'Dictation test', agent: 'shell', cwd: repo, open: true });
const writes = [];
function output(data) {
  session.terminal.write(data);
  service.sessions.emit('output', { id: session.id, sequence: ++session.sequence, data });
}
session.status = 'running'; session.process = { write: data => { writes.push(data); output(data.replace(/\x1b\[20[01]~/g, '')); }, resize() {}, kill() {} };
service.sessions.items.set(session.id, session);
let browser;
try {
  browser = await launchBrowser({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await desktopAuth(page.context(), service.urls.workspace);
  await page.addInitScript(() => {
    const original = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = async function (options) {
      try { return await original.call(this, options); } catch {
        const audio = new AudioContext(), tone = audio.createOscillator(), output = audio.createMediaStreamDestination();
        tone.connect(output); tone.start(); return output.stream;
      }
    };
  });
  await page.route('**/api/dictation', route => route.fulfill({ json: { available: true, provider: 'local', maxSeconds: 120, maxBytes: 8388608 } }));
  let selectedProvider = 'local';
  await page.unroute('**/api/dictation');
  await page.route('**/api/dictation', async route => { const data = route.request().postDataJSON(); if (data?.provider) selectedProvider = data.provider; return route.fulfill({ json: { available: true, provider: selectedProvider, maxSeconds: 120, maxBytes: 8388608, providers: [{ id: 'local', label: 'Local Whisper · Free', available: true, detail: 'Runs locally.' }, { id: 'openai', label: 'OpenAI · Paid', available: true, detail: 'Uses API credit.' }] } }); });
  let transcriptions = 0;
  let transcript = 'Please review this draft.\nKeep it unsent.';
  await page.route('**/api/transcribe', route => { transcriptions++; return route.fulfill({ json: { text: transcript } }); });
  await page.goto(service.urls.chats);
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Dictation draft' })).toHaveCount(0);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText('Existing draft: ');
  await expect.poll(() => writes.join('')).toContain('Existing draft: ');
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true, cancelable: true })));
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(700);
  session.lastInputAt = new Date().toISOString();
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  assert.equal(transcriptions, 1);
  assert.ok(writes.includes('Please review this draft. Keep it unsent.'));
  assert.ok(writes.every(text => !/[\r\n]/.test(text)), 'plain shell paste must not press Enter');
  await expect.poll(async () => (await service.sessions.read(session.id)).screen).toContain('Existing draft: Please review this draft. Keep it unsent.');
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await expect(page.getByText('Dictation inserted', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByRole('button', { name: 'Cancel recording' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  assert.equal(transcriptions, 1);
  // An agent enables bracketed paste: preserve multiline text as an editable draft.
  transcript = 'Please review this draft.';
  output('\x1b[?2004h');
  await page.route('**/api/sessions/dictation-test/input', route => route.fulfill({ status: 503, json: { error: 'Test paste unavailable' } }));
  await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByRole('button', { name: 'Transcribe recording', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Test paste unavailable');
  await page.unroute('**/api/sessions/dictation-test/input');
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  assert.equal(writes.filter(text => text === '\x1b[200~Please review this draft.\x1b[201~').length, 1);
  assert.ok(!writes.includes('\r'));
  // Agent tabs must also accept dictation immediately after the user typed.
  session.agent = 'claude'; service.sessions.changed(session);
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Dictate a message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toBeVisible();
  await page.waitForTimeout(700);
  session.lastInputAt = new Date().toISOString();
  await page.getByRole('button', { name: 'Stop recording and transcribe' }).click();
  await expect(page.getByRole('button', { name: 'Dictate a message', exact: true })).toBeEnabled();
  assert.equal(writes.filter(text => text === '\x1b[200~Please review this draft.\x1b[201~').length, 2);
  assert.ok(!writes.includes('\r'));
  await page.getByRole('button', { name: 'Mobile access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Phone settings', exact: true })).toBeVisible();
  const beforeSettingsShortcut = transcriptions;
  await page.keyboard.press('Control+Shift+Space');
  assert.equal(transcriptions, beforeSettingsShortcut, 'a settings dialog must not start a hidden recorder');
  await expect(page.getByRole('button', { name: 'Stop recording and transcribe' })).toHaveCount(0);
  const provider = page.getByRole('combobox', { name: 'Dictation provider' });
  await provider.selectOption('openai'); await expect(provider).toHaveValue('openai');
  await provider.selectOption('local'); await expect(provider).toHaveValue('local');
  await page.screenshot({ path: path.join(repo, 'desktop-dictation.png') });
  console.log(JSON.stringify({ ok: true, screenshot: path.join(repo, 'desktop-dictation.png'), checks: ['shortcut start/stop', 'repeat ignored', 'Escape cancels recording', 'shortcut retries saved recording', 'modal guard', 'shell paste', 'existing draft preserved', 'no Enter', 'focus and confirmation', 'cancel', 'retry after failed insertion', 'bracketed paste', 'agent paste after recent typing', 'no extra panel'] }));
} finally { await browser?.close(); session.process = null; await service.close(); }
