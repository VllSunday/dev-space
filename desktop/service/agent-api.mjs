import path from 'node:path';
import os from 'node:os';
import { createHash, createHmac } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { equalSecret, readJson, saveJson, secret } from './util.mjs';

// The way in for the `devspace` command. Every terminal gets a token of its own.
// The token identifies the session and opens only the command pool: it cannot
// read settings, keys or the rest of the service API.
const cli = fileURLToPath(new URL('./cli/devspace.mjs', import.meta.url));

export class AgentApi {
  constructor({ stateDir, sessions, commands }) { Object.assign(this, { stateDir, sessions, commands }); this.bin = path.join(stateDir, 'bin'); }
  async init() {
    const file = path.join(this.stateDir, 'agent-secret.json');
    this.secret = (await readJson(file, null))?.secret;
    if (!this.secret) { this.secret = secret(); await saveJson(file, { secret: this.secret }); }
    // A small launcher on PATH, so `devspace` works in any shell and any CLI agent.
    await mkdir(this.bin, { recursive: true });
    await writeFile(path.join(this.bin, 'devspace'), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
    await chmod(path.join(this.bin, 'devspace'), 0o755);
    await writeFile(path.join(this.bin, 'devspace.cmd'), `@echo off\r\n"${process.execPath}" "${cli}" %*\r\n`);
    // Some CLI agents run commands in a sandbox without network access, where the
    // local service cannot be reached. Requests may then be left as files in this
    // private folder; the same token check applies to them.
    this.spool = path.join(os.tmpdir(), 'devspace-' + createHash('sha256').update(this.secret).digest('hex').slice(0, 16));
    await mkdir(this.spool, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.spool)) await rm(path.join(this.spool, name), { force: true });
    this.timer = setInterval(() => this.drain().catch(() => {}), 300); this.timer.unref();
    return this;
  }
  close() { clearInterval(this.timer); }
  async drain() {
    if (this.draining) return; this.draining = true;
    try {
      for (const name of await readdir(this.spool)) {
        const id = /^req-([a-f0-9-]{36})\.json$/.exec(name)?.[1]; if (!id) continue;
        const file = path.join(this.spool, name); let request = null;
        try { request = JSON.parse(await readFile(file, 'utf8')); } catch { /* Answered as a malformed request. */ }
        await rm(file, { force: true });
        this.handle(request?.token, request || {}).then(result => ({ result }), error => ({ error: String(error?.message || 'ошибка').slice(0, 1500) })).then(async answer => {
          const temp = path.join(this.spool, `tmp-${id}`); await writeFile(temp, JSON.stringify(answer), { mode: 0o600 }); await rename(temp, path.join(this.spool, `res-${id}.json`));
        }).catch(() => {});
      }
    } finally { this.draining = false; }
  }
  token(sessionId) { return createHmac('sha256', this.secret).update(sessionId).digest('base64url'); }
  environment(session, origin, env = process.env) {
    const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') || 'PATH';
    return { DEVSPACE_URL: origin, DEVSPACE_TOKEN: this.token(session.id), DEVSPACE_SESSION: session.id, DEVSPACE_SPOOL: this.spool, [key]: this.bin + path.delimiter + (env[key] || '') };
  }
  session(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    for (const session of this.sessions.items.values()) if (session.open && equalSecret(token, this.token(session.id))) return session;
    return null;
  }
  // «step done» → step.done; a single word is a command of its own; the rest is text.
  async handle(token, { words = [], flags = {} } = {}) {
    const session = this.session(token);
    if (!session) throw Object.assign(new Error('Этот терминал Dev Space не узнал. Откройте агента заново.'), { status: 401 });
    if (!Array.isArray(words) || words.length > 40 || words.some(word => typeof word !== 'string' || word.length > 20000) || !flags || typeof flags !== 'object') throw Object.assign(new Error('Некорректная команда.'), { status: 400 });
    const names = this.commands.list().map(command => command.name), pair = words.slice(0, 2).join('.');
    const name = names.includes(pair) ? pair : names.includes(words[0]) ? words[0] : pair;
    const rest = words.slice(names.includes(pair) ? 2 : 1).join(' ');
    const args = Object.fromEntries(Object.entries(flags).filter(([key, value]) => /^[a-zA-Z][\w-]{0,39}$/.test(key) && typeof value === 'string' && value.length <= 20000));
    if (rest) args.text = rest;
    return this.commands.run(name, args, { sessionId: session.id, agent: true });
  }
}
