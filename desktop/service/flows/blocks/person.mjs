// Мне: the flow stops and waits for a person. What the agents produced is shown
// on the board as a proposal; accepting applies it.
export default {
  id: 'person', title: 'Мне', summary: 'решение человека', person: true,
  params: {
    question: { type: 'text', title: 'Что решить' },
    apply: { type: 'enum', title: 'При принятии', values: ['proposal', 'nothing'] },
  },
  outputs: [{ id: 'accept', title: 'Принял' }, { id: 'return', title: 'Вернул' }],
  async enter(ctx) {
    const last = ctx.lastResult();
    ctx.waitPerson({ question: ctx.params.question || 'Принять результат?', summary: last?.summary || '', proposal: ctx.proposal() });
  },
  async signal(ctx, signal) {
    if (signal.type !== 'decision') return;
    if (signal.output === 'return') return { output: 'return', summary: signal.note || 'Человек вернул работу без пояснения.' };
    const proposal = ctx.proposal();
    if (proposal && ctx.params.apply !== 'nothing') {
      try { await ctx.call('proposal.apply', proposal); }
      catch (error) { return { reject: `Не удалось применить предложение: ${error.message}` }; }
    }
    return { output: 'accept', summary: signal.note || 'Принято.' };
  },
};
