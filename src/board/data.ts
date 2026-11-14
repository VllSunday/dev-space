import { useCallback, useEffect, useRef, useState } from 'react'
import { api, onServiceEvent } from '../desktop/client'
import type { PluginsState, PluginView, BoardKind, Thing } from '../plugins/types'
import type { FlowsState, FlowRun } from '../flows/types'
import type { SpaceState, Zone } from '../devspace/model'
import { zoneThings } from '../../desktop/service/things.mjs'

const emptyPlugins: PluginsState = { plugins: [], catalog: [], drafts: [], connections: [], roles: [], viewBase: '' }
const emptyFlows: FlowsState = { flows: [], drafts: [], blocks: [], runs: [], reference: '', commands: [] }

// Installed plugins, their views and connections. Reloads when a plugin is
// installed, removed or configured.
export function usePlugins() {
  const [state, setState] = useState(emptyPlugins)
  const reload = useCallback(() => api<PluginsState>('/plugins').then(setState).catch(() => {}), [])
  useEffect(() => { void reload(); let timer = 0; const off = onServiceEvent(event => { if (['plugins-changed', 'devspace-changed', 'flow-run'].includes(event.type)) { clearTimeout(timer); timer = window.setTimeout(() => void reload(), event.type === 'plugins-changed' ? 0 : 400) } }); return () => { clearTimeout(timer); off() } }, [reload])
  return { ...state, reload }
}
// The flow library and the runs. Runs arrive as events while a flow moves.
export function useFlows() {
  const [state, setState] = useState(emptyFlows)
  const reload = useCallback(() => api<FlowsState>('/flows').then(setState).catch(() => {}), [])
  useEffect(() => {
    void reload()
    return onServiceEvent(event => {
      if (event.type === 'flows-changed' || event.type === 'plugins-changed') void reload()
      if (event.type === 'flow-run' && event.run) { const run = event.run as FlowRun; setState(old => ({ ...old, runs: [run, ...old.runs.filter(item => item.id !== run.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })) }
    })
  }, [reload])
  return { ...state, reload }
}

const fallbackView: PluginView = { id: 'list', title: 'Список', level: 'zone', accepts: ['*'], actions: ['thing.open'], render: { type: 'parts', parts: [{ part: 'list' }] } }
// The view a zone asks for; a plain list if its plugin is gone.
export function findView(plugins: PluginsState, ref: string): { view: PluginView; pluginId: string; missing: boolean } {
  const [pluginId, viewId] = ref.split('/'), view = plugins.plugins.find(item => item.id === pluginId)?.views.find(item => item.id === viewId && item.level === 'zone')
  return view ? { view, pluginId, missing: false } : { view: fallbackView, pluginId: 'core', missing: plugins.plugins.length > 0 }
}
const freeBoard: BoardKind = { id: 'free', title: 'Свободная доска', layout: 'free', links: false, look: { background: 'dots', zone: 'card', density: 'cozy' } }
export function findBoardKind(plugins: PluginsState, ref: string): BoardKind {
  const [pluginId, kindId] = ref.split('/')
  return plugins.plugins.find(item => item.id === pluginId)?.boards.find(item => item.id === kindId) || freeBoard
}
// Views that fit what a zone holds, for the «Вид» list.
export function viewsFor(plugins: PluginsState, things: Thing[], zone: Zone) {
  const kinds = new Set(things.map(thing => thing.kind))
  if (zone.source.kind === 'tasks') kinds.add('task')
  if (zone.source.kind === 'pages') kinds.add('page')
  return plugins.plugins.flatMap(plugin => plugin.views.filter(view => view.level === 'zone' && (view.accepts.includes('*') || !kinds.size && zone.source.kind !== 'connection' || [...kinds].some(kind => view.accepts.includes(kind)))).map(view => ({ ref: `${plugin.id}/${view.id}`, title: view.title, plugin: plugin.name, builtin: plugin.origin === 'builtin' })))
}

interface External { things: Thing[]; error: string; loading: boolean }
// Things of connection zones, fetched through the service. The plugin's request
// runs there; this side only receives things of the usual shape.
export function useConnectionThings(projectId: string, connectionIds: string[]) {
  const [items, setItems] = useState<Record<string, External>>({})
  const key = connectionIds.slice().sort().join(','), version = useRef(0)
  const load = useCallback(() => {
    const run = ++version.current
    for (const id of key ? key.split(',') : []) {
      setItems(old => ({ ...old, [id]: { things: old[id]?.things || [], error: '', loading: true } }))
      api<{ items: Thing[] }>(`/connections/items?id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(projectId)}`)
        .then(value => { if (run === version.current) setItems(old => ({ ...old, [id]: { things: value.items, error: '', loading: false } })) })
        .catch(error => { if (run === version.current) setItems(old => ({ ...old, [id]: { things: [], error: (error as Error).message, loading: false } })) })
    }
  }, [key, projectId])
  useEffect(() => { load(); const timer = setInterval(load, 90000); const off = onServiceEvent(event => { if (event.type === 'plugins-changed') load() }); return () => { clearInterval(timer); off() } }, [load])
  return { items, reload: load }
}
export function thingsOfZone(state: SpaceState, projectId: string, zone: Zone, external: Record<string, External>): Thing[] {
  return zoneThings(state, projectId, zone, zone.source.kind === 'connection' ? external[zone.source.connectionId]?.things || [] : [])
}
export const matches = (thing: Thing, query: string) => !query || `${thing.title} ${thing.text} ${thing.key || ''} ${thing.status || ''}`.toLocaleLowerCase().includes(query)
