import { runCheck, checkNames, checkTitles } from '../checks.mjs';

// Проверка фактов: code, not an agent, checks what can be checked exactly — a
// file exists, a proposal parses, a plugin manifest is valid.
export default {
  id: 'facts', title: 'Проверка фактов', summary: 'проверяет код, а не агент',
  params: {
    check: { type: 'enum', title: 'Проверить', required: true, values: checkNames },
    path: { type: 'text', title: 'Путь к файлу' },
  },
  outputs: [{ id: 'passed', title: 'Прошло' }, { id: 'failed', title: 'Не прошло' }],
  labels: { check: checkTitles },
  async enter(ctx) {
    const last = ctx.lastResult();
    const verdict = await runCheck(ctx.params.check, ctx, { file: ctx.params.path || last?.data?.file, id: last?.data?.id, summary: last?.summary });
    return verdict.ok ? { output: 'passed', summary: verdict.summary, data: verdict.data } : { output: 'failed', summary: verdict.reason };
  },
};
