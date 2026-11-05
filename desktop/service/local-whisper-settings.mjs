import path from 'node:path';
import { readFile, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { localAvailable, localCheck, localConfig } from './local-dictation.mjs';
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
export async function localWhisperSettings(repo) {
  const keys = { ...process.env, ...parse(await readFile(path.join(repo, '.env'), 'utf8').catch(() => '')) };
  const config = localConfig(repo, keys);
  return { python: (await stat(config.python).catch(() => null))?.isFile() ? config.python : '', model: (await stat(path.join(config.model, 'model.bin')).catch(() => null))?.isFile() ? config.model : '', device: config.device || 'auto', available: await localAvailable(config) };
}
export async function configureWhisper(repo, value, { runner = localCheck, signal } = {}) {
  for (const key of ['python', 'model']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 2000) fail('Выберите Python и файл model.bin.');
  if (!['auto', 'cpu', 'cuda'].includes(value.device)) fail('Выберите устройство распознавания.');
  let python, model;
  try {
    python = await realpath(path.resolve(value.python.trim()));
    if (!/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(path.basename(python)) || !(await stat(python)).isFile()) fail('Выберите исполняемый файл Python.');
    model = await realpath(path.resolve(value.model.trim()));
    if ((await stat(model)).isFile() && path.basename(model).toLowerCase() === 'model.bin') model = path.dirname(model);
    if (!(await stat(path.join(model, 'model.bin'))).isFile()) fail('В папке модели не найден model.bin.');
  } catch (error) { if (error.status) throw error; fail('Python или модель не найдены. Выберите существующие файлы.'); }
  const config = { python, model, device: value.device };
  let result;
  try { result = await runner(config, signal); } catch { fail('Проверка Whisper не прошла. Выберите Python с установленным faster-whisper и совместимую модель CTranslate2. При ошибке CUDA попробуйте CPU.', 422); }
  if (!result?.available || signal?.aborted) fail('Проверка подключения отменена или не завершена.', 409);
  const file = path.join(repo, '.env');
  let source = await readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
  for (const [key, data] of Object.entries({ MRMAK_WHISPER_PYTHON: python.replaceAll('\\', '/'), MRMAK_WHISPER_MODEL: model.replaceAll('\\', '/'), MRMAK_WHISPER_DEVICE: value.device })) {
    const line = `${key}=${JSON.stringify(data)}`;
    const expression = new RegExp(`^${key}\\s*=.*$`, 'm');
    source = expression.test(source) ? source.replace(expression, () => line) : source.replace(/\s*$/, '') + '\n' + line + '\n';
  }
  const temporary = path.join(repo, `.env.whisper-${randomUUID()}`);
  try { await writeFile(temporary, source, { flag: 'wx', mode: 0o600 }); if (signal?.aborted) fail('Подключение отменено.', 409); await rename(temporary, file); } finally { await unlink(temporary).catch(() => {}); }
  return { python, model, device: value.device, result };
}
