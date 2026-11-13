// Вход: with what the work starts. It takes a thing and puts it on the run, so
// every later step can see it.
export default {
  id: 'input', title: 'Вход', summary: 'с чего начинается работа',
  params: {
    from: { type: 'enum', title: 'Берём', required: true, values: ['selection', 'words', 'tracker', 'chat'] },
    need: { type: 'need', title: 'Трекер задач' },
  },
  outputs: [{ id: 'taken', title: 'Взяли' }, { id: 'empty', title: 'Брать нечего' }],
  labels: { from: { selection: 'выбранные карточки на доске', words: 'задачу словами', tracker: 'следующую задачу из трекера', chat: 'текущий чат агента' } },
  check(step) { return step.with.from === 'tracker' && !step.with.need ? ['для задач из трекера укажите подключение: need'] : []; },
  async enter(ctx) {
    const { from, need } = ctx.params, input = ctx.run.input;
    if (from === 'selection') {
      const things = await ctx.call('board.things', { refs: input.things || [] });
      if (!things.length) return { output: 'empty', summary: 'На доске ничего не выбрано.' };
      ctx.run.item = { kind: 'things', title: things.length === 1 ? things[0].title : `${things.length} карточки`, things };
      return { output: 'taken', summary: things.map(thing => thing.title).join(', ') };
    }
    if (from === 'words') {
      if (!input.text?.trim()) return { output: 'empty', summary: 'Задача не описана.' };
      ctx.run.item = { kind: 'words', title: input.text.trim().split('\n')[0].slice(0, 80), text: input.text.trim() };
      return { output: 'taken', summary: ctx.run.item.title };
    }
    if (from === 'chat') {
      if (!input.sessionId) return { output: 'empty', summary: 'Чат не выбран.' };
      ctx.run.item = { kind: 'chat', title: input.title || 'Чат', sessionId: input.sessionId };
      return { output: 'taken', summary: ctx.run.item.title };
    }
    // The next task nobody has started and no other run has taken.
    const { items } = await ctx.call('op.role', { need, operation: 'list' });
    const taken = await ctx.call('flow.taken', {});
    const next = input.itemId ? items.find(item => item.id === input.itemId) : items.find(item => item.statusGroup === 'todo' && !taken.includes(item.ref));
    if (!next) return { output: 'empty', summary: 'В трекере нет задач, которые никто не начал.' };
    ctx.run.item = { kind: 'task', ...next };
    return { output: 'taken', summary: [next.key, next.title].filter(Boolean).join(' ') };
  },
};
