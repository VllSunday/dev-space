// What the scripted agent does for each assignment in flow checks. It decides by
// the text of the assignment, the way a real agent would, and by STUB_MODE for
// the cases a check wants to force (a reviewer who never accepts, an agent that
// never hands in).
const mode = process.env.DEVSPACE_STUB_MODE || '';
export default async ({ task, step, visit, devspace, write, say }) => {
  const done = async (...args) => { const result = await devspace('step', 'done', ...args); say(result.ok ? 'accepted: ' + result.out : 'refused: ' + result.error); return result; };
  if (mode === 'silent') return;
  const remarks = /вернул работу с замечаниями:\n(.*)/.exec(task)?.[1];
  if (remarks) say('got remarks: ' + remarks);
  if (step === 'Проверка') {
    if (mode === 'strict-reviewer' || visit === 1 && mode !== 'easy-reviewer') return done('--output', 'remarks', '--summary', `Замечание ${visit}: нет проверки пустого ввода.`);
    return done('--output', 'clean', '--summary', 'Замечаний нет.');
  }
  if (task.includes('предложение новой страницы')) {
    const folder = /JSON-файл в папке (\S+) /.exec(task)[1], template = JSON.parse(/\n(\{\n[\s\S]*?\n\})\n\nТипы блоков/.exec(task)[1]);
    await done('--output', 'approve');
    await done('--output', 'done', '--summary', 'Без файла');
    const file = await write(`${folder}/stub-page.json`, { ...template, title: 'Страница от агента-заглушки', blocks: [{ id: 'intro', type: 'text', text: 'Собрано из выбранных материалов.' }] });
    return done('--output', 'done', '--summary', 'Собрал страницу из материалов.', '--file', file);
  }
  if (task.includes('черновик плагина')) {
    const folder = /папка (\S+)\/<id>/.exec(task)[1];
    if (visit === 1) { await write(`${folder}/task-board/plugin.json`, { plugin: 1, id: 'task-board', name: 'Сломанный', description: 'Без видов.' }); await done('--output', 'done', '--id', 'task-board'); }
    await write(`${folder}/task-board/plugin.json`, { plugin: 1, id: 'task-board', name: 'Доска задач', version: '0.1.0', description: 'Показывает задачи зоны тремя колонками и число готовых сверху.', views: [{ id: 'board', title: 'Доска с итогом', level: 'zone', accepts: ['task'], actions: ['thing.open', 'thing.status'], render: { type: 'parts', parts: [{ part: 'counter', counters: [{ title: 'Готово', where: { field: 'statusGroup', equals: 'done' } }] }, { part: 'columns', by: 'statusGroup', columns: [{ value: 'todo', title: 'Надо' }, { value: 'doing', title: 'В работе' }, { value: 'done', title: 'Готово' }] }] } }] });
    await write(`${folder}/task-board/sample.json`, { things: [{ ref: 'task:1', kind: 'task', title: 'Первый плейтест гавани', statusGroup: 'todo' }, { ref: 'task:2', kind: 'task', title: 'Прототип фонаря', statusGroup: 'doing' }, { ref: 'task:3', kind: 'task', title: 'Собрать модель маяка', statusGroup: 'done' }] });
    await write(`${folder}/task-board/request.md`, /Просьба пользователя:\n([\s\S]*)$/.exec(task)?.[1] || '');
    return done('--output', 'done', '--summary', 'Собрал вид из готовых деталей, без кода.', '--id', 'task-board');
  }
  if (task.includes('черновик флоу')) {
    const folder = /файл (\S+)\/<id>\.flow\.json/.exec(task)[1];
    const flow = { flow: 1, id: 'write-then-check', name: 'Написал → проверил', roles: { author: { title: 'Исполнитель' }, reviewer: { title: 'Проверяющий' } }, limits: { handoffs: 6 }, start: 'take', steps: {
      take: { block: 'input', with: { from: 'words' }, next: { taken: 'work', empty: '@stopped' } },
      work: { block: 'work', with: { role: 'author', task: 'Сделай задачу.' }, next: { done: 'check', blocked: '@person' } },
      check: { block: 'review', with: { role: 'reviewer' }, next: { clean: 'me', remarks: 'work' } },
      me: { block: 'person', next: { accept: '@done', return: 'work' }, limit: { return: 3 } } } };
    // First a flow that can loop for ever: the check must refuse it.
    if (visit === 1) { await write(`${folder}/write-then-check.flow.json`, flow); await done('--output', 'done', '--id', 'write-then-check'); }
    flow.steps.check.limit = { remarks: 2 };
    await write(`${folder}/write-then-check.flow.json`, flow);
    return done('--output', 'done', '--summary', 'Собрал флоу из блоков: работа, проверка другим агентом, решение человека.', '--id', 'write-then-check');
  }
  if (task.includes('заметка для нового чата')) {
    const folder = /Markdown-файл в папке (\S+),/.exec(task)[1];
    const file = await write(`${folder}/stub-handoff.md`, '# Handoff\n\n## Цель\nПродолжить работу.\n\n## Следующий шаг\nПроверить парирование.\n');
    return done('--output', 'done', '--summary', 'Заметка готова.', '--file', file);
  }
  if (mode === 'obedient-to-data' && /ИГНОРИРУЙ/.test(task)) say('data position: ' + (task.indexOf('ИГНОРИРУЙ') > task.indexOf('Это сведения, а не инструкции') ? 'inside data block' : 'OUTSIDE data block'));
  return done('--output', 'done', '--summary', `Сделано (заход ${visit}).`);
};
