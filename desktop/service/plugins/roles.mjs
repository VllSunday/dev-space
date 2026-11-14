// A role is a contract that Dev Space defines and plugins fulfil. A flow names
// the role; which plugin plays it is chosen at launch. Roles stay small and
// versioned: what a role lacks, a plugin still offers as its own operation.
export const roles = {
  tracker: {
    id: 'tracker', version: 1, title: 'Трекер задач',
    description: 'Откуда берутся задачи и куда возвращается их статус.',
    fields: [
      { id: 'title', title: 'название', type: 'текст' },
      { id: 'statusGroup', title: 'группа статуса', type: 'не начато · в работе · завершено' },
      { id: 'assignee', title: 'исполнитель', type: 'человек или агент' },
      { id: 'url', title: 'ссылка', type: 'адрес задачи в трекере' },
    ],
    operations: {
      list: { kind: 'read', title: 'список задач', required: true },
      new: { kind: 'event', title: 'новая задача', note: 'Dev Space сам замечает новое в списке' },
      setStatus: { kind: 'action', title: 'сменить статус', required: true, params: { id: 'задача', status: 'todo | doing | done' } },
      comment: { kind: 'action', title: 'оставить комментарий', required: false, params: { id: 'задача', text: 'текст' } },
    },
  },
};
export const operationKinds = { read: 'Чтение', event: 'Событие', action: 'Действие' };

// Problems that stop a connection from playing a role; an empty list means it fits.
export function rolePlayProblems(connection) {
  const plays = connection.plays, role = roles[plays?.role];
  if (!plays) return [];
  if (!role) return [`неизвестная роль «${plays.role}»`];
  const problems = [];
  if (plays.version > role.version) problems.push(`роль «${role.title}» версии ${plays.version} этой сборке неизвестна`);
  for (const [name, definition] of Object.entries(role.operations)) {
    if (definition.kind === 'event') continue;
    const target = plays.operations?.[name], operation = target && connection.operations[target];
    if (!target) { if (definition.required) problems.push(`нет обязательной операции «${definition.title}»`); continue; }
    if (!operation) problems.push(`операция «${target}» для «${definition.title}» не объявлена`);
    else if (operation.kind !== definition.kind) problems.push(`«${target}» должна быть операцией вида «${operationKinds[definition.kind]}»`);
  }
  return problems;
}
