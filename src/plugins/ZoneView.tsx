import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { contentUrl } from '../desktop/client'
import { Icon, TopicIcon } from '../desktop/Icons'
import type { Part, PluginView, Thing } from './types'
import type { StatusGroup } from '../../desktop/service/things.mjs'
import { kindNames, statusGroupNames } from '../../desktop/service/things.mjs'
import './views.css'

// Shows the things of a zone through a plugin view. A view is either a short
// record of ready parts (no code), the plugin's own HTML in a sandbox, or one of
// the app's own components. Views never fetch anything themselves: they get
// things of one shape and may ask only for the actions their manifest lists.
export interface Outline { boards: { id: string; name: string; active: boolean; zones: { id: string; name: string; color?: string | null; icon?: string; count: number; hidden?: boolean }[] }[]; archived: number }
export interface ViewHandlers {
  open: (thing: Thing) => void
  setStatus?: (thing: Thing, group: StatusGroup) => void
  toggle?: (thing: Thing) => void
  selected?: Set<string>
  openZone?: (boardId: string, zoneId: string) => void
  openArchive?: () => void
}
interface Props extends ViewHandlers { view: PluginView; pluginId: string; things: Thing[]; compact?: boolean; limit?: number; viewBase: string; zoneName: string; outline?: Outline; more?: () => void }

export const kindIcon: Record<string, string> = { note: 'note', image: 'image', file: 'files', link: 'link', model: 'cube', page: 'book', task: 'check', external: 'mcp' }
const fieldOf = (thing: Thing, field: string) => field === 'kind' ? kindNames[thing.kind] : field === 'updated' ? (thing.updated || '').slice(0, 10) : field === 'statusGroup' ? (thing.statusGroup ? statusGroupNames[thing.statusGroup] : '') : String((thing as unknown as Record<string, unknown>)[field] ?? '')
const fieldValue = (thing: Thing, field: string) => String((thing as unknown as Record<string, unknown>)[field] ?? '')

function Preview({ thing }: { thing: Thing }) {
  if (thing.image) return <img src={contentUrl('/' + thing.image)} alt="" loading="lazy" draggable={false} />
  if (thing.kind === 'model') return <span className="pv-model"><Icon name="cube" size={30} /><b>GLB</b></span>
  if (thing.kind === 'page') return <span className="pv-page">{thing.icon ? <TopicIcon value={thing.icon} size={22} /> : <Icon name="book" size={22} />}<small>{thing.text.slice(0, 90)}</small></span>
  return <span className="pv-note"><small>{thing.text.slice(0, 160) || kindNames[thing.kind]}</small></span>
}
// A card can be carried to another zone; the zone decides what that means.
const carry = (event: React.DragEvent, thing: Thing) => { event.dataTransfer.setData('text/devspace-thing', thing.ref); event.dataTransfer.effectAllowed = 'move' }
function Card({ thing, handlers, children, className = '' }: { thing: Thing; handlers: ViewHandlers; children: ReactNode; className?: string }) {
  const picked = handlers.selected?.has(thing.ref)
  return <div className={`pv-item ${className}${picked ? ' picked' : ''}`} data-ref={thing.ref} draggable={!thing.external} onDragStart={event => carry(event, thing)}>
    <button type="button" className="pv-open" onClick={event => { if ((event.ctrlKey || event.metaKey) && handlers.toggle) handlers.toggle(thing); else handlers.open(thing) }} title={thing.title}>{children}</button>
    {handlers.toggle && <label className="pv-pick" title="Выбрать"><input type="checkbox" checked={!!picked} onChange={() => handlers.toggle!(thing)} aria-label={'Выбрать: ' + thing.title} /></label>}
  </div>
}
const canStatus = (view: PluginView, thing: Thing, handlers: ViewHandlers) => !!handlers.setStatus && view.actions.includes('thing.status') && thing.statusGroup !== undefined

function List({ part, view, things, handlers }: { part: Extract<Part, { part: 'list' }>; view: PluginView; things: Thing[]; handlers: ViewHandlers }) {
  return <div className="pv-list">{things.map(thing => <div className={'pv-row' + (thing.statusGroup === 'done' ? ' done' : '') + (handlers.selected?.has(thing.ref) ? ' picked' : '')} key={thing.ref} data-ref={thing.ref} draggable={!thing.external} onDragStart={event => carry(event, thing)}>
    {canStatus(view, thing, handlers)
      ? <input type="checkbox" checked={thing.statusGroup === 'done'} onChange={event => handlers.setStatus!(thing, event.target.checked ? 'done' : 'todo')} aria-label={'Готово: ' + thing.title} />
      : handlers.toggle ? <label className="pv-pick inline"><input type="checkbox" checked={!!handlers.selected?.has(thing.ref)} onChange={() => handlers.toggle!(thing)} aria-label={'Выбрать: ' + thing.title} /><Icon name={kindIcon[thing.kind]} size={14} /></label> : <Icon name={kindIcon[thing.kind]} size={14} />}
    <button type="button" className="pv-open" onClick={() => handlers.open(thing)} title={thing.title}>{thing.key && <code>{thing.key}</code>}<b>{thing.title}</b>{!part.fields && thing.text && thing.kind !== 'task' && <small>{thing.text.split('\n')[0].slice(0, 140)}</small>}</button>
    {(part.fields || []).map(field => fieldOf(thing, field) && <span className={'pv-chip' + (field === 'status' ? ' st-' + thing.statusGroup : '')} key={field}>{fieldOf(thing, field)}</span>)}
  </div>)}</div>
}
function Tiles({ part, things, handlers, gallery }: { part?: Extract<Part, { part: 'tiles' }>; things: Thing[]; handlers: ViewHandlers; gallery?: boolean }) {
  return <div className={'pv-tiles' + (gallery ? ' gallery' : '')} style={part?.columns ? { gridTemplateColumns: `repeat(${part.columns}, minmax(0, 1fr))` } : undefined}>{things.map(thing => <Card thing={thing} handlers={handlers} key={thing.ref} className="pv-tile">
    <span className="pv-thumb"><Preview thing={thing} /></span>{!gallery && <span className="pv-caption">{thing.title}</span>}
  </Card>)}</div>
}
function Columns({ part, view, things, handlers }: { part: Extract<Part, { part: 'columns' }>; view: PluginView; things: Thing[]; handlers: ViewHandlers }) {
  const [over, setOver] = useState('')
  const columns = part.columns || [...new Set(things.map(thing => fieldValue(thing, part.by)))].map(value => ({ value, title: value || 'Без значения' }))
  const movable = part.by === 'statusGroup' && view.actions.includes('thing.status') && !!handlers.setStatus
  return <div className="pv-columns" style={{ gridTemplateColumns: `repeat(${columns.length || 1}, minmax(0, 1fr))` }}>{columns.map(column => {
    const items = things.filter(thing => fieldValue(thing, part.by) === column.value)
    return <section key={column.value} className={over === column.value ? 'over' : ''}
      onDragOver={event => { if (movable && event.dataTransfer.types.includes('text/devspace-thing')) { event.preventDefault(); setOver(column.value) } }} onDragLeave={() => setOver('')}
      onDrop={event => { setOver(''); const thing = things.find(item => item.ref === event.dataTransfer.getData('text/devspace-thing')); if (thing) event.stopPropagation(); if (thing && movable && thing.statusGroup !== column.value) { event.preventDefault(); handlers.setStatus!(thing, column.value as StatusGroup) } }}>
      <header><span>{column.title}</span><small>{items.length}</small></header>
      {items.map(thing => <div className={'pv-kcard' + (column.value === 'done' ? ' done' : '')} key={thing.ref} data-ref={thing.ref} draggable={movable && thing.statusGroup !== undefined} onDragStart={event => { event.dataTransfer.setData('text/devspace-thing', thing.ref); event.dataTransfer.effectAllowed = 'move' }}>
        <button type="button" className="pv-open" onClick={() => handlers.open(thing)} title={thing.title}>{thing.key && <code>{thing.key}</code>}<b>{thing.title}</b>{thing.assignee && <small>{thing.assignee}</small>}</button>
        {movable && <span className="pv-move">{columns.filter(item => item.value !== column.value).map(item => <button type="button" key={item.value} title={'Перенести: ' + item.title} aria-label={`${thing.title}: перенести в «${item.title}»`} onClick={() => handlers.setStatus!(thing, item.value as StatusGroup)}>{item.title}</button>)}</span>}
      </div>)}
    </section>
  })}</div>
}
function Table({ part, things, handlers }: { part: Extract<Part, { part: 'table' }>; things: Thing[]; handlers: ViewHandlers }) {
  return <div className="pv-table"><table><thead><tr>{part.columns.map(column => <th key={column.field}>{column.title}</th>)}</tr></thead><tbody>{things.map(thing => <tr key={thing.ref} data-ref={thing.ref} onClick={() => handlers.open(thing)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') handlers.open(thing) }}>
    {part.columns.map(column => <td key={column.field} className={column.field === 'title' ? 'main' : ''}>{column.field === 'status' ? <span className={'pv-chip st-' + thing.statusGroup}>{fieldOf(thing, 'status')}</span> : column.field === 'key' ? <code>{fieldOf(thing, 'key')}</code> : fieldOf(thing, column.field)}</td>)}
  </tr>)}</tbody></table></div>
}
function Counter({ part, things }: { part: Extract<Part, { part: 'counter' }>; things: Thing[] }) {
  return <div className="pv-counter">{part.counters.map(counter => <div key={counter.title}><b>{counter.where ? things.filter(thing => fieldValue(thing, counter.where!.field) === counter.where!.equals).length : things.length}</b><span>{counter.title}</span></div>)}</div>
}
export function OutlineView({ outline, handlers }: { outline?: Outline; handlers: ViewHandlers }) {
  if (!outline) return null
  return <div className="pv-outline">{outline.boards.map(board => <section key={board.id}><h4>{board.name}</h4>{board.zones.map(zone => <button type="button" key={zone.id} className={zone.hidden ? 'hidden' : ''} onClick={() => handlers.openZone?.(board.id, zone.id)}><i style={{ background: zone.color || 'var(--ds-faint)' }} />{zone.icon && <TopicIcon value={zone.icon} size={13} />}<span>{zone.name}</span><small>{zone.count || ''}</small></button>)}</section>)}
    <button type="button" onClick={() => handlers.openArchive?.()}><Icon name="history" size={13} /><span>Архив</span><small>{outline.archived || ''}</small></button></div>
}

// A view with its own code. The page comes from a separate origin under a
// sandbox policy; it can only exchange messages with this frame.
function Sandbox({ pluginId, view, things, zoneName, viewBase, handlers }: { pluginId: string; view: PluginView; things: Thing[]; zoneName: string; viewBase: string; handlers: ViewHandlers }) {
  const frame = useRef<HTMLIFrameElement>(null), [height, setHeight] = useState(160), ready = useRef(false)
  const latest = useRef({ things, handlers, view }); latest.current = { things, handlers, view }
  const post = () => {
    const style = getComputedStyle(document.documentElement), theme: Record<string, string> = {}
    for (const name of ['--ds-text', '--ds-muted', '--ds-faint', '--ds-border', '--ds-accent', '--ds-surface', '--ds-canvas', '--ds-good', '--ds-warning']) theme[name] = style.getPropertyValue(name)
    theme['--ds-font'] = getComputedStyle(document.body).fontFamily
    frame.current?.contentWindow?.postMessage({ type: 'devspace:data', zone: { name: zoneName }, things: latest.current.things.map(thing => ({ ...thing, paths: undefined })), theme }, '*')
  }
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const { type, action, ref, height: wanted, status } = event.data as { type?: string; action?: string; ref?: string; height?: number; status?: string }
      if (type === 'devspace:ready') { ready.current = true; post() }
      else if (type === 'devspace:size' && Number.isFinite(wanted)) setHeight(Math.max(60, Math.min(1600, Math.round(wanted!))))
      else if (type === 'devspace:action' && latest.current.view.actions.includes(String(action))) {
        // Only actions the manifest lists, and only on things this view was given.
        const thing = latest.current.things.find(item => item.ref === ref); if (!thing) return
        if (action === 'thing.open') latest.current.handlers.open(thing)
        if (action === 'thing.status' && ['todo', 'doing', 'done'].includes(String(status))) latest.current.handlers.setStatus?.(thing, status as StatusGroup)
      }
    }
    window.addEventListener('message', listen); return () => window.removeEventListener('message', listen)
  }, [])
  useEffect(() => { if (ready.current) post() }, [things])
  if (!viewBase) return null
  return <iframe ref={frame} className="pv-sandbox" title={view.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`${viewBase}/${pluginId}/${view.id}`} style={{ height }} />
}

export default function ZoneView({ view, pluginId, things, compact = false, limit, viewBase, zoneName, outline, more, ...handlers }: Props) {
  const shown = limit ? things.slice(0, limit) : things, rest = things.length - shown.length
  if (view.render.type === 'code') return <Sandbox pluginId={pluginId} view={view} things={things} zoneName={zoneName} viewBase={viewBase} handlers={handlers} />
  const parts: Part[] = view.render.type === 'parts' ? view.render.parts : [{ part: 'list' }]
  return <div className={'pv' + (compact ? ' compact' : '')}>
    {parts.map((part, index) => part.part === 'list' ? <List key={index} part={part} view={view} things={shown} handlers={handlers} />
      : part.part === 'tiles' ? <Tiles key={index} part={part} things={shown} handlers={handlers} />
      : part.part === 'gallery' ? <Tiles key={index} things={shown.filter(thing => thing.image)} handlers={handlers} gallery />
      : part.part === 'columns' ? <Columns key={index} part={part} view={view} things={things} handlers={handlers} />
      : part.part === 'table' ? <Table key={index} part={part} things={shown} handlers={handlers} />
      : part.part === 'counter' ? <Counter key={index} part={part} things={things} />
      : <OutlineView key={index} outline={outline} handlers={handlers} />)}
    {rest > 0 && more && <button type="button" className="pv-more" onClick={more}>Ещё {rest} <Icon name="arrow" size={12} /></button>}
  </div>
}
