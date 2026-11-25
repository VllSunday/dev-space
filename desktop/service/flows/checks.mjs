// What code can check exactly. A work step uses a check to accept or refuse a
// hand-in on the spot; the «Проверка фактов» block runs one as a step of its own.
// Each check says what the agent must hand in and verifies it through a command.
const checks = {
  'page-proposal': {
    title: 'предложение страницы проходит проверку формата',
    hint: async ctx => `Результат — предложение новой страницы: JSON-файл в папке ${ctx.paths.proposals} (имя файла — латиницей, с расширением .json). Исходные материалы и хранилище не меняй. Сдавая шаг, укажи файл: --file <путь к файлу>.\n\nЗаготовка предложения для этого запуска (поля projectId, baseRevision и sourceIds оставь как есть):\n${JSON.stringify(await ctx.call('proposal.template', {}), null, 2)}\n\nТипы блоков и правила: devspace help page-proposal`,
    async run(ctx, signal) {
      if (!signal.file) return { ok: false, reason: 'Укажи файл предложения: --file <путь к JSON в папке proposals>.' };
      const proposal = await ctx.call('proposal.check', { kind: 'page', file: signal.file, project: ctx.run.projectId });
      return { ok: true, summary: `Предложение страницы «${proposal.title}»`, data: { proposal: { kind: 'page', id: proposal.id, title: proposal.title } } };
    },
  },
  'plugin-draft': {
    title: 'черновик плагина корректен и содержит пример данных',
    hint: ctx => `Результат — черновик плагина: папка ${ctx.paths.pluginDrafts}/<id> с файлами plugin.json, sample.json (пример данных) и request.md (исходная просьба дословно). Формат и готовые детали: devspace help plugin. Сдавая шаг, укажи ID: --id <id папки>.`,
    async run(ctx, signal) {
      if (!signal.id) return { ok: false, reason: 'Укажи ID черновика: --id <имя папки плагина>.' };
      const plugin = await ctx.call('proposal.check', { kind: 'plugin', id: signal.id });
      return { ok: true, summary: `Черновик плагина «${plugin.name}»`, data: { proposal: { kind: 'plugin', id: plugin.id, title: plugin.name } } };
    },
  },
  'flow-draft': {
    title: 'черновик флоу проходит проверку: пути заканчиваются, круги ограничены',
    hint: ctx => `Результат — черновик флоу: файл ${ctx.paths.flowDrafts}/<id>.flow.json. Формат и список блоков: devspace help flow. Сдавая шаг, укажи ID: --id <id флоу>.`,
    async run(ctx, signal) {
      if (!signal.id) return { ok: false, reason: 'Укажи ID черновика: --id <id флоу>.' };
      const flow = await ctx.call('proposal.check', { kind: 'flow', id: signal.id });
      return { ok: true, summary: `Черновик флоу «${flow.name}»`, data: { proposal: { kind: 'flow', id: flow.id, title: flow.name } } };
    },
  },
  'handoff-note': {
    title: 'заметка для продолжения записана и начинается с «# Handoff»',
    hint: ctx => `Результат — заметка для нового чата: Markdown-файл в папке ${ctx.paths.handoffs}, который начинается с заголовка «# Handoff». Других файлов не меняй и команд проекта не запускай. Сдавая шаг, укажи файл: --file <путь к файлу>.`,
    async run(ctx, signal) {
      if (!signal.file) return { ok: false, reason: 'Укажи файл заметки: --file <путь>.' };
      const note = await ctx.call('file.check', { file: signal.file, inside: 'handoffs', starts: '# Handoff' });
      return { ok: true, summary: 'Заметка для продолжения записана.', data: { file: note.file } };
    },
  },
  file: {
    title: 'файл результата существует и не пуст',
    hint: () => 'Сдавая шаг, укажи файл результата: --file <путь к файлу>.',
    async run(ctx, signal) {
      if (!signal.file) return { ok: false, reason: 'Укажи файл результата: --file <путь>.' };
      const found = await ctx.call('file.check', { file: signal.file, inside: 'project', project: ctx.run.projectId });
      return { ok: true, summary: signal.summary || `Файл ${found.name} на месте.`, data: { file: found.file } };
    },
  },
};
export const checkNames = Object.keys(checks);
export const checkTitles = Object.fromEntries(Object.entries(checks).map(([name, check]) => [name, check.title]));
export const checkHint = (name, ctx) => checks[name]?.hint(ctx) || '';
export async function runCheck(name, ctx, signal) {
  const check = checks[name];
  if (!check) return { ok: false, reason: `Проверка «${name}» неизвестна.` };
  try { return await check.run(ctx, signal); }
  catch (error) { return { ok: false, reason: error.message }; }
}
