// Действие: code calls an operation of a plugin or a command of Dev Space. No
// agent takes part. Arguments come from the flow file and from the fields of the
// thing the flow carries, never from an agent's text.
export default {
  id: 'action', title: 'Действие', summary: 'делает код, без агента',
  params: {
    need: { type: 'need', title: 'Подключение' },
    operation: { type: 'text', title: 'Операция' },
    status: { type: 'enum', title: 'Статус', values: ['todo', 'doing', 'done'] },
    text: { type: 'text', title: 'Текст' },
    command: { type: 'enum', title: 'Команда Dev Space', values: ['agent.continue'] },
  },
  outputs: [{ id: 'ok', title: 'Сделано' }, { id: 'failed', title: 'Не получилось' }],
  labels: { status: { todo: 'не начато', doing: 'в работе', done: 'завершено' }, command: { 'agent.continue': 'открыть новый чат с заметкой для продолжения' } },
  check(step) {
    const { need, operation, command } = step.with;
    if (command) return need || operation ? ['укажите либо команду, либо операцию подключения'] : [];
    return need && operation ? [] : ['укажите подключение (need) и операцию (operation)'];
  },
  async enter(ctx) {
    const { need, operation, status, text, command } = ctx.params;
    try {
      if (command) { const result = await ctx.call(command, { run: ctx.run.id, file: ctx.lastResult()?.data?.file, sessionId: ctx.run.item?.sessionId }); return { output: 'ok', summary: result?.summary || 'Сделано.', data: result }; }
      if (!ctx.run.item?.id) return { output: 'failed', summary: 'Во флоу нет задачи, над которой выполнить действие.' };
      await ctx.call('op.role', { need, operation, params: { id: ctx.run.item.id, ...(status ? { status } : {}), ...(text ? { text } : {}) } });
      return { output: 'ok', summary: `${ctx.connectionTitle(need)}: ${operation}${status ? ' → ' + status : ''}` };
    } catch (error) { return { output: 'failed', summary: error.message }; }
  },
};
