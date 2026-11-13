#!/usr/bin/env node
// A scripted stand-in for a CLI agent, used to check flows without a model.
// It sits in a real terminal, waits for an assignment line from Dev Space, reads
// the assignment with `devspace step task` and answers the way the scenario
// module says. The scenario is a module whose default export receives each
// assignment: ({ task, step, visit, devspace, write }) => void.
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scenario = (await import(pathToFileURL(process.env.DEVSPACE_STUB_SCENARIO).href)).default;
const visits = new Map();
const devspace = (...args) => new Promise(resolve => execFile(process.platform === 'win32' ? 'devspace.cmd' : 'devspace', args, { env: process.env, shell: process.platform === 'win32' }, (error, stdout, stderr) => resolve({ ok: !error, out: stdout.trim(), error: stderr.trim() })));
const write = async (file, content) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2)); return file; };

process.stdout.write('stub agent ready\n');
let busy = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.includes('[Dev Space')) return;
  busy = busy.then(async () => {
    const task = await devspace('step', 'task');
    if (!task.ok) { process.stdout.write(`stub: no task (${task.error})\n`); return; }
    const step = /шаг «([^»]+)»/.exec(task.out)?.[1] || '', visit = (visits.get(step) || 0) + 1;
    visits.set(step, visit);
    process.stdout.write(`stub: step «${step}», visit ${visit}\n`);
    await scenario({ task: task.out, step, visit, devspace, write, say: text => process.stdout.write(text + '\n') });
  }).catch(error => process.stdout.write(`stub error: ${error.message}\n`));
});
