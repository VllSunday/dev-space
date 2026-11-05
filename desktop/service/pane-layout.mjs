const id = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
export const MAX_PANES = 4;
export function panes(node) { return node.kind === 'pane' ? [node] : [...panes(node.first), ...panes(node.second)]; }
export function validateLayout(value) {
  const nodes = new Set(), tabs = new Set(); let count = 0;
  function read(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 3 || !id(node.id) || nodes.has(node.id)) throw Error('Некорректная раскладка панелей.');
    nodes.add(node.id);
    if (node.kind === 'pane') {
      if (++count > MAX_PANES || !Array.isArray(node.tabs) || node.tabs.length > 500) throw Error('Можно открыть до четырёх панелей.');
      const list = node.tabs.map(tab => { if (!id(tab) || tabs.has(tab)) throw Error('Вкладка должна находиться в одной панели.'); tabs.add(tab); return tab; });
      return { kind: 'pane', id: node.id, tabs: list, selectedId: list.includes(node.selectedId) ? node.selectedId : list[0] || null };
    }
    if (node.kind !== 'split' || !['row', 'column'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio < .2 || node.ratio > .8) throw Error('Некорректный разделитель панелей.');
    return { kind: 'split', id: node.id, axis: node.axis, ratio: node.ratio, first: read(node.first, depth + 1), second: read(node.second, depth + 1) };
  }
  const root = read(value?.root), leaves = panes(root);
  return { root, activePaneId: leaves.some(p => p.id === value.activePaneId) ? value.activePaneId : leaves[0].id, zoomedPaneId: leaves.some(p => p.id === value.zoomedPaneId) ? value.zoomedPaneId : null };
}
export function normalizeLayout(value, openIds) {
  let layout;
  try { layout = validateLayout(value); } catch { layout = { root: { kind: 'pane', id: 'pane-main', tabs: [], selectedId: null }, activePaneId: 'pane-main', zoomedPaneId: null }; }
  const allowed = new Set(openIds), assigned = new Set(), leaves = panes(layout.root);
  for (const pane of leaves) {
    pane.tabs = pane.tabs.filter(tab => allowed.has(tab) && !assigned.has(tab) && assigned.add(tab));
    if (!pane.tabs.includes(pane.selectedId)) pane.selectedId = pane.tabs[0] || null;
  }
  const target = leaves.find(p => p.id === layout.activePaneId);
  for (const tab of openIds) if (!assigned.has(tab)) { target.tabs.push(tab); target.selectedId = tab; assigned.add(tab); }
  return layout;
}
function replace(node, target, replacement) {
  if (node.id === target) return replacement;
  if (node.kind === 'split') { node.first = replace(node.first, target, replacement); node.second = replace(node.second, target, replacement); }
  return node;
}
function remove(node, target) {
  if (node.kind === 'pane') return node.id === target ? null : node;
  const first = remove(node.first, target), second = remove(node.second, target);
  return !first ? second : !second ? first : { ...node, first, second };
}
export function changeLayout(current, action) {
  const layout = structuredClone(current), leaves = panes(layout.root);
  const target = leaves.find(p => p.id === (action.paneId || layout.activePaneId));
  if (!target) return current;
  const focus = pane => { layout.activePaneId = pane.id; if (layout.zoomedPaneId) layout.zoomedPaneId = pane.id; };
  if (action.type === 'focus') { focus(target); if (target.tabs.includes(action.tabId)) target.selectedId = action.tabId; }
  if (action.type === 'zoom') { layout.activePaneId = target.id; layout.zoomedPaneId = layout.zoomedPaneId === target.id ? null : target.id; }
  if (action.type === 'ratio') {
    if (!Number.isFinite(action.ratio)) return current;
    const set = node => { if (node.kind === 'split') { if (node.id === action.splitId) node.ratio = Math.max(.2, Math.min(.8, action.ratio)); else { set(node.first); set(node.second); } } };
    set(layout.root);
  }
  if (action.type === 'move') {
    const source = leaves.find(p => p.tabs.includes(action.tabId));
    if (!source) return current;
    source.tabs = source.tabs.filter(tab => tab !== action.tabId);
    if (source.selectedId === action.tabId) source.selectedId = source.tabs[0] || null;
    target.tabs.push(action.tabId); target.selectedId = action.tabId; focus(target);
  }
  if (action.type === 'close') {
    if (leaves.length === 1) return current;
    const index = leaves.indexOf(target), next = leaves[index > 0 ? index - 1 : 1];
    next.tabs.push(...target.tabs);
    next.selectedId ||= target.selectedId || next.tabs[0] || null;
    layout.root = remove(layout.root, target.id); focus(next);
  }
  if (action.type === 'split') {
    if (leaves.length >= MAX_PANES || !id(action.newId)) return current;
    const next = { kind: 'pane', id: action.newId, tabs: [], selectedId: null };
    const split = { kind: 'split', id: `split-${action.newId}`, axis: ['left', 'right'].includes(action.direction) ? 'row' : 'column', ratio: .5, first: target, second: next };
    if (['left', 'top'].includes(action.direction)) [split.first, split.second] = [split.second, split.first];
    layout.root = replace(layout.root, target.id, split);
    const tab = action.tabId || target.tabs.find(tab => tab !== target.selectedId);
    if (tab) {
      const source = leaves.find(p => p.tabs.includes(tab));
      if (source) { source.tabs = source.tabs.filter(id => id !== tab); if (source.selectedId === tab) source.selectedId = source.tabs[0] || null; next.tabs = [tab]; next.selectedId = tab; }
    }
    layout.activePaneId = next.id; layout.zoomedPaneId = null;
  }
  return layout;
}
export function paneGeometry(root, box = { x: 0, y: 0, width: 100, height: 100 }) {
  const cells = [], dividers = [];
  function walk(node, rect) {
    if (node.kind === 'pane') { cells.push({ pane: node, ...rect }); return; }
    dividers.push({ id: node.id, axis: node.axis, ratio: node.ratio, ...rect });
    if (node.axis === 'row') {
      walk(node.first, { ...rect, width: rect.width * node.ratio });
      walk(node.second, { ...rect, x: rect.x + rect.width * node.ratio, width: rect.width * (1 - node.ratio) });
    } else {
      walk(node.first, { ...rect, height: rect.height * node.ratio });
      walk(node.second, { ...rect, y: rect.y + rect.height * node.ratio, height: rect.height * (1 - node.ratio) });
    }
  }
  walk(root, box); return { cells, dividers };
}
