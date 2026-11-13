#!/usr/bin/env node
// The `devspace` command an agent or a person runs inside a Dev Space terminal.
// It only forwards the command to the local service that opened this terminal.
const url = process.env.DEVSPACE_URL, token = process.env.DEVSPACE_TOKEN;
const words = [], flags = {};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const value = argv[index];
  if (value.startsWith('--') && value.length > 2) {
    const [name, inline] = value.slice(2).split(/=(.*)/s);
    flags[name] = inline !== undefined ? inline : argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[++index] : 'true';
  } else words.push(value);
}
if (!url || !token) {
  process.stderr.write('Команда devspace работает в терминале, который открыл Dev Space.\n');
  process.exit(2);
}
const request = { words: words.length ? words : ['help'], flags };
const finish = answer => {
  if (answer.error !== undefined) { process.stderr.write(`devspace: ${answer.error || 'ошибка'}\n`); process.exit(1); }
  process.stdout.write((typeof answer.result === 'string' ? answer.result : JSON.stringify(answer.result, null, 2)) + '\n');
  process.exit(0);
};
try {
  const response = await fetch(new URL('/agent/command', url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Devspace-Token': token }, body: JSON.stringify(request) });
  const answer = await response.json().catch(() => ({ error: 'Dev Space ответил непонятно.' }));
  finish(response.ok ? { result: answer.result } : { error: answer.error || 'ошибка' });
} catch {
  // A sandbox without network access: leave the request as a file for the service.
  const spool = process.env.DEVSPACE_SPOOL;
  if (spool) try {
    const { randomUUID } = await import('node:crypto'), { writeFile, rename, readFile, rm } = await import('node:fs/promises'), path = await import('node:path');
    const id = randomUUID(), temp = path.join(spool, `tmp-${id}`), answerFile = path.join(spool, `res-${id}.json`);
    await writeFile(temp, JSON.stringify({ token, ...request }), { mode: 0o600 }); await rename(temp, path.join(spool, `req-${id}.json`));
    for (const until = Date.now() + 20 * 60000; Date.now() < until;) {
      await new Promise(resolve => setTimeout(resolve, 150));
      const text = await readFile(answerFile, 'utf8').catch(() => null);
      if (text !== null) { await rm(answerFile, { force: true }); finish(JSON.parse(text)); }
    }
  } catch { /* Reported below. */ }
  process.stderr.write('devspace: Dev Space не отвечает. Возможно, приложение закрыто.\n');
  process.exit(1);
}
