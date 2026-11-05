import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureWhisper, localWhisperSettings } from '../desktop/service/local-whisper-settings.mjs';
import { createService } from '../desktop/service/server.mjs';

async function fixture() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'devspace-whisper-ui-'));
  const python = path.join(repo, process.platform === 'win32' ? 'python.exe' : 'python3');
  const model = path.join(repo, 'my model');
  await mkdir(model); await writeFile(python, 'fixture'); await writeFile(path.join(model, 'model.bin'), 'fixture');
  return { repo, python, model, device: 'cpu' };
}
const runner = async () => ({ available: true, device: 'cpu', computeType: 'int8' });
test('Whisper setup checks a model.bin and preserves unrelated secrets and settings', async () => {
  const value = await fixture();
  await writeFile(path.join(value.repo, '.env'), '# keep this\nOTHER_KEY="private fixture"\nMRMAK_WHISPER_DEVICE=auto\n');
  const result = await configureWhisper(value.repo, { ...value, model: path.join(value.model, 'model.bin') }, { runner });
  // macOS /var and Windows 8.3 temporary paths can name the same folder.
  assert.equal(result.model, await realpath(value.model)); assert.equal(result.result.device, 'cpu');
  const env = await readFile(path.join(value.repo, '.env'), 'utf8');
  assert.ok(env.startsWith('# keep this\nOTHER_KEY="private fixture"\n'));
  assert.equal(env.match(/MRMAK_WHISPER_DEVICE=/g).length, 1);
  const settings = await localWhisperSettings(value.repo);
  assert.equal(settings.python.replaceAll('\\', '/'), (await realpath(value.python)).replaceAll('\\', '/'));
  assert.equal(settings.device, 'cpu'); assert.equal(settings.available, true);
  assert.equal((await readdir(value.repo)).filter(name => name.startsWith('.env.whisper-')).length, 0);
});
test('a failed, cancelled or incompatible Whisper connection never changes configuration', async () => {
  const value = await fixture(), file = path.join(value.repo, '.env');
  await writeFile(file, 'OTHER_KEY=untouched\n');
  await assert.rejects(configureWhisper(value.repo, value, { runner: async () => { throw Error('load failed'); } }), { status: 422 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(configureWhisper(value.repo, value, { runner, signal: controller.signal }), { status: 409 });
  await assert.rejects(configureWhisper(value.repo, { ...value, python: path.join(value.repo, 'arbitrary.exe') }, { runner }), { status: 400 });
  await assert.rejects(configureWhisper(value.repo, { ...value, device: 'cloud' }, { runner }), { status: 400 });
  assert.equal(await readFile(file, 'utf8'), 'OTHER_KEY=untouched\n');
});
test('Whisper configuration API is authenticated and applies only a successfully checked model', async () => {
  const value = await fixture();
  await mkdir(path.join(value.repo, 'workspace'));
  let count = 0;
  const service = await createService({ repo: value.repo, uiDir: value.repo, mcpOptions: { home: value.repo, env: {} }, localWhisperCheck: async config => { count++; assert.equal(config.device, 'cpu'); return runner(); } });
  const request = (route, data) => fetch(service.origin + '/api' + route, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  try {
    assert.equal((await fetch(service.origin + '/api/dictation/local')).status, 401);
    const response = await request('/dictation/local', value); assert.equal(response.status, 200); assert.equal(count, 1);
    assert.equal((await (await request('/dictation/local')).json()).available, true);
    const settings = await (await request('/settings', {})).json(); assert.equal(settings.transcribeProvider, 'local');
    assert.equal((await request('/dictation/local', { ...value, model: '/not/a/model.pt' })).status, 400);
    assert.equal(count, 1);
  } finally { await service.close(); }
});
