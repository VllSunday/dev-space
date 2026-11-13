import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { api, uploadSpaceFile } from '../desktop/client'
import { Icon, TopicIcon } from '../desktop/Icons'
import ZoneView, { type Outline } from '../plugins/ZoneView'
import type { PluginsState, Thing } from '../plugins/types'
import type { Board, Project, SpaceState, Zone, ZoneSource } from '../devspace/model'
import type { StatusGroup } from '../../desktop/service/things.mjs'
import { findBoardKind, findView, matches, thingsOfZone, useConnectionThings, viewsFor } from './data'
import './board.css'

// The project board: zones with things on one surface. Three levels are one
// surface at three distances — the whole board, one zone, one thing — and the
// header above them stays the same.
const CELL = 20, colors = ['#7fb0a8', '#96b2d7', '#d9a37f', '#b7a3d9', '#9cc5a3', '#e5c07b', '#d99ab0', '#8fb7c9']
type Mutate = (change: Record<string, unknown>) => Promise<unknown>
type Box = { x: number; y: number; w: number; h: number }
export interface BoardApi {
  data: SpaceState; project: Project; board: Board; plugins: PluginsState; mutate: Mutate; notify: (text: string) => void
  query: string; selected: Set<string>; toggle: (thing: Thing) => void
  openThing: (thing: Thing, zone?: Zone) => void; openZone: (zone: Zone, boardId?: string) => void; openArchive: () => void
}

const sourceLabel = (source: ZoneSource, project: Project, plugins: PluginsState) => source.kind === 'topic' ? (source.topicId === 'unfiled' ? 'материалы без темы' : source.topicId === 'all' ? 'все материалы проекта' : 'заметки и файлы темы «' + (project.topics.find(topic => topic.id === source.topicId)?.name || 'удалена') + '»') : source.kind === 'pages' ? 'документы проекта' : source.kind === 'tasks' ? 'задачи проекта' : source.kind === 'refs' ? 'подборка вещей' : source.kind === 'outline' ? 'состав проекта' : plugins.connections.find(item => item.id === source.connectionId)?.title || 'подключение удалено'

function Menu({ label, icon = 'more', children, align = 'right' }: { label: string; icon?: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }, key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }; window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key); return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key) } }, [open])
  return <div className="bd-menu" ref={ref}><button type="button" className="ds-icon" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name={icon} size={14} /></button>{open && <div className={'bd-popover ' + align} role="menu">{children(() => setOpen(false))}</div>}</div>
}

function ZoneMenu({ zone, board, api, things, close }: { zone: Zone; board: Board; api: BoardApi; things: Thing[]; close: () => void }) {
  const update = (patch: Record<string, unknown>) => { close(); void api.mutate({ action: 'zone-update', boardId: board.id, zoneId: zone.id, ...patch }).catch(() => {}) }
  const views = viewsFor(api.plugins, things, zone)
  return <>
    <h5>Вид</h5>
    {views.map(item => <button type="button" role="menuitemradio" aria-checked={zone.view === item.ref} key={item.ref} onClick={() => update({ view: item.ref })}><span>{item.title}</span>{!item.builtin && <small>{item.plugin}</small>}{zone.view === item.ref && <Icon name="check" size={13} />}</button>)}
    <hr />
    <div className="bd-swatches" role="group" aria-label="Цвет зоны">{colors.map(color => <button type="button" key={color} aria-label={'Цвет ' + color} aria-pressed={zone.color === color} style={{ background: color }} onClick={() => update({ color })} />)}<button type="button" aria-label="Без цвета" className="none" onClick={() => update({ color: null })} /></div>
    <button type="button" role="menuitem" onClick={() => update({ collapsed: !zone.collapsed })}><span>{zone.collapsed ? 'Развернуть' : 'Свернуть в заголовок'}</span></button>
    <button type="button" role="menuitem" onClick={() => { update({ hidden: true }); api.notify('Зона убрана на нижнюю полку. Её вещи на месте.') }}><span>Скрыть с доски</span></button>
    <hr />
    <p>{sourceLabel(zone.source, api.project, api.plugins)}</p>
    <button type="button" role="menuitem" className="danger" onClick={() => { close(); void api.mutate({ action: 'zone-delete', boardId: board.id, zoneId: zone.id }).then(() => api.notify('Зона удалена. Вещи остались в проекте. Отменить: Ctrl+Z')).catch(() => {}) }}><span>Удалить зону</span></button>
  </>
}

// How many things fit a zone of this size, so the overview shows a tidy preview.
function capacity(view: string, box: Box) {
  const width = box.w * CELL - 26, height = box.h * CELL - 52
  if (view === 'core/tiles' || view === 'core/gallery') { const columns = Math.max(1, Math.floor((width + 8) / 112)), tile = (width - (columns - 1) * 8) / columns, row = tile * (view === 'core/gallery' ? .75 : .625) + (view === 'core/gallery' ? 8 : 38); return Math.max(columns, Math.floor((height + 8) / row) * columns) }
  if (view === 'core/list' || view === 'tasks/checklist') return Math.max(2, Math.floor((height - 4) / 30))
  return undefined
}

function ZoneCard({ zone, board, api, things, error, loading, box, style, dragging, onGrab, onResize, outline, dim }: { zone: Zone; board: Board; api: BoardApi; things: Thing[]; error?: string; loading?: boolean; box: Box; style?: CSSProperties; dragging?: boolean; onGrab?: (event: ReactPointerEvent) => void; onResize?: (event: ReactPointerEvent) => void; outline: Outline; dim: boolean }) {
  const [renaming, setRenaming] = useState(false), [dropping, setDropping] = useState(false)
  const found = findView(api.plugins, zone.view), shown = things.filter(thing => matches(thing, api.query))
  const limit = api.query ? undefined : capacity(zone.view, box)
  const setStatus = (thing: Thing, group: StatusGroup) => void changeStatus(api, thing, group)
  const drop = async (files: File[]) => {
    if (zone.source.kind !== 'topic' && zone.source.kind !== 'refs' || !files.length) return
    try { const added = await Promise.all(files.map(uploadSpaceFile)); await api.mutate({ action: 'create-material', projectId: api.project.id, topicId: zone.source.kind === 'topic' && zone.source.topicId !== 'all' ? zone.source.topicId : 'unfiled', text: '', files: added, boardId: board.id, zoneId: zone.id }); api.notify(added.length === 1 ? 'Файл добавлен в зону «' + zone.name + '»' : 'Файлы добавлены в зону «' + zone.name + '»') } catch (error) { api.notify((error as Error).message) }
  }
  return <section className={'bd-zone' + (zone.collapsed ? ' collapsed' : '') + (dragging ? ' dragging' : '') + (dim ? ' dim' : '') + (dropping ? ' dropping' : '')} style={{ ...style, '--zone': zone.color || 'var(--ds-faint)' } as CSSProperties} data-zone={zone.id} aria-label={'Зона ' + zone.name}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files') && (zone.source.kind === 'topic' || zone.source.kind === 'refs')) { event.preventDefault(); event.stopPropagation(); setDropping(true) } }} onDragLeave={() => setDropping(false)} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); setDropping(false); void drop([...event.dataTransfer.files]) }}>
    <header onPointerDown={onGrab}>
      <i className="bd-dot" />
      {zone.icon && <TopicIcon value={zone.icon} size={14} />}
      {renaming ? <form onSubmit={event => { event.preventDefault(); const value = (event.currentTarget.elements.namedItem('name') as HTMLInputElement).value.trim(); setRenaming(false); if (value && value !== zone.name) void api.mutate({ action: 'zone-update', boardId: board.id, zoneId: zone.id, name: value }).catch(() => {}) }}><input name="name" defaultValue={zone.name} autoFocus aria-label="Название зоны" onBlur={event => event.currentTarget.form?.requestSubmit()} onKeyDown={event => { if (event.key === 'Escape') setRenaming(false) }} onPointerDown={event => event.stopPropagation()} /></form>
        : <button type="button" className="bd-zone-name" title="Открыть зону · двойной щелчок — переименовать" onClick={() => api.openZone(zone)} onDoubleClick={() => setRenaming(true)}>{zone.name}</button>}
      <small>{loading ? '…' : things.length || ''}</small>
      <span className="bd-fill" />
      <span className="bd-zone-actions" onPointerDown={event => event.stopPropagation()}>
        <button type="button" className="ds-icon" aria-label={zone.collapsed ? 'Развернуть зону' : 'Свернуть зону'} title={zone.collapsed ? 'Развернуть' : 'Свернуть'} onClick={() => void api.mutate({ action: 'zone-update', boardId: board.id, zoneId: zone.id, collapsed: !zone.collapsed }).catch(() => {})}><Icon name={zone.collapsed ? 'down' : 'up'} size={13} /></button>
        <Menu label={'Настройки зоны ' + zone.name}>{close => <ZoneMenu zone={zone} board={board} api={api} things={things} close={close} />}</Menu>
      </span>
    </header>
    {!zone.collapsed && <div className="bd-zone-body">
      {found.missing && <p className="bd-note">Вид «{zone.view}» недоступен: его плагин удалён. Показан список.</p>}
      {error ? <p className="bd-note warn">{error}</p> : !things.length && !loading && zone.source.kind !== 'outline' ? <p className="bd-empty">{zone.source.kind === 'topic' || zone.source.kind === 'refs' ? 'Пусто. Перетащите сюда файл или откройте зону и напишите заметку.' : zone.source.kind === 'tasks' ? 'Задач пока нет.' : zone.source.kind === 'pages' ? 'Документов пока нет.' : 'Записей нет.'}</p>
        : api.query && !shown.length && zone.source.kind !== 'outline' ? <p className="bd-empty">Совпадений нет.</p>
        : <ZoneView view={found.view} pluginId={found.pluginId} things={shown} compact limit={limit} viewBase={api.plugins.viewBase} zoneName={zone.name} outline={outline} more={() => api.openZone(zone)} open={thing => api.openThing(thing, zone)} setStatus={setStatus} selected={api.selected} toggle={api.toggle} openZone={(boardId, zoneId) => { const target = api.data.boards.find(item => item.id === boardId)?.zones.find(item => item.id === zoneId); if (target) api.openZone(target, boardId) }} openArchive={api.openArchive} />}
    </div>}
    {onResize && !zone.collapsed && <span className="bd-resize" onPointerDown={onResize} role="separator" aria-label={'Размер зоны ' + zone.name} />}
  </section>
}

export async function changeStatus(api: Pick<BoardApi, 'mutate' | 'notify' | 'project'>, thing: Thing, group: StatusGroup) {
  try {
    if (thing.external) await callApi('/connections/status', { id: thing.external, itemId: thing.id, status: group, projectId: api.project.id })
    else await api.mutate({ action: 'update-task', id: thing.id, status: group === 'todo' ? 'todo' : group === 'doing' ? 'working' : 'done' })
  } catch (error) { api.notify((error as Error).message) }
}
const callApi = api

// Lines between zones that share things: a task and the material it came from,
// or one thing lying in two zones. Drawn only when the board's plugin asks.
function Links({ zones, boxes, things, data }: { zones: Zone[]; boxes: Record<string, Box>; things: Record<string, Thing[]>; data: SpaceState }) {
  const lines = useMemo(() => {
    const result: { a: Box; b: Box; key: string }[] = [], ids = (zone: Zone) => new Set(things[zone.id]?.map(thing => thing.id))
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
      const a = ids(zones[i]), b = ids(zones[j]), related = (from: Set<string>, to: Set<string>) => data.tasks.some(task => from.has(task.id) && task.sourceId && to.has(task.sourceId)) || data.materials.some(item => from.has(item.id) && item.modelPageId && to.has(item.modelPageId))
      if ([...a].some(id => b.has(id)) || related(a, b) || related(b, a)) result.push({ a: boxes[zones[i].id], b: boxes[zones[j].id], key: zones[i].id + zones[j].id })
    }
    return result
  }, [zones, boxes, things, data])
  const center = (box: Box) => [(box.x + box.w / 2) * CELL, (box.y + box.h / 2) * CELL]
  return <svg className="bd-links" aria-hidden="true">{lines.map(line => { const [x1, y1] = center(line.a), [x2, y2] = center(line.b), mid = (x1 + x2) / 2; return <path key={line.key} d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} /> })}</svg>
}

export function BoardSurface({ api, welcome }: { api: BoardApi; welcome?: ReactNode }) {
  const { board, data, project, plugins } = api
  const kind = findBoardKind(plugins, board.kind), free = kind.layout === 'free'
  const visible = board.zones.filter(zone => !zone.hidden), hidden = board.zones.filter(zone => zone.hidden)
  const external = useConnectionThings(project.id, [...new Set(board.zones.flatMap(zone => zone.source.kind === 'connection' ? [zone.source.connectionId] : []))])
  const [drag, setDrag] = useState<{ id: string; box: Box } | null>(null), surface = useRef<HTMLDivElement>(null)
  const things = useMemo(() => Object.fromEntries(board.zones.map(zone => [zone.id, thingsOfZone(data, project.id, zone, external.items)])), [board.zones, data, project.id, external.items])
  const boxes = useMemo(() => Object.fromEntries(visible.map(zone => [zone.id, drag?.id === zone.id ? drag.box : { x: zone.x, y: zone.y, w: zone.w, h: zone.collapsed ? 2 : zone.h }])), [visible, drag])
  const outline: Outline = useMemo(() => ({ archived: data.materials.filter(item => item.projectId === project.id && item.archived).length, boards: data.boards.filter(item => item.projectId === project.id).map(item => ({ id: item.id, name: item.name, active: item.id === board.id, zones: item.zones.filter(zone => zone.source.kind !== 'outline').map(zone => ({ id: zone.id, name: zone.name, color: zone.color, icon: zone.icon, hidden: zone.hidden, count: item.id === board.id ? things[zone.id]?.length || 0 : thingsOfZone(data, project.id, zone, {}).length })) })) }), [data, project.id, board.id, things])

  useEffect(() => { surface.current?.scrollTo(0, 0) }, [board.id])
  // Dragging a zone by its header, or its corner to resize. The position snaps
  // to the grid and is saved once, when the pointer is released.
  const track = (event: ReactPointerEvent, zone: Zone, mode: 'move' | 'size') => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,a')) return
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY }, origin = { x: zone.x, y: zone.y, w: zone.w, h: zone.h }
    let box = origin, moved = false
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - start.x) / CELL), dy = Math.round((ev.clientY - start.y) / CELL)
      if (!dx && !dy && !moved) return
      moved = true
      box = mode === 'move' ? { ...origin, x: Math.max(0, origin.x + dx), y: Math.max(0, origin.y + dy) } : { ...origin, w: Math.max(9, Math.min(120, origin.w + dx)), h: Math.max(4, Math.min(160, origin.h + dy)) }
      setDrag({ id: zone.id, box })
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      if (!moved) { setDrag(null); return }
      void api.mutate({ action: 'zone-layout', boardId: board.id, zones: [{ id: zone.id, ...box }] }).catch(() => {}).finally(() => setDrag(null))
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  // In a board that arranges zones itself, dragging changes the order instead.
  const [reorder, setReorder] = useState<string | null>(null)
  const dropBefore = (targetId: string) => { if (!reorder || reorder === targetId) return; const order = board.zones.map(zone => zone.id).filter(id => id !== reorder); order.splice(order.indexOf(targetId), 0, reorder); setReorder(null); void api.mutate({ action: 'zone-layout', boardId: board.id, zones: [], order }).catch(() => {}) }
  // Dragging the empty surface pans it.
  const pan = (event: ReactPointerEvent) => {
    if (event.button !== 0 || event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains('bd-canvas')) return
    const el = surface.current!, start = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
    const move = (ev: PointerEvent) => { el.scrollLeft = start.left - (ev.clientX - start.x); el.scrollTop = start.top - (ev.clientY - start.y) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); el.classList.remove('panning') }
    el.classList.add('panning'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const width = Math.max(0, ...Object.values(boxes).map(box => box.x + box.w)) * CELL + 120, height = Math.max(0, ...Object.values(boxes).map(box => box.y + box.h)) * CELL + 160
  const cards = visible.map(zone => {
    const source = zone.source.kind === 'connection' ? external.items[zone.source.connectionId] : undefined, box = boxes[zone.id]
    const dim = !!api.query && zone.source.kind !== 'outline' && !things[zone.id].some(thing => matches(thing, api.query))
    const common = { zone, board, api, things: things[zone.id], error: source?.error, loading: source?.loading && !source.things.length, outline, dim }
    if (free) return <ZoneCard key={zone.id} {...common} box={box} dragging={drag?.id === zone.id} style={{ left: box.x * CELL, top: box.y * CELL, width: box.w * CELL, height: box.h * CELL }} onGrab={event => track(event, zone, 'move')} onResize={event => { event.stopPropagation(); track(event, zone, 'size') }} />
    return <div key={zone.id} className={'bd-slot' + (reorder === zone.id ? ' moving' : '')} draggable onDragStart={event => { if ((event.target as HTMLElement).closest('.bd-zone-body')) { event.preventDefault(); return } event.dataTransfer.setData('text/devspace-zone', zone.id); event.dataTransfer.effectAllowed = 'move'; setReorder(zone.id) }} onDragEnd={() => setReorder(null)} onDragOver={event => { if (event.dataTransfer.types.includes('text/devspace-zone')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.types.includes('text/devspace-zone')) { event.preventDefault(); dropBefore(zone.id) } }}><ZoneCard {...common} box={{ ...box, w: 16, h: Math.min(box.h, 22) }} /></div>
  })
  return <div className={`bd-surface bg-${kind.look.background || 'dots'} zone-${kind.look.zone || 'card'} density-${kind.look.density || 'cozy'} layout-${kind.layout}`} ref={surface} onPointerDown={pan} style={kind.look.accent ? { '--bd-accent': kind.look.accent } as CSSProperties : undefined}>
    {!board.zones.length ? <div className="bd-blank"><h2>На этой доске пока пусто</h2><p>Доска состоит из зон. Зона — это группа вещей с вашим названием: заметки, картинки, модели, документы или задачи.</p><p className="ds-muted">Нажмите «Добавить» вверху: создайте зону или опишите словами, что хотите здесь видеть.</p></div>
      : free ? <div className="bd-canvas" style={{ width, height }}>{kind.links && <Links zones={visible} boxes={boxes} things={things} data={data} />}{cards}</div>
      : <div className="bd-flow">{cards}</div>}
    {welcome}
    {hidden.length > 0 && <footer className="bd-shelf" aria-label="Скрытые зоны"><span>Скрыто</span>{hidden.map(zone => <button type="button" key={zone.id} title="Вернуть на доску" onClick={() => void api.mutate({ action: 'zone-update', boardId: board.id, zoneId: zone.id, hidden: false }).catch(() => {})}><i style={{ background: zone.color || 'var(--ds-faint)' }} />{zone.name}<small>{things[zone.id]?.length || ''}</small></button>)}</footer>}
  </div>
}

// One zone up close: the same view at full size, with a place to add things.
export function ZoneDesk({ api, zone, back }: { api: BoardApi; zone: Zone; back: () => void }) {
  const { board, data, project, plugins } = api
  const external = useConnectionThings(project.id, zone.source.kind === 'connection' ? [zone.source.connectionId] : [])
  const things = thingsOfZone(data, project.id, zone, external.items), shown = things.filter(thing => matches(thing, api.query))
  const found = findView(plugins, zone.view), source = zone.source.kind === 'connection' ? external.items[zone.source.connectionId] : undefined
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), fileInput = useRef<HTMLInputElement>(null)
  const topicId = zone.source.kind === 'topic' && zone.source.topicId !== 'all' ? zone.source.topicId : 'unfiled'
  const canWrite = zone.source.kind === 'topic' || zone.source.kind === 'refs', canTask = zone.source.kind === 'tasks'
  const add = async (files: File[] = []) => {
    if (busy || !text.trim() && !files.length) return
    setBusy(true)
    try {
      if (canTask) await api.mutate({ action: 'create-task', projectId: project.id, title: text.trim() })
      else await api.mutate({ action: 'create-material', projectId: project.id, topicId, text: text.trim(), files: await Promise.all(files.map(uploadSpaceFile)), boardId: board.id, zoneId: zone.id })
      setText('')
    } catch (error) { api.notify((error as Error).message) } finally { setBusy(false) }
  }
  return <div className="bd-desk" onDragOver={event => { if (canWrite && event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (canWrite && event.dataTransfer.files.length) { event.preventDefault(); void add([...event.dataTransfer.files]) } }}>
    <header className="bd-crumbs">
      <button type="button" onClick={back} title="К доске · Alt+←"><Icon name="back" size={14} />{board.name}</button><b>/</b>
      <i className="bd-dot" style={{ background: zone.color || 'var(--ds-faint)' }} />{zone.icon && <TopicIcon value={zone.icon} size={16} />}<h1>{zone.name}</h1><small>{things.length || ''}</small>
      <span className="bd-fill" />
      <label className="bd-select"><span>Вид</span><select aria-label="Вид зоны" value={zone.view} onChange={event => void api.mutate({ action: 'zone-update', boardId: board.id, zoneId: zone.id, view: event.target.value }).catch(() => {})}>{viewsFor(plugins, things, zone).map(item => <option key={item.ref} value={item.ref}>{item.title}{item.builtin ? '' : ' · ' + item.plugin}</option>)}{found.missing && <option value={zone.view}>{zone.view} (удалён)</option>}</select></label>
      {source && <button type="button" className="ds-icon" aria-label="Обновить" title="Обновить из сервиса" onClick={external.reload}><Icon name="refresh" size={14} /></button>}
    </header>
    <div className="bd-desk-body">
      <p className="bd-source">{sourceLabel(zone.source, project, plugins)}</p>
      {source?.error ? <p className="bd-note warn">{source.error}</p> : !things.length && !source?.loading ? <div className="ds-empty"><h2>В зоне пока пусто</h2><p>{canWrite ? 'Напишите заметку внизу, вставьте или перетащите файл.' : canTask ? 'Добавьте первую задачу внизу.' : 'Здесь появятся вещи из источника зоны.'}</p></div>
        : <ZoneView view={found.view} pluginId={found.pluginId} things={shown} viewBase={plugins.viewBase} zoneName={zone.name} open={thing => api.openThing(thing, zone)} setStatus={(thing, group) => void changeStatus(api, thing, group)} selected={api.selected} toggle={api.toggle} />}
    </div>
    {(canWrite || canTask) && <form className="bd-add" onSubmit={event => { event.preventDefault(); void add() }}>
      <input value={text} onChange={event => setText(event.target.value)} placeholder={canTask ? 'Новая задача…' : 'Заметка в зону «' + zone.name + '»…'} aria-label={canTask ? 'Новая задача' : 'Новая заметка'} onPaste={event => { const files = [...event.clipboardData.files]; if (canWrite && files.length) { event.preventDefault(); void add(files) } }} />
      {canWrite && <><input ref={fileInput} type="file" multiple hidden onChange={event => { void add([...event.target.files || []]); event.target.value = '' }} /><button type="button" className="ds-icon" aria-label="Прикрепить файл" title="Файл или изображение" onClick={() => fileInput.current?.click()}><Icon name="attach" size={15} /></button></>}
      <button className="ds-primary" disabled={busy || !text.trim()}>Добавить</button>
    </form>}
  </div>
}
