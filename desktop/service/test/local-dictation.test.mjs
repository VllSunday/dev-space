import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { localConfig, localTranscribe } from '../local-dictation.mjs';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const { python } = localConfig(repo, process.env);
const installed = await access(python).then(() => true, () => false);
const stub = {
  '__init__.py': "class Segment:\n    text = ' Eu falo português, não é? '\nclass WhisperModel:\n    def __init__(self, *args, **kwargs): pass\n    def transcribe(self, audio, **kwargs): return [Segment()], None\n",
  'audio.py': 'def decode_audio(path, sampling_rate): return [0.0] * sampling_rate\n',
};

test('a local transcript keeps accented letters through the Python output pipe', { skip: !installed && 'local dictation Python is not installed' }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-whisper-stub-'));
  await mkdir(path.join(folder, 'faster_whisper'));
  for (const [name, source] of Object.entries(stub)) await writeFile(path.join(folder, 'faster_whisper', name), source);
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = folder;
  t.after(async () => {
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;
    await rm(folder, { recursive: true, force: true });
  });
  const result = await localTranscribe({ python, model: folder }, Buffer.alloc(32), 'webm');
  assert.equal(result.text, 'Eu falo português, não é?');
});

test('per-model GPU settings reach the worker and unsupported precision cannot silently fall back', { skip: !installed && 'local dictation Python is not installed' }, async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'mrmak-whisper-device-'));
  await mkdir(path.join(folder, 'faster_whisper'));
  await writeFile(path.join(folder, 'faster_whisper', '__init__.py'), "class Segment:\n    def __init__(self, text): self.text = text\nclass WhisperModel:\n    def __init__(self, *args, **kwargs): self.options = kwargs\n    def transcribe(self, audio, **kwargs): return [Segment(self.options['device'] + '/' + self.options['compute_type'])], None\n");
  await writeFile(path.join(folder, 'faster_whisper', 'audio.py'), stub['audio.py']);
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = folder;
  t.after(async () => {
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;
    await rm(folder, { recursive: true, force: true });
  });
  const audio = Buffer.alloc(32), config = { python, model: folder };
  assert.equal((await localTranscribe(config, audio, 'webm')).text, 'cpu/int8');
  const settings = path.join(folder, 'mrmak-inference.json');
  await writeFile(settings, JSON.stringify({ device: 'cuda', compute_type: 'float16' }));
  assert.equal((await localTranscribe(config, audio, 'webm')).text, 'cuda/float16');
  await writeFile(settings, JSON.stringify({ device: 'cpu', compute_type: 'float16' }));
  await assert.rejects(localTranscribe(config, audio, 'webm'), /Local transcription could not finish/);
  await writeFile(settings, JSON.stringify({ device: 'cpu', compute_type: 'int8' }));
  assert.equal((await localTranscribe(config, audio, 'webm')).text, 'cpu/int8');
});
