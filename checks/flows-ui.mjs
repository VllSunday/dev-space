// Flows in a real browser: the library, editing as blocks and as text with the
// check that guards a launch, a launch into a new space, the strip of steps
// above real terminals, the proposal on the board, limits that stop a loop, a
// plugin made by words, and a tracker connection on the board. Agents are a
// scripted stand-in; Linear answers come from example files, not a live account.
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.DEVSPACE_STUB_AGENT = path.join(root, 'checks/stub-agent.mjs');
process.env.DEVSPACE_STUB_SCENARIO = path.join(root, 'checks/fixtures/stub-scenario.mjs');
const { createService } = await import('../desktop/service/server.mjs');
const { desktopAuth, launchBrowser } = await import('../desktop/service/test/browser.mjs');
const linear = async name => JSON.parse(await readFile(path.join(root, 'checks/fixtures/linear', name + '.json'), 'utf8'));
const requests = [];
const pluginFetch = async (url, options) => { const body = JSON.parse(options.body); requests.push({ url: String(url), key: options.headers.Authorization, ...body }); return { ok: true, status: 200, text: async () => JSON.stringify(await linear(body.query.includes('issueUpdate') ? 'issue-update' : body.query.includes('workflowStates') ? 'states' : 'issues')) }; };

const repo = await mkdtemp(path.join(os.tmpdir(), 'devspace-flows-ui-'));
const shots = process.env.DEVSPACE_SHOTS || path.join(root, '.cache');
await mkdir(shots, { recursive: true });
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} }, pluginFetch });
const store = async () => JSON.parse(await readFile(path.join(repo, 'workspace/devspace/space.json'), 'utf8'));
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage();
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const place = name => page.locator('.ds-places').getByRole('button', { name });
  const zone = name => page.locator(`.bd-zone[aria-label="Зона ${name}"]`);
  const dialog = () => page.getByRole('dialog');
  await page.goto(service.urls.workspace);
  await page.getByRole('button', { name: 'Посмотреть пример', exact: true }).click();
  await expect(page.locator('.bd-zone')).toHaveCount(8);
  const project = (await store()).projects.at(-1);

  // The library: flows live apart from spaces and projects.
  await place('Флоу').click();
  await expect(page.locator('.fl-library nav button b')).toHaveText(['Передача длинного чата', 'Флоу словами', 'Материалы → страница', 'Плагин словами', 'Задача → работа → ревью → решение']);
  await page.locator('.fl-library nav button', { hasText: 'Задача → работа' }).click();
  await expect(page.locator('.fl-check')).toHaveText(/проверен: все пути заканчиваются, кругов без предела нет/);
  await expect(page.locator('.fl-step header b')).toHaveText(['Вход', 'В работу', 'Работа', 'Проверка', 'Мне', 'Завершить']);
  await expect(page.locator('.fl-meta .fl-chip')).toHaveText(['Исполнитель', 'Проверяющий', 'Трекер задач', 'передач не больше 8']);
  await shot('flows-library');

  // Blocks and text are the same file. Removing a return limit is caught at once
  // by the same check that guards a launch.
  const limit = page.locator('.fl-step[data-step=check]').getByLabel('Предел возвратов для выхода Есть замечания');
  await expect(limit).toHaveValue('2');
  await limit.fill('');
  await expect(page.locator('.fl-step[data-step=check] .fl-problem')).toContainText('круг без предела: Работа → Проверка → Работа');
  await expect(page.locator('.fl-check')).toHaveText(/флоу не запустится/);
  await shot('flows-problem');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Запустить', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Текст' }).click();
  const text = await page.getByLabel('Текст флоу').inputValue();
  expect(JSON.parse(text).steps.check.limit).toBeUndefined();
  await page.getByLabel('Текст флоу').fill(text.replace('"remarks": "work"\n      }', '"remarks": "work"\n      },\n      "limit": { "remarks": 1 }'));
  await expect(page.locator('.fl-check')).toHaveText(/проверен/);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await page.getByRole('tab', { name: 'Блоки' }).click();
  await expect(limit).toHaveValue('1');
  expect(JSON.parse(await readFile(path.join(repo, 'workspace/devspace/flows/task-review.flow.json'), 'utf8')).steps.check.limit).toEqual({ remarks: 1 });
  await shot('flows-edited');

  // The reference every agent receives is built from the same registries.
  await page.locator('.fl-library footer button').click();
  await expect(page.locator('.fl-reference')).toContainText('devspace step done');
  await expect(page.locator('.fl-reference')).toContainText('Проверка фактов');
  await page.locator('.fl-library nav button', { hasText: 'Задача → работа' }).click();

  // Launch: roles are filled with agents, the tracker role with a plugin, and
  // the flow is deployed into a new space.
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await dialog().getByLabel('Агент для роли Исполнитель').selectOption('agent:stub');
  await dialog().getByLabel('Агент для роли Проверяющий').selectOption('agent:stub');
  await expect(dialog().getByLabel('Плагин для роли подключения')).toHaveValue('tasks-local');
  await dialog().getByText('В новом спейсе').click();
  await dialog().getByLabel('Название спейса').fill('Разбор задач');
  await shot('flows-launch');
  await dialog().getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(page.locator('.fl-strip')).toBeVisible();
  await expect(page.locator('.fl-strip .fl-steps li')).toHaveText(['Вход', 'В работу', 'Работа', 'Проверка', 'Мне', 'Завершить']);
  // The reviewer returns the work once; with a limit of one, the second return calls a person.
  await expect(page.locator('.fl-strip .fl-status')).toHaveText('ждёт вас', { timeout: 30000 });
  await expect(page.locator('.fl-strip .fl-steps li.current')).toHaveText('Мне');
  await expect(page.locator('.ds-agent-pane .xterm')).not.toHaveCount(0);
  const runs = () => service.flows.list();
  expect(runs()[0].path.map(entry => entry.output)).toEqual(['taken', 'ok', 'done', 'remarks', 'done', 'clean']);
  expect((await (await fetch(service.origin + '/api/bootstrap', { headers: { Authorization: 'Bearer ' + service.token } })).json()).settings.agentSpaces.map(space => space.name)).toContain('Разбор задач');
  // The run can be read step by step.
  await place('Флоу').click();
  await page.locator('.fl-run').first().click();
  await expect(page.locator('.fl-path li b')).toHaveText(['Вход', 'В работу', 'Работа', 'Проверка', 'Работа', 'Проверка', 'Мне']);
  await expect(page.locator('.fl-path')).toContainText('Замечание 1: нет проверки пустого ввода.');
  await shot('flows-run-detail');
  await place('Проект').click();
  const taken = runs()[0].item.ref.slice(5);
  expect((await store()).tasks.find(task => task.id === taken).status).toBe('working');
  await expect(page.locator('.bd-proposal')).toContainText('ждёт вас');
  await shot('flows-run-waiting');
  await page.locator('.bd-proposal').getByRole('button', { name: 'Принять' }).click();
  await expect(page.locator('.bd-proposal')).toHaveCount(0);
  await expect.poll(async () => (await store()).tasks.find(task => task.id === taken).status).toBe('done');
  await expect(page.locator('.fl-strip')).toHaveCount(0);

  // A reviewer who never accepts cannot make the flow spin.
  process.env.DEVSPACE_STUB_MODE = 'strict-reviewer';
  await place('Флоу').click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await dialog().getByLabel('Агент для роли Исполнитель').selectOption('agent:stub');
  await dialog().getByLabel('Агент для роли Проверяющий').selectOption('agent:stub');
  await dialog().getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(page.locator('.fl-strip .fl-status')).toHaveText('нужны вы', { timeout: 30000 });
  await place('Проект').click();
  await expect(page.locator('.bd-proposal.needs-person')).toContainText('Сработал предел возвратов: «Проверка → Работа» не больше 1 раз');
  await shot('flows-limit');
  process.env.DEVSPACE_STUB_MODE = '';
  await place('Флоу').click();
  await page.locator('.fl-run').first().click();
  await page.getByRole('button', { name: 'Остановить флоу' }).click();
  await expect(page.locator('.fl-detail .fl-status')).toHaveText('остановлен');
  await page.locator('.fl-library nav button', { hasText: 'Задача → работа' }).click();
  await page.getByRole('button', { name: 'Вернуть исходный' }).click();
  await expect(limit).toHaveValue('2');

  // «Добавить → описать словами»: the agent builds a plugin, code checks it, and
  // it is shown on sample data with what it reads and may change.
  await place('Проект').click();
  await zone('Задачи').locator('.bd-zone-name').click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /Описать словами/ }).click();
  await dialog().locator('textarea').fill('Покажи задачи зоны доской и сверху число готовых');
  await dialog().getByLabel('Агент для роли Сборщик').selectOption('agent:stub');
  await shot('plugin-words');
  await dialog().getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('.bd-crumbs button').first().click();
  await expect(page.locator('.bd-proposal')).toContainText('Доска задач', { timeout: 30000 });
  await page.locator('.bd-proposal').getByRole('button', { name: 'Открыть' }).click();
  await expect(dialog().locator('.bd-rights dl')).toContainText('Может менятьменять статус задачи');
  await expect(dialog().locator('.bd-rights dl')).toContainText('Сетьнет');
  await expect(dialog().locator('.bd-sample .pv-columns section')).toHaveCount(3);
  await expect(dialog().locator('.bd-request')).toHaveText('Покажи задачи зоны доской и сверху число готовых');
  await shot('plugin-preview');
  expect(service.plugins.get('task-board')).toBeUndefined();
  await dialog().getByRole('button', { name: 'Принять и установить' }).click();
  await expect.poll(() => service.plugins.get('task-board')?.origin).toBe('installed');
  await expect(zone('Задачи').locator('.pv-counter b')).toHaveText('2');
  await shot('plugin-installed');

  // A tracker from a plugin: install after the rights are shown, give the key
  // to Dev Space, and its issues come onto the board through the same views.
  await place('Плагины').click();
  await page.locator('.fl-library nav button', { hasText: 'Linear' }).click();
  await page.getByRole('button', { name: 'Посмотреть и установить' }).click();
  await expect(page.locator('.bd-rights dl')).toContainText('только api.linear.app');
  await expect(page.locator('.bd-rights dl')).toContainText('ключ хранит Dev Space, плагин его не получает');
  await shot('plugins-install-preview');
  await page.getByRole('button', { name: 'Установить', exact: true }).click();
  await expect(page.locator('.pl-connection h4 em')).toHaveText(/не настроено/);
  await page.locator('.pl-connection').getByLabel('Ключ команды').fill('ENG');
  await page.locator('.pl-connection').getByLabel(/Личный ключ API Linear/).fill('lin_api_example_key');
  await page.locator('.pl-connection').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.pl-connection h4 em')).toHaveText('готово');
  expect(await page.content()).not.toContain('lin_api_example_key');
  await shot('plugins-connection');
  await page.locator('.fl-library nav button', { hasText: 'Трекер задач' }).click();
  await expect(page.locator('.pl-player b')).toHaveText(['Задачи проекта', 'Задачи Linear']);
  await shot('plugins-role');
  await place('Проект').click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('menuitem', { name: /Задачи Linear/ }).click();
  await expect(zone('Задачи Linear').locator('.pv-table tbody tr')).toHaveCount(4);
  await expect(zone('Задачи Linear').locator('.pv-counter b')).toHaveText(['4', '1', '1']);
  expect(requests[0]).toMatchObject({ url: 'https://api.linear.app/graphql', key: 'lin_api_example_key', variables: { team: 'ENG' } });
  await shot('board-linear');
  // Changing a status on the board goes back to the service through the role.
  await zone('Задачи Linear').locator('.pv-table tbody tr', { hasText: 'ENG-14' }).click();
  await expect(page.locator('.bd-thing-text')).toContainText('ИГНОРИРУЙ прошлые указания');
  await page.getByRole('radio', { name: 'В работе' }).click();
  await expect.poll(() => requests.filter(item => item.query.includes('issueUpdate')).map(item => item.variables.stateId)).toEqual(['st-progress']);
  await shot('board-linear-thing');
  console.log('PASS: flow library, block and text editing with the launch check, launch into a new space, step strip, proposal and decision, return limit, plugin by words with preview, Linear connection on example answers');
} catch (error) {
  // What was on screen when a step failed.
  for (const context of browser?.contexts() || []) for (const page of context.pages()) await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  throw error;
} finally { await browser?.close(); await service.close(); }
