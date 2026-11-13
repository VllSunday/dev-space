// Несколько сразу: the things taken at the input are handed out one by one. Each
// gets its own run of the steps that start at `each`, with its own agents. The
// step ends when every one of them has ended.
export default {
  id: 'parallel', title: 'Несколько сразу', summary: 'по запуску на каждую вещь',
  params: {
    each: { type: 'step', title: 'Что делать с каждой', required: true },
    max: { type: 'number', title: 'Одновременно не больше', min: 1, max: 6 },
  },
  outputs: [{ id: 'all', title: 'Все готовы' }, { id: 'some', title: 'Не все дошли до конца' }],
  check(step, flow) {
    // The branch must not come back to this step: it has its own end.
    const seen = new Set(), queue = [step.with.each], own = Object.keys(flow.steps).find(id => flow.steps[id] === step);
    while (queue.length) { const id = queue.shift(); if (!flow.steps[id] || seen.has(id)) continue; seen.add(id); queue.push(...Object.values(flow.steps[id].next)); }
    return seen.has(own) ? ['ветка «each» не должна возвращаться к блоку «Несколько сразу»'] : [];
  },
  async enter(ctx) {
    const things = ctx.run.item?.things || [];
    if (!things.length) return { output: 'all', summary: 'Раздавать нечего.' };
    ctx.state.children = await ctx.spawn(things.map(thing => ({ item: { kind: 'things', title: thing.title, things: [thing] }, start: ctx.params.each })), ctx.params.max || 3);
  },
  async signal(ctx, signal) {
    if (signal.type !== 'children') return;
    const done = signal.children.filter(child => child.status === 'done').length;
    return { output: done === signal.children.length ? 'all' : 'some', summary: `Готово ${done} из ${signal.children.length}.` };
  },
};
