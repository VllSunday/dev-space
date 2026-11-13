import { runCheck, checkNames } from '../checks.mjs';

// Работа: an agent does the assignment and hands the step in with
// `devspace step done`. The block checks the result by code before it accepts.
export default {
  id: 'work', title: 'Работа', summary: 'агент делает задание', agent: true,
  params: {
    role: { type: 'role', title: 'Кто', required: true },
    task: { type: 'text', title: 'Задание' },
    expects: { type: 'enum', title: 'Что должен сдать', values: ['nothing', ...checkNames] },
  },
  outputs: [{ id: 'done', title: 'Сдал', hint: 'работа сделана' }, { id: 'blocked', title: 'Не может продолжить', hint: 'нужна помощь человека; причину укажи в --summary' }],
  async enter(ctx) {
    const { role, task, expects } = ctx.params, came = ctx.came;
    const lines = [];
    // Coming back to this step means someone returned the work: say why first.
    if (ctx.again && came?.summary && came.from !== ctx.stepId) lines.push(`${came.kind === 'person' ? 'Человек вернул работу' : `Шаг «${ctx.title(came.from)}» вернул работу`} с замечаниями:`, came.summary, '', 'Исправь это и сдай шаг заново.', '');
    lines.push(task || 'Выполни задачу, описанную в данных ниже.');
    if (expects && expects !== 'nothing') lines.push('', await ctx.checkHint(expects));
    await ctx.tell(role, { task: lines.join('\n'), outputs: ['done', 'blocked'] });
  },
  async signal(ctx, signal) {
    if (signal.type !== 'submit') return;
    if (signal.output === 'blocked') return signal.summary ? { output: 'blocked', summary: signal.summary } : { reject: 'Объясни в --summary, что мешает продолжить.' };
    const expects = ctx.params.expects;
    if (expects && expects !== 'nothing') {
      const verdict = await runCheck(expects, ctx, signal);
      if (!verdict.ok) return { reject: verdict.reason };
      return { output: 'done', summary: signal.summary || verdict.summary, data: verdict.data };
    }
    return { output: 'done', summary: signal.summary || '', data: signal.file ? { file: signal.file } : undefined };
  },
};
