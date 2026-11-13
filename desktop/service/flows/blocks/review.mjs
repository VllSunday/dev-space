// Проверка: another agent compares the result with the assignment. It may only
// say «clean» or «remarks»; remarks travel back to whoever did the work.
export default {
  id: 'review', title: 'Проверка', summary: 'другой агент сверяет результат', agent: true,
  params: {
    role: { type: 'role', title: 'Кто', required: true },
    task: { type: 'text', title: 'Что проверить' },
  },
  outputs: [{ id: 'clean', title: 'Чисто', hint: 'замечаний, из-за которых нельзя принять работу, нет' }, { id: 'remarks', title: 'Есть замечания', hint: 'перечисли их в --summary; мелочи не возвращай, запиши как допущения' }],
  async enter(ctx) {
    const work = ctx.lastResult(), lines = [
      ctx.params.task || 'Проверь результат прошлого шага: соответствует ли он заданию и данным. Сам ничего не исправляй.',
      '', 'Возвращай работу только из-за того, что мешает её принять. Мелкие замечания перечисли в --summary и выбери выход clean.',
    ];
    if (work) lines.push('', `Результат шага «${ctx.title(work.step)}»: ${work.summary || 'без описания'}`, ...(work.data?.file ? [`Файл результата: ${work.data.file}`] : []));
    await ctx.tell(ctx.params.role, { task: lines.join('\n'), outputs: ['clean', 'remarks'] });
  },
  async signal(ctx, signal) {
    if (signal.type !== 'submit') return;
    if (signal.output === 'remarks' && !signal.summary) return { reject: 'Перечисли замечания в --summary: исполнитель увидит только их.' };
    return { output: signal.output, summary: signal.summary || '' };
  },
};
