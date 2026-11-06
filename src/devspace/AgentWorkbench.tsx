import { useCallback, useEffect, useRef, useState } from 'react'
import Chats from '../desktop/Chats'
import { api, chatSelectionIntent, reportError, selectChat, useDesktop } from '../desktop/client'
import { Icon } from '../desktop/Icons'
import { orderedChats } from '../desktop/chatOrder'
import { changeLayout, normalizeLayout, paneGeometry, panes, type LayoutAction, type PaneLayout, type PaneNode } from '../../desktop/service/pane-layout.mjs'

export interface PaneRequest { serial: number; action: 'right' | 'bottom' | 'close' | 'zoom' }
type Edge = 'left' | 'right' | 'top' | 'bottom' | 'center'
type DropTarget = { paneId: string; edge: Edge }
const memory = new Map<string, PaneLayout>()
const uid = () => crypto.randomUUID()

export default function AgentWorkbench({ projectId, spaceId, initialCwd, scopeIds, request, handledRequest, expanded, expand, close }: { projectId?: string; spaceId?: string; initialCwd: string; scopeIds: string[]; request: PaneRequest | null; handledRequest: () => void; expanded: boolean; expand: () => void; close: () => void }) {
  const state = useDesktop(), key = state.repo + ':' + (spaceId ? 'space:' + spaceId : projectId)
  const open = orderedChats(state.sessions).filter(session => scopeIds.includes(session.id)), openKey = open.map(session => session.id).join(',')
  const [layout, setLayout] = useState(() => normalizeLayout(memory.get(key) || (spaceId ? state.settings.agentSpaceLayouts?.[spaceId] : projectId ? state.settings.agentLayouts?.[projectId] : undefined), open.map(session => session.id)))
  const current = useRef(layout); current.current = layout
  const openIds = useRef(open.map(session => session.id)); openIds.current = open.map(session => session.id)
  const grid = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null), [menu, setMenu] = useState<{ paneId: string; x: number; y: number } | null>(null)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const lastRequest = useRef(0)
  const closingTab = useRef(false), focusVersion = useRef(0), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const persist = useCallback((value: PaneLayout) => {
    memory.set(key, value)
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => api(spaceId ? '/agent-space-layout' : '/agent-layout', { projectId, spaceId, layout: value })).catch(reportError)
  }, [key, projectId, spaceId])
  const update = (next: PaneLayout) => {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return
    current.current = next; memory.set(key, next); setLayout(next)
  }
  const dispatch = (action: LayoutAction) => {
    if (action.type !== 'ratio') focusVersion.current++
    const next = changeLayout(current.current, action); update(next)
    const active = panes(next.root).find(pane => pane.id === next.activePaneId)
    if (active?.selectedId && active.selectedId !== state.selectedId) selectChat(active.selectedId)
  }
  const paneAction = (action: PaneRequest['action'], paneId = current.current.activePaneId) => {
    if (action === 'close' && panes(current.current.root).length === 1) { close(); return }
    dispatch(action === 'right' || action === 'bottom' ? { type: 'split', direction: action, paneId, newId: uid() } : { type: action, paneId })
    setMenu(null)
  }
  const choose = (paneId: string, tabId: string) => {
    focusVersion.current++
    if (!scopeIds.includes(tabId)) return
    const next = normalizeLayout(current.current, [...new Set([...openIds.current, tabId])])
    update(changeLayout(next, { type: 'move', paneId, tabId })); selectChat(tabId)
  }
  const closeTab = async (paneId: string, id: string) => {
    if (closingTab.current) return
    const pane = panes(current.current.root).find(pane => pane.id === paneId)
    const preferred = pane?.selectedId === id ? pane.tabs.find(tab => tab !== id) : pane?.selectedId
    const version = focusVersion.current, intentVersion = chatSelectionIntent().version; closingTab.current = true
    try {
      await api(`/sessions/${id}`, {}, 'DELETE')
      if (!mounted.current) return
      let next = normalizeLayout(current.current, openIds.current.filter(tab => tab !== id))
      const intent = chatSelectionIntent(), requestedPane = intent.version !== intentVersion ? panes(next.root).find(pane => pane.tabs.includes(intent.id)) : undefined
      if (requestedPane) next = changeLayout(next, { type: 'focus', paneId: requestedPane.id, tabId: intent.id })
      else if (version === focusVersion.current) next = changeLayout(next, { type: 'focus', paneId, tabId: preferred || undefined })
      update(next)
      const selected = panes(next.root).find(pane => pane.id === next.activePaneId)?.selectedId
      if (selected) selectChat(selected)
    } catch (error) { reportError(error) } finally { closingTab.current = false }
  }
  useEffect(() => { update(normalizeLayout(current.current, openIds.current)) }, [openKey])
  useEffect(() => {
    if (closingTab.current) return
    if (!state.selectedId || !openIds.current.includes(state.selectedId)) {
      const selected=panes(current.current.root).find(p=>p.id===current.current.activePaneId)?.selectedId
      if(selected)selectChat(selected)
      return
    }
    const pane = panes(current.current.root).find(pane => pane.tabs.includes(state.selectedId!))
    if (pane) update(changeLayout(current.current, { type: 'focus', paneId: pane.id, tabId: state.selectedId }))
  }, [state.selectedId, openKey])
  useEffect(() => { const timer = setTimeout(() => persist(layout), 300); return () => clearTimeout(timer) }, [layout, persist])
  useEffect(() => () => persist(current.current), [persist])
  useEffect(() => { if (request && request.serial !== lastRequest.current) { lastRequest.current = request.serial; paneAction(request.action); handledRequest() } }, [request?.serial])
  useEffect(() => {
    const active = panes(layout.root).find(pane => pane.id === layout.activePaneId)
    if (active && !active.selectedId) grid.current?.querySelector<HTMLElement>(`[data-agent-pane="${active.id}"]`)?.focus({ preventScroll: true })
  }, [layout.activePaneId])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.code === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', dismiss); window.addEventListener('keydown', escape); window.addEventListener('resize', dismiss)
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape); window.removeEventListener('resize', dismiss) }
  }, [menu])
  const setCount = (count: number) => {
    focusVersion.current++
    let next = structuredClone(current.current)
    while (panes(next.root).length > count) next = changeLayout(next, { type: 'close', paneId: panes(next.root).at(-1)!.id })
    while (panes(next.root).length < count) {
      const leaves = panes(next.root), source = leaves.find(pane => pane.tabs.length > 1) || leaves[0]
      next = changeLayout(next, { type: 'split', paneId: source.id, direction: 'right', newId: uid() })
    }
    const leaves = panes(next.root), split = (axis: 'row' | 'column', first: PaneNode, second: PaneNode): PaneNode => ({ kind: 'split', id: uid(), ratio: .5, axis, first, second })
    next.root = count === 1 ? leaves[0] : count === 2 ? split('row', leaves[0], leaves[1]) : count === 3 ? split('row', leaves[0], split('column', leaves[1], leaves[2])) : split('row', split('column', leaves[0], leaves[2]), split('column', leaves[1], leaves[3]))
    next.zoomedPaneId = null; update(next); setMenu(null)
    const selected = leaves.find(pane => pane.id === next.activePaneId)?.selectedId; if (selected) selectChat(selected)
  }
  const drag = (tabId: string, x: number, y: number, phase: 'move' | 'drop' | 'cancel') => {
    if (phase === 'cancel') { setDrop(null); return false }
    const point = document.elementFromPoint(x, y), cell = point?.closest<HTMLElement>('[data-agent-pane]')
    const paneId = cell?.dataset.agentPane
    const source = panes(current.current.root).find(pane => pane.tabs.includes(tabId))
    if (!cell || !paneId || !grid.current?.contains(cell) || !source) { setDrop(null); return false }
    const body = cell.querySelector<HTMLElement>('.chat-body') || cell, rect = body.getBoundingClientRect()
    let edge: Edge = 'center'
    if (body.contains(point)) {
      const rx = (x - rect.left) / rect.width, ry = (y - rect.top) / rect.height
      if (rx < .2) edge = 'left'; else if (rx > .8) edge = 'right'; else if (ry < .2) edge = 'top'; else if (ry > .8) edge = 'bottom'
    }
    if (paneId === source.id && edge === 'center') { setDrop(null); return false }
    const target = { paneId, edge }
    if (phase === 'move') { setDrop(old => old?.paneId === paneId && old.edge === edge ? old : target); return true }
    setDrop(null)
    if (edge === 'center') choose(paneId, tabId)
    else if (panes(current.current.root).length < 4) dispatch({ type: 'split', paneId, direction: edge, newId: uid(), tabId })
    return true
  }
  const geometry = paneGeometry(layout.root), leaves = panes(layout.root)
  const resize = (event: React.PointerEvent, divider: typeof geometry.dividers[number]) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const host = grid.current!.getBoundingClientRect()
    const move = (event: PointerEvent) => {
      const start = divider.axis === 'row' ? host.left + host.width * divider.x / 100 : host.top + host.height * divider.y / 100
      const size = divider.axis === 'row' ? host.width * divider.width / 100 : host.height * divider.height / 100
      if (size > 0) dispatch({ type: 'ratio', splitId: divider.id, ratio: ((divider.axis === 'row' ? event.clientX : event.clientY) - start) / size })
    }
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  const openMenu = (event: React.MouseEvent, paneId = layout.activePaneId) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ paneId, x: Math.max(8, Math.min(rect.right - 270, innerWidth - 278)), y: Math.min(rect.bottom + 5, innerHeight - 310) }) }
  return <div className="agent-workbench">
    <header className="ds-agent-pane-heading"><Icon name="terminal" size={13}/><span>Агенты</span><span className="ds-fill"/><button onClick={event => openMenu(event)} aria-label="Раскладка панелей" title="Разделение и раскладка панелей"><Icon name="workspace" size={14}/><span>{leaves.length > 1 ? `${leaves.length} панели` : 'Раскладка'}</span></button><button onClick={expand} aria-label={expanded ? 'Вернуть материалы рядом' : 'Агенты на всю рабочую область'} title={expanded ? 'Вернуть материалы рядом' : 'На всю рабочую область'}><Icon name="external" size={14}/></button><button onClick={close} aria-label="Свернуть область агентов" title="Свернуть · Ctrl+J"><Icon name="close" size={14}/></button></header>
    <div className="agent-grid" ref={grid}>
      {geometry.cells.map(({ pane, x, y, width, height }, index) => <section key={pane.id} data-agent-pane={pane.id} data-pane-active={layout.activePaneId === pane.id} tabIndex={-1} className={'agent-cell '+(layout.activePaneId === pane.id ? 'active' : '')} aria-label={`Панель агентов ${index + 1}`} style={layout.zoomedPaneId === pane.id ? { inset: 0, width: '100%', height: '100%' } : { left: x+'%', top: y+'%', width: width+'%', height: height+'%', display: layout.zoomedPaneId ? 'none' : undefined }} onPointerDownCapture={() => { if (layout.activePaneId !== pane.id) dispatch({ type: 'focus', paneId: pane.id }) }} onFocusCapture={() => { if (current.current.activePaneId !== pane.id) dispatch({ type: 'focus', paneId: pane.id }) }}>

        <Chats embedded initialCwd={initialCwd} projectId={projectId} spaceId={spaceId} scopeIds={scopeIds} pane={{ id: pane.id, ids: pane.tabs, selectedId: pane.selectedId, focused: layout.activePaneId === pane.id, controls: <><button title={layout.zoomedPaneId === pane.id ? 'Вернуть раскладку · Ctrl+Shift+Z' : 'Развернуть панель · Ctrl+Shift+Z'} className="ds-pane-control" aria-label={`Развернуть или вернуть панель ${index + 1}`} onClick={() => paneAction('zoom', pane.id)}><Icon name="workspace" size={12}/></button><button className="ds-pane-control" aria-label={`Действия панели ${index + 1}`} title="Действия панели" onClick={event => openMenu(event, pane.id)}><Icon name="more" size={14}/></button></>, close: id => void closeTab(pane.id, id), choose: id => choose(pane.id, id), targets: leaves.filter(other => other.id !== pane.id).map(other => ({ id: other.id, name: `Панель ${leaves.indexOf(other) + 1}` })), move: (tabId, paneId) => choose(paneId, tabId), drag }}/>
        {drop?.paneId === pane.id && <div className={`agent-drop-preview edge-${drop.edge} ${drop.edge !== 'center' && leaves.length >= 4 ? 'blocked' : ''}`}><span>{drop.edge !== 'center' && leaves.length >= 4 ? 'Максимум 4 панели' : drop.edge === 'center' ? 'Переместить сюда' : 'Разделить и перенести'}</span></div>}
      </section>)}
      {!layout.zoomedPaneId && geometry.dividers.map(divider => <div key={divider.id} className={'agent-divider '+divider.axis} role="separator" tabIndex={0} aria-label="Размер панелей агентов" aria-orientation={divider.axis === 'row' ? 'vertical' : 'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(divider.ratio * 100)} style={divider.axis === 'row' ? { left: (divider.x + divider.width * divider.ratio)+'%', top: divider.y+'%', height: divider.height+'%' } : { top: (divider.y + divider.height * divider.ratio)+'%', left: divider.x+'%', width: divider.width+'%' }} onPointerDown={event => resize(event, divider)} onDoubleClick={() => dispatch({ type: 'ratio', splitId: divider.id, ratio: .5 })} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home'].includes(event.code)) { event.preventDefault(); dispatch({ type: 'ratio', splitId: divider.id, ratio: event.code === 'Home' ? .5 : divider.ratio + (['ArrowLeft', 'ArrowUp'].includes(event.code) ? -.025 : .025) }) } }}/>) }
    </div>
    {menu && <div ref={menuRef} className="agent-layout-menu" role="menu" aria-label="Действия панели" style={{ left: menu.x, top: Math.max(8, menu.y) }}><strong>Панель</strong><button role="menuitem" disabled={leaves.length >= 4} onClick={() => paneAction('right', menu.paneId)}>Разделить вправо<kbd>Ctrl Shift O</kbd></button><button role="menuitem" disabled={leaves.length >= 4} onClick={() => paneAction('bottom', menu.paneId)}>Разделить вниз<kbd>Ctrl Shift E</kbd></button><button role="menuitem" onClick={() => paneAction('close', menu.paneId)}>Убрать панель<kbd>Ctrl Shift X</kbd></button><button role="menuitem" onClick={() => paneAction('zoom', menu.paneId)}>{layout.zoomedPaneId ? 'Вернуть раскладку' : 'Развернуть панель'}<kbd>Ctrl Shift Z</kbd></button><hr/><span>Количество панелей</span><div className="agent-layout-presets">{[1, 2, 3, 4].map(count => <button key={count} aria-label={`Раскладка: ${count} панели`} aria-pressed={leaves.length === count} onClick={() => setCount(count)}>{count}</button>)}</div><small>Убирается только панель. Агенты продолжают работать.</small></div>}
  </div>
}
