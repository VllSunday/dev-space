// Вопрос агенту: one question goes to an agent, the answer comes back as the
// result of this step and is visible to the steps after it.
export default {
  id: 'ask', title: 'Вопрос агенту', summary: 'спросить и вернуть ответ', agent: true,
  params: {
    role: { type: 'role', title: 'Кого спрашиваем', required: true },
    question: { type: 'text', title: 'Вопрос', required: true },
  },
  outputs: [{ id: 'answered', title: 'Ответил', hint: 'ответ напиши в --summary' }, { id: 'unknown', title: 'Не знает', hint: 'ответить нельзя; причину напиши в --summary' }],
  async enter(ctx) {
    await ctx.tell(ctx.params.role, { task: `Ответь на вопрос и ничего не меняй в проекте.\n\nВопрос: ${ctx.params.question}`, outputs: ['answered', 'unknown'] });
  },
  async signal(ctx, signal) {
    if (signal.type !== 'submit') return;
    if (!signal.summary) return { reject: 'Ответ пуст. Напиши его в --summary.' };
    return { output: signal.output, summary: signal.summary };
  },
};
