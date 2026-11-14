// One flow with a real CLI agent instead of the scripted one. Optional: it needs
// the CLI installed and signed in on this machine, and it spends that account's
// usage. Run: node checks/flows-real-agent.mjs claude --bypass
//
// --bypass starts the agent with its own «skip permissions» mode, so the run
// needs nobody at the keyboard. Without it the agent may only run the `devspace`
// command unasked and will wait for a person on anything else.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../desktop/service/server.mjs';

const agent = process.argv[2] || 'claude', bypass = process.argv.includes('--bypass'), flowId = process.argv.find(item => item.startsWith('--flow='))?.slice(7) || 'materials-to-page';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = await mkdtemp(path.join(os.tmpdir(), 'devspace-real-agent-'));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), headers = { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' };
let failed = false;
try {
  await fetch(service.origin + '/api/settings', { method: 'POST', headers, body: JSON.stringify({ defaultBypass: bypass, allowDevspaceCommand: true }) });
  let state = await service.devspace.read();
  state = await service.devspace.mutate({ action: 'import-template', templateId: 'wind-islands', baseRevision: state.revision });
  const project = state.projects.at(-1), sources = state.materials.filter(item => item.projectId === project.id && item.topicId.endsWith('world')).slice(0, 3);
  const input = flowId === 'plugin-by-words' ? { text: 'Покажи задачи зоны доской: слева «надо», посередине «в работе», справа «готово», а сверху — сколько задач готово' } : { things: sources.map(item => 'material:' + item.id), text: 'Коротко, с разделом «Следующий шаг».' };
  const role = Object.keys((await service.flows.get(flowId)).flow.roles)[0];
  const run = await service.flows.launch({ flowId, projectId: project.id, roles: { [role]: { agent } }, input });
  console.log(`Flow «${run.name}» launched with ${agent}${bypass ? ' (bypass)' : ''}. Waiting for the agent…`);
  let view, shown = '';
  for (const until = Date.now() + 8 * 60000; Date.now() < until; await sleep(3000)) {
    view = service.flows.list().find(item => item.id === run.id);
    const session = view.roles[role].sessionId, screen = session ? (await service.sessions.read(session, 60)).screen : '';
    // A folder the CLI has not seen asks whether to trust it. Whoever runs this check has chosen the folder.
    if (/trust this folder/i.test(screen) && !shown.includes('trust')) { service.sessions.keys(session, /❯\s*Yes, I trust/.test(screen) ? '\r' : '\x1b[B'); await sleep(400); if (!/❯\s*Yes, I trust/.test(screen)) service.sessions.keys(session, '\r'); shown += 'trust'; console.log('· confirmed the folder trust prompt'); }
    if (/Do you trust the contents of this directory|allow Codex to work in this folder/i.test(screen) && !shown.includes('codex-trust')) { service.sessions.keys(session, '\r'); shown += 'codex-trust'; console.log('· confirmed the folder trust prompt'); }
    // The CLI's own one-time warning about its «skip permissions» mode.
    if (bypass && /Yes, I accept/.test(screen) && !shown.includes('accept')) { service.sessions.keys(session, /❯\s*(\d\.\s*)?Yes, I accept/.test(screen) ? '\r' : '\x1b[B'); await sleep(400); if (!/❯\s*(\d\.\s*)?Yes, I accept/.test(screen)) service.sessions.keys(session, '\r'); shown += 'accept'; console.log('· accepted the CLI warning about skipping permissions'); }
    if (view.status !== 'running') break;
    if (screen && screen.slice(-300) !== shown.slice(-300)) process.stdout.write('.');
  }
  const session = view.roles[role].sessionId;
  console.log(`\nStatus: ${view.status}${view.reason ? ' — ' + view.reason : ''}`);
  console.log('Path: ' + view.path.map(entry => `${entry.title}:${entry.output}`).join(' → '));
  console.log('Proposal: ' + JSON.stringify(view.person?.proposal || null));
  console.log('Summary: ' + (view.person?.summary || ''));
  console.log('--- terminal (last lines) ---\n' + (await service.sessions.read(session, 45)).screen);
  if (view.status !== 'waiting-person') { failed = true; }
  else {
    const done = await service.flows.decide(run.id, 'accept');
    if (flowId === 'plugin-by-words') console.log('Installed plugin: ' + JSON.stringify(service.plugins.list().filter(item => item.origin === 'installed').map(item => ({ id: item.id, name: item.name, views: item.views.map(v => v.render), rights: item.permissions.changes }))));
    else { const page = (await service.devspace.read()).pages.at(-1); console.log(`Accepted → page «${page.title}», ${page.blocks.length} blocks, sources ${page.sourceIds.length}; first block: ${page.blocks[0]?.text.slice(0, 160)}`); }
    console.log(done.status === 'done' ? 'PASS: a real agent read the task, handed the step in with devspace, code checked the result, the person applied it' : 'FAIL: ' + done.status);
    failed = done.status !== 'done';
  }
} finally { await service.close(); }
process.exit(failed ? 1 : 0);
