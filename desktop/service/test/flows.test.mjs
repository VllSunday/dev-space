import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Flows are checked with a scripted agent in a real terminal: it receives the
// assignment line, reads the task with `devspace step task` and hands the step
// in with `devspace step done`, exactly like a CLI agent would.
process.env.DEVSPACE_STUB_AGENT = fileURLToPath(new URL('../../../checks/stub-agent.mjs', import.meta.url));
process.env.DEVSPACE_STUB_SCENARIO = fileURLToPath(new URL('../../../checks/fixtures/stub-scenario.mjs', import.meta.url));
const { createService } = await import('../server.mjs');
const { validateFlow } = await import('../flows/validate.mjs');
const { roles } = await import('../plugins/roles.mjs');
const fixture = async name => JSON.parse(await readFile(new URL(`../../../checks/fixtures/linear/${name}.json`, import.meta.url), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start(options = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'devspace-flows-'));
  const service = await createService({ repo, uiDir: repo, mcpOptions: { home: repo, env: {} }, ...options });
  let state = await service.devspace.read();
  state = await service.devspace.mutate({ action: 'import-template', templateId: 'wind-islands', baseRevision: state.revision });
  const project = state.projects.at(-1);
  // Waits until the run stops moving on its own: done, stopped, or waiting for a person.
  const settle = async (id, wanted, limit = 30000) => {
    for (const until = Date.now() + limit; Date.now() < until; await sleep(100)) { const run = service.flows.list().find(item => item.id === id); if (wanted ? wanted(run) : run.status !== 'running') return run; }
    const run = service.flows.list().find(item => item.id === id), session = Object.values(run.roles).find(role => role.sessionId);
    throw new Error(`Run is still ${run.status} at «${run.current}». Terminal:\n${session ? (await service.sessions.read(session.sessionId)).screen : '—'}`);
  };
  // The terminal as one line. With a pattern, waits for the agent to finish printing it.
  const screen = async (id, wanted) => {
    for (const until = Date.now() + 5000; ; await sleep(100)) { const text = (await service.sessions.read(id, 150)).screen.replace(/\n/g, ''); if (!wanted || wanted.test(text) || Date.now() > until) return text; }
  };
  return { repo, service, project, state, settle, screen };
}

test('a flow is checked before launch: outputs, reachability, bounded loops, declared roles', async () => {
  const { service } = await start();
  try {
    const blocks = service.flows.blocks(), check = flow => validateFlow(flow, { blocks, roles }).problems.map(problem => problem.text);
    const library = await service.flows.library();
    assert.deepEqual(library.map(item => [item.id, item.ok]), [['chat-handoff', true], ['flow-by-words', true], ['materials-to-page', true], ['plugin-by-words', true], ['task-review', true]]);
    const good = library.find(item => item.id === 'task-review').flow, edit = change => { const flow = structuredClone(good); change(flow); return check(flow); };
    assert.deepEqual(check(good), []);
    assert.match(edit(flow => { delete flow.steps.check.limit; })[0], /круг без предела: Работа → Проверка → Работа/);
    assert.match(edit(flow => { delete flow.limits.handoffs; })[0], /общий предел передач/);
    assert.match(edit(flow => { delete flow.steps.work.next.blocked; })[0], /выход «Не может продолжить» никуда не ведёт/);
    assert.match(edit(flow => { flow.steps.work.next.skip = 'me'; })[0], /нет выхода «skip»/);
    assert.match(edit(flow => { flow.steps.work.next.done = 'nowhere'; })[0], /шагу «nowhere», которого нет/);
    assert.match(edit(flow => { flow.steps.work.with.role = 'ghost'; })[0], /роль «ghost» не объявлена/);
    assert.match(edit(flow => { flow.steps.start.with.need = 'jira'; })[0], /подключение «jira» не объявлено/);
    assert.match(edit(flow => { flow.steps.work.with.model = 'opus'; })[0], /нет параметра «model»/);
    assert.match(edit(flow => { flow.steps.work.block = 'magic'; })[0], /блок «magic» не найден/);
    assert.match(edit(flow => { flow.steps.orphan = { block: 'person', next: { accept: '@done', return: '@done' } }; }).join(), /нельзя дойти от начала/);
    assert.match(edit(flow => { flow.steps.me.next = { accept: 'me', return: 'me' }; flow.steps.me.limit = { accept: 1, return: 1 }; flow.steps.close.next = { ok: 'close', failed: 'close' }; flow.steps.close.limit = { ok: 1, failed: 1 }; }).join(), /нельзя дойти до конца/);
    assert.match(edit(flow => { flow.steps.close.with = { command: 'rm -rf' }; })[0], /одно из: agent\.continue/);
    // A saved flow with problems is kept and shown, but it cannot be launched.
    const broken = structuredClone(good); broken.id = 'broken'; delete broken.steps.check.limit;
    const saved = await service.flows.save('broken', JSON.stringify(broken));
    assert.equal(saved.ok, false);
    await assert.rejects(service.flows.launch({ flowId: 'broken', projectId: 'x' }), /не запускается, пока в нём есть проблемы/);
    await assert.rejects(service.flows.save('other', JSON.stringify(broken)), /указан ID «broken»/);
  } finally { await service.close(); }
});

test('materials → page: the agent hands in by command, code checks the result, a person applies it', async () => {
  const { service, project, state, settle, screen } = await start();
  try {
    const sources = state.materials.filter(item => item.projectId === project.id).slice(0, 3);
    const run = await service.flows.launch({ flowId: 'materials-to-page', projectId: project.id, roles: { author: { agent: 'stub' } }, input: { things: sources.map(item => 'material:' + item.id) } });
    const waiting = await settle(run.id);
    assert.equal(waiting.status, 'waiting-person');
    assert.deepEqual(waiting.steps.map(step => [step.title, step.kind, step.state]), [['Вход', 'code', 'done'], ['Работа', 'agent', 'done'], ['Мне', 'person', 'current']]);
    assert.deepEqual(waiting.person.proposal, { kind: 'page', id: 'stub-page', title: 'Страница от агента-заглушки' });
    const terminal = await screen(waiting.roles.author.sessionId, /accepted: Шаг «Работа» принят/);
    assert.match(terminal, /refused: devspace: У шага «Работа» нет выхода «approve»\. Допустимые: done, blocked\./, 'an output the block does not have is refused');
    assert.match(terminal, /refused: devspace: Шаг не принят\. Укажи файл предложения/, 'a hand-in without the result is refused by code');
    assert.match(terminal, /accepted: Шаг «Работа» принят: дальше шаг «Мне»/);
    assert.equal((await service.devspace.read()).pages.length, state.pages.length, 'nothing is applied before the person decides');
    // The proposal lies on the board as a proposal until then.
    assert.ok((await service.devspace.proposals()).some(item => item.id === 'stub-page'));
    await assert.rejects(service.flows.decide(run.id, 'publish'), /нет такого решения/);
    const done = await service.flows.decide(run.id, 'accept');
    assert.equal(done.status, 'done');
    const after = await service.devspace.read(), page = after.pages.at(-1);
    assert.equal(page.title, 'Страница от агента-заглушки'); assert.deepEqual(page.sourceIds, sources.map(item => item.id));
    assert.deepEqual(after.materials, state.materials, 'source materials are untouched');
    // An agent cannot hand in a step it does not have, or use block-only commands.
    const token = service.agentApi.token(waiting.roles.author.sessionId);
    await assert.rejects(service.agentApi.handle(token, { words: ['step', 'done'], flags: { output: 'done' } }), /нет шага флоу/);
    await assert.rejects(service.agentApi.handle(token, { words: ['proposal', 'apply'], flags: { kind: 'page', id: 'stub-page' } }), /Команды «proposal\.apply» нет/);
    await assert.rejects(service.agentApi.handle('wrong-token', { words: ['help'] }), /не узнал/);
    assert.match(await service.agentApi.handle(token, { words: ['help'] }), /КОМАНДЫ[\s\S]*devspace step done[\s\S]*БЛОКИ ФЛОУ[\s\S]*Проверка фактов/);
  } finally { await service.close(); }
});

test('task → work → review → decision runs on built-in tasks and stops at the return limit', async () => {
  process.env.DEVSPACE_STUB_MODE = 'strict-reviewer';
  const { service, project, settle, screen } = await start();
  try {
    const launch = () => service.flows.launch({ flowId: 'task-review', projectId: project.id, roles: { author: { agent: 'stub' }, reviewer: { agent: 'stub' } }, needs: { tracker: 'tasks-local' }, space: { name: 'Разбор задач' } });
    await assert.rejects(service.flows.launch({ flowId: 'task-review', projectId: project.id, roles: { author: { agent: 'stub' }, reviewer: { agent: 'stub' } } }), /кто играет роль «Трекер задач»/);
    await assert.rejects(service.flows.launch({ flowId: 'task-review', projectId: project.id, roles: { author: { agent: 'stub' } }, needs: { tracker: 'tasks-local' } }), /агента для роли «Проверяющий»/);
    const run = await launch(), stuck = await settle(run.id);
    // The reviewer never accepts; the flow does not spin: after two returns it calls a person.
    assert.equal(stuck.status, 'needs-person');
    assert.match(stuck.reason, /Сработал предел возвратов: «Проверка → Работа» не больше 2 раз/);
    assert.deepEqual(stuck.path.map(entry => `${entry.title}:${entry.output}`), ['Вход:taken', 'В работу:ok', 'Работа:done', 'Проверка:remarks', 'Работа:done', 'Проверка:remarks', 'Работа:done', 'Проверка:remarks']);
    const taken = stuck.item.ref.slice(5), tasks = async () => (await service.devspace.read()).tasks;
    assert.equal((await tasks()).find(task => task.id === taken).status, 'working', 'code moved the task to «in progress»');
    assert.match(await screen(stuck.roles.author.sessionId, /got remarks/), /got remarks: Замечание 1: нет проверки пустого ввода\./, 'the reviewer\'s remarks reach the one who did the work');
    assert.notEqual(stuck.roles.author.sessionId, stuck.roles.reviewer.sessionId);
    assert.equal(stuck.spaceId, service.sessions && (await fetchSettings(service)).agentSpaces.find(space => space.name === 'Разбор задач').id, 'the flow was deployed into its own space');
    // A second run takes the next task, not the one already in work.
    const second = await launch();
    assert.notEqual((await settle(second.id, run_ => run_.item)).item.ref, stuck.item.ref);
    await service.flows.resolve(second.id, 'stop');
    // The person allows one more lap. The reviewer refuses again, and the limit holds again.
    const again = await service.flows.resolve(run.id, 'continue');
    assert.equal(again.status, 'running');
    const stuckAgain = await settle(run.id);
    assert.equal(stuckAgain.status, 'needs-person', 'the same reviewer still refuses and the limit holds');
    const stopped = await service.flows.resolve(run.id, 'stop');
    assert.equal(stopped.status, 'stopped');
    assert.equal((await tasks()).find(task => task.id === taken).status, 'working');
  } finally { process.env.DEVSPACE_STUB_MODE = ''; await service.close(); }
});
const fetchSettings = async service => (await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: 'Bearer ' + service.token } })).json()).settings;

test('the same flow works with Linear, and text from the tracker reaches the agent as data', async () => {
  process.env.DEVSPACE_STUB_MODE = 'obedient-to-data';
  const issues = await fixture('issues'), states = await fixture('states'), updated = await fixture('issue-update'), calls = [];
  const pluginFetch = async (url, options) => { const body = JSON.parse(options.body); calls.push(body); return { ok: true, status: 200, text: async () => JSON.stringify(body.query.includes('issueUpdate') ? updated : body.query.includes('workflowStates') ? states : issues) }; };
  const { service, project, settle, screen } = await start({ pluginFetch });
  try {
    await service.plugins.install((await service.plugins.inspect('catalog:linear')).ticket);
    await service.operations.configure('linear-issues', { settings: { team: 'ENG' }, secret: 'lin_api_key' });
    const run = await service.flows.launch({ flowId: 'task-review', projectId: project.id, roles: { author: { agent: 'stub' }, reviewer: { agent: 'stub' } }, needs: { tracker: 'linear-issues' } });
    const waiting = await settle(run.id);
    assert.equal(waiting.status, 'waiting-person');
    assert.equal(waiting.item.key, 'ENG-14', 'the first task nobody started');
    assert.equal(waiting.needs.tracker.title, 'Задачи Linear');
    assert.deepEqual(calls.filter(call => call.query.includes('issueUpdate')).map(call => call.variables.stateId), ['st-progress']);
    // ENG-14 carries an instruction in its description. It arrives inside the data
    // block, after the assignment, and the flow goes on as the flow file says.
    const terminal = await screen(waiting.roles.author.sessionId, /data position/);
    assert.match(terminal, /data position: inside data block/);
    assert.deepEqual(waiting.path.map(entry => `${entry.title}:${entry.output}`), ['Вход:taken', 'В работу:ok', 'Работа:done', 'Проверка:remarks', 'Работа:done', 'Проверка:clean']);
    assert.ok(!calls.some(call => call.variables.id === issues.data.issues.nodes[0].id), 'the status of another task was not touched');
    const done = await service.flows.decide(run.id, 'accept', 'Принято.');
    assert.equal(done.status, 'done');
    assert.deepEqual(calls.filter(call => call.query.includes('issueUpdate')).map(call => call.variables.stateId), ['st-progress', 'st-done']);
    assert.ok(!JSON.stringify(service.flows.list()).includes('lin_api_key') && !(await screen(waiting.roles.author.sessionId)).includes('lin_api_key'), 'the key reaches neither the run nor the agent');
  } finally { process.env.DEVSPACE_STUB_MODE = ''; await service.close(); }
});

test('a plugin made by words is checked by code, shown with its rights and installed on accept', async () => {
  const { service, project, state, settle, screen } = await start();
  try {
    const board = state.boards.find(item => item.projectId === project.id), zone = board.zones.find(item => item.source.kind === 'tasks');
    const run = await service.flows.launch({ flowId: 'plugin-by-words', projectId: project.id, roles: { builder: { agent: 'stub' } }, input: { text: 'Покажи задачи зоны доской и сверху число готовых', boardId: board.id, zoneId: zone.id } });
    const waiting = await settle(run.id);
    assert.equal(waiting.status, 'waiting-person');
    assert.match(await screen(waiting.roles.builder.sessionId, /Плагин пуст/), /refused: devspace: Шаг не принят\. Плагин пуст/, 'an invalid manifest is refused before a person sees it');
    const draft = (await service.plugins.drafts())[0];
    assert.equal(draft.plugin.name, 'Доска задач'); assert.equal(draft.sample.things.length, 3);
    assert.match(draft.request, /Покажи задачи зоны доской/);
    assert.deepEqual(draft.plugin.permissions.changes, ['менять статус задачи']); assert.deepEqual(draft.plugin.permissions.network, []); assert.equal(draft.plugin.permissions.code, false);
    assert.ok(!service.plugins.get('task-board'));
    await service.flows.decide(run.id, 'accept');
    assert.equal(service.plugins.get('task-board').origin, 'installed');
    assert.equal((await service.devspace.read()).boards.find(item => item.id === board.id).zones.find(item => item.id === zone.id).view, 'task-board/board', 'the zone it was asked for shows the new view');
    assert.equal((await service.plugins.drafts()).length, 0);
  } finally { await service.close(); }
});

test('the long-chat hand-off is a flow: note, check by code, a new chat in the same space', async () => {
  const { service, project, repo } = await start();
  try {
    const headers = { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' };
    const old = await (await fetch(service.origin + '/api/sessions', { method: 'POST', headers, body: JSON.stringify({ agent: 'stub', name: 'Dream Game Combat', cwd: project.path }) })).json();
    await sleep(400);
    const started = await (await fetch(`${service.origin}/api/sessions/${old.id}/handoff`, { method: 'POST', headers, body: '{}' })).json();
    assert.equal(started.status, 'summarizing');
    let job;
    for (const until = Date.now() + 20000; Date.now() < until; await sleep(100)) { job = (await (await fetch(`${service.origin}/api/sessions/${old.id}/stats`, { headers })).json()).handoff; if (job.status === 'done' || job.status === 'failed') break; }
    assert.equal(job.status, 'done', job.error);
    assert.equal(job.file, path.join(repo, 'inbox', 'handoffs', 'stub-handoff.md'));
    const next = service.sessions.get(job.sessionId), settings = await fetchSettings(service);
    assert.equal(next.name, 'Dream Game Combat · continued'); assert.equal(next.cwd, old.cwd); assert.equal(next.agent, 'stub');
    assert.equal(settings.agentSessionSpaces[next.id], settings.agentSessionSpaces[old.id], 'the new chat stays in the source space');
    assert.deepEqual(service.flows.list()[0].path.map(entry => entry.output), ['taken', 'done', 'ok']);
  } finally { await service.close(); }
});

test('an agent that leaves without handing in stops the flow and calls a person', async () => {
  process.env.DEVSPACE_STUB_MODE = 'silent';
  const { service, project, state, settle } = await start();
  try {
    const run = await service.flows.launch({ flowId: 'materials-to-page', projectId: project.id, roles: { author: { agent: 'stub' } }, input: { things: ['material:' + state.materials.at(-1).id] } });
    const waiting = await settle(run.id, item => item.roles.author.sessionId && item.current === 'write');
    await sleep(300);
    await service.sessions.remove(waiting.roles.author.sessionId);
    const stuck = await settle(run.id);
    assert.equal(stuck.status, 'needs-person'); assert.match(stuck.reason, /закрылся, а шаг «Работа» не сдан/);
    // Runs survive a restart of the service as files.
    assert.equal((await readdir(path.join(path.dirname(service.agentApi.bin), 'flow-runs'))).length, 1);
  } finally { process.env.DEVSPACE_STUB_MODE = ''; await service.close(); }
});
