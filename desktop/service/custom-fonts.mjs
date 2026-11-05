import path from 'node:path';
import { mkdir, readFile, writeFile, unlink, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readJson, saveJson, within } from './util.mjs';

export const defaultDisplay = { interfaceFont: 'Segoe UI', terminalFont: 'Cascadia Code', zoom: 100 };
export function displaySettings(value, previous = defaultDisplay) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(Error('Выберите настройки оформления.'), { status: 400 });
  const result = { ...defaultDisplay, ...previous };
  for (const key of ['interfaceFont', 'terminalFont']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'string' || !/^[\p{L}\p{N} ._-]{1,100}$/u.test(value[key].trim())) throw Object.assign(Error('Введите название шрифта без CSS-команд.'), { status: 400 });
    result[key] = value[key].trim();
  }
  if (value.zoom !== undefined) {
    if (!Number.isInteger(value.zoom) || value.zoom < 75 || value.zoom > 175) throw Object.assign(Error('Масштаб доступен от 75 до 175%.'), { status: 400 });
    result.zoom = value.zoom;
  }
  return result;
}
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
export class CustomFonts {
  constructor(stateDir) { this.stateDir = stateDir; this.root = path.join(stateDir, 'fonts'); this.index = path.join(this.root, 'fonts.json'); this.queue = Promise.resolve(); }
  async list() { const list = await readJson(this.index, []); return (Array.isArray(list) ? list : []).filter(font => font && /^[a-f\d-]{36}$/.test(font.id) && ['ttf', 'otf', 'woff', 'woff2'].includes(font.ext) && typeof font.family === 'string'); }
  async bytes(id) {
    const item = (await this.list()).find(font => font.id === id);
    if (!item) fail('Шрифт не найден.', 404);
    const file = await realpath(path.join(this.root, `${item.id}.${item.ext}`));
    if (!within(await realpath(this.root), file)) fail('Недопустимый файл шрифта.', 403);
    return readFile(file);
  }
  async upload(request, name) {
    name = path.basename(String(name).replaceAll('\\', '/')).slice(0, 160);
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) fail('Выберите TTF, OTF, WOFF или WOFF2.');
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 12 * 1024 * 1024) fail('Шрифт должен быть меньше 12 МБ.', 413); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), signature = bytes.toString('ascii', 0, 4);
    const valid = ext === 'woff' ? signature === 'wOFF' : ext === 'woff2' ? signature === 'wOF2' : ext === 'otf' ? signature === 'OTTO' : bytes.length >= 4 && (bytes.readUInt32BE(0) === 0x00010000 || signature === 'true');
    if (bytes.length < 12 || !valid) fail('Файл не похож на поддерживаемый шрифт.');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const job = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.root, { recursive: true });
      const actual = await realpath(this.root), expected = path.join(await realpath(this.stateDir), 'fonts');
      if (process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected) fail('Папка шрифтов должна находиться внутри настроек приложения.', 403);
      const list = await this.list(), existing = list.find(font => font.hash === hash);
      if (existing) return existing;
      if (list.length >= 20) fail('Сначала удалите один из загруженных шрифтов.');
      const base = name.slice(0, -(ext.length + 1)).replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Мой шрифт';
      let family = base, suffix = 2;
      while (list.some(font => font.family === family)) family = `${base} ${suffix++}`;
      const font = { id: randomUUID(), name, family, ext, size, hash };
      const file = path.join(this.root, `${font.id}.${ext}`);
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      try { await saveJson(this.index, [...list, font]); } catch (error) { await unlink(file).catch(() => {}); throw error; }
      return font;
    });
    this.queue = job; return job;
  }
  async remove(id) {
    const job = this.queue.catch(() => {}).then(async () => {
      const list = await this.list(), item = list.find(font => font.id === id);
      if (!item) fail('Шрифт не найден.', 404);
      await saveJson(this.index, list.filter(font => font.id !== id));
      await unlink(path.join(this.root, `${item.id}.${item.ext}`)).catch(() => {});
      return item;
    });
    this.queue = job; return job;
  }
}
