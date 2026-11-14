// A flow is a file that connects blocks. This module checks it before it can
// run: every step uses a known block with valid parameters, every output of a
// block leads somewhere, every path can end, and every loop is bounded.
export const terminals = { '@done': 'Готово', '@stopped': 'Остановлено', '@person': 'Позвать человека' };
const idPattern = /^[a-z][a-z0-9-]{0,39}$/;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);

function checkParams(step, block, flow, add) {
  const given = step.with || {};
  for (const name of Object.keys(given)) if (!block.params[name]) add(`у блока «${block.title}» нет параметра «${name}»`);
  for (const [name, definition] of Object.entries(block.params)) {
    const value = given[name];
    if (value === undefined || value === '') { if (definition.required) add(`не задан параметр «${definition.title || name}»`); continue; }
    if (definition.type === 'role' && !flow.roles[value]) add(`роль «${value}» не объявлена во флоу`);
    else if (definition.type === 'need' && !flow.needs[value]) add(`подключение «${value}» не объявлено во флоу`);
    else if (definition.type === 'step' && !flow.steps[value]) add(`шаг «${value}» не найден`);
    else if (definition.type === 'enum' && !definition.values.includes(value)) add(`параметр «${definition.title || name}» — одно из: ${definition.values.join(', ')}`);
    else if (definition.type === 'number' && !(Number.isFinite(value) && value >= (definition.min ?? 0) && value <= (definition.max ?? 1000))) add(`параметр «${definition.title || name}» — число от ${definition.min ?? 0} до ${definition.max ?? 1000}`);
    else if (definition.type === 'text' && !text(value, 6000)) add(`параметр «${definition.title || name}» — текст до 6000 знаков`);
    else if (definition.type === 'object' && (typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 4000)) add(`параметр «${definition.title || name}» — набор значений`);
  }
}

// Returns the normalized flow and a list of problems. A flow with problems
// cannot be launched.
export function validateFlow(raw, { blocks, roles = {} }) {
  const problems = [], add = (message, step) => problems.push({ step: step || null, text: message });
  const flow = { flow: 1, id: '', name: '', description: '', roles: {}, needs: {}, limits: {}, start: '', steps: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.flow !== 1) return { flow, problems: [{ step: null, text: 'Это не флоу Dev Space: в файле нет «"flow": 1».' }], ok: false };
  if (idPattern.test(raw.id || '')) flow.id = raw.id; else add('ID флоу — латинские буквы, цифры и дефис');
  if (text(raw.name, 80)) flow.name = raw.name.trim(); else add('у флоу нет названия');
  if (raw.description !== undefined) { if (text(raw.description, 400)) flow.description = raw.description.trim(); else add('описание флоу — текст до 400 знаков'); }
  for (const [id, role] of Object.entries(raw.roles || {})) {
    if (!idPattern.test(id) || !text(role?.title, 40)) { add(`роль «${id}» описана некорректно`); continue; }
    flow.roles[id] = { title: role.title.trim(), ...(text(role.agent, 20) ? { agent: role.agent } : {}) };
  }
  for (const [id, need] of Object.entries(raw.needs || {})) {
    if (!idPattern.test(id) || !roles[need?.role]) { add(`подключение «${id}» ссылается на неизвестную роль`); continue; }
    flow.needs[id] = { role: need.role };
  }
  const handoffs = raw.limits?.handoffs;
  if (Number.isInteger(handoffs) && handoffs >= 1 && handoffs <= 100) flow.limits.handoffs = handoffs;
  else add('задайте общий предел передач между шагами: limits.handoffs от 1 до 100');

  const entries = Object.entries(raw.steps && typeof raw.steps === 'object' ? raw.steps : {});
  if (!entries.length) add('во флоу нет шагов');
  if (entries.length > 60) add('во флоу может быть до 60 шагов');
  for (const [id, step] of entries.slice(0, 60)) {
    if (!idPattern.test(id)) { add(`имя шага «${id}» — латинские буквы, цифры и дефис`); continue; }
    flow.steps[id] = { block: String(step?.block || ''), ...(text(step?.title, 60) ? { title: step.title.trim() } : {}), with: step?.with && typeof step.with === 'object' && !Array.isArray(step.with) ? { ...step.with } : {}, next: step?.next && typeof step.next === 'object' ? { ...step.next } : {}, limit: step?.limit && typeof step.limit === 'object' ? { ...step.limit } : {} };
  }
  if (flow.steps[raw.start]) flow.start = raw.start; else add('не указан первый шаг: start');

  for (const [id, step] of Object.entries(flow.steps)) {
    const block = blocks.get(step.block), note = message => add(message, id);
    if (!block) { note(`блок «${step.block}» не найден. Возможно, удалён плагин, который его добавлял`); continue; }
    checkParams(step, block, flow, note);
    const outputs = block.outputs.map(output => output.id);
    for (const output of outputs) {
      const target = step.next[output];
      if (target === undefined) note(`выход «${block.outputs.find(item => item.id === output).title}» никуда не ведёт`);
      else if (!terminals[target] && !flow.steps[target]) note(`выход «${output}» ведёт к шагу «${target}», которого нет`);
    }
    for (const output of Object.keys(step.next)) if (!outputs.includes(output)) note(`у блока «${block.title}» нет выхода «${output}»`);
    for (const [output, limit] of Object.entries(step.limit)) {
      if (!outputs.includes(output)) note(`предел задан для выхода «${output}», которого у блока нет`);
      else if (!Number.isInteger(limit) || limit < 0 || limit > 50) note(`предел возвратов для «${output}» — целое число от 0 до 50`);
    }
    for (const message of block.check?.(step, flow) || []) note(message);
  }

  if (flow.start && !problems.length) {
    // A step also leads to the steps its parameters name, such as the branch of «Несколько сразу».
    const branches = id => Object.entries(blocks.get(flow.steps[id].block).params).filter(([name, param]) => param.type === 'step' && flow.steps[flow.steps[id].with[name]]).map(([name]) => ['~' + name, flow.steps[id].with[name]]);
    const ids = Object.keys(flow.steps), edges = id => [...Object.entries(flow.steps[id].next).filter(([, target]) => flow.steps[target]), ...branches(id)];
    // Every step must be reachable from the start…
    const seen = new Set([flow.start]), queue = [flow.start];
    while (queue.length) for (const [, target] of edges(queue.shift())) if (!seen.has(target)) { seen.add(target); queue.push(target); }
    for (const id of ids) if (!seen.has(id)) add('до этого шага нельзя дойти от начала', id);
    // …and must be able to reach an end.
    const ends = new Set(ids.filter(id => Object.values(flow.steps[id].next).some(target => terminals[target])));
    for (let changed = true; changed;) { changed = false; for (const id of ids) if (!ends.has(id) && edges(id).some(([, target]) => ends.has(target))) { ends.add(id); changed = true; } }
    for (const id of ids) if (!ends.has(id)) add('от этого шага нельзя дойти до конца флоу', id);
    // A loop is allowed only through a transition that has a return limit.
    const open = id => edges(id).filter(([output]) => flow.steps[id].limit[output] === undefined).map(([, target]) => target);
    const state = new Map(), trail = [];
    const visit = id => {
      state.set(id, 1); trail.push(id);
      for (const target of open(id)) {
        if (state.get(target) === 1) { const loop = [...trail.slice(trail.indexOf(target)), target]; add(`круг без предела: ${loop.map(step => flow.steps[step].title || blocks.get(flow.steps[step].block).title).join(' → ')}. Задайте limit у перехода, который возвращает назад`, id); return true; }
        if (!state.has(target) && visit(target)) return true;
      }
      state.set(id, 2); trail.pop(); return false;
    };
    for (const id of ids) if (!state.has(id) && visit(id)) break;
  }
  return { flow, problems, ok: !problems.length };
}

// The steps in reading order: from the start, following the first-listed outputs.
export function stepOrder(flow) {
  const order = [], seen = new Set(), walk = id => { if (!flow.steps[id] || seen.has(id)) return; seen.add(id); order.push(id); for (const target of [...Object.values(flow.steps[id].with).filter(value => typeof value === 'string' && flow.steps[value] && value !== id), ...Object.values(flow.steps[id].next)]) walk(target); };
  walk(flow.start);
  for (const id of Object.keys(flow.steps)) walk(id);
  return order;
}
