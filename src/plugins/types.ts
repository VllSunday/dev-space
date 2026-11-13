import type { Thing } from '../../desktop/service/things.mjs'

export type Part =
  | { part: 'list'; fields?: string[] }
  | { part: 'tiles'; columns?: number }
  | { part: 'gallery' }
  | { part: 'columns'; by: string; columns?: { value: string; title: string }[] }
  | { part: 'table'; columns: { field: string; title: string }[] }
  | { part: 'counter'; counters: { title: string; where?: { field: string; equals: string } }[] }
  | { part: 'outline' }
export type Render = { type: 'parts'; parts: Part[] } | { type: 'code'; entry: string; hosts?: string[] } | { type: 'native'; component: string }
export interface PluginView { id: string; title: string; description?: string; level: 'zone' | 'thing'; accepts: string[]; actions: string[]; render: Render }
export interface BoardKind { id: string; title: string; description?: string; layout: 'free' | 'columns'; links: boolean; look: { background?: 'dots' | 'grid' | 'plain'; zone?: 'card' | 'outline' | 'flat'; density?: 'cozy' | 'compact'; accent?: string } }
export interface PluginPermissions { reads: string[]; changes: string[]; network: string[]; code: boolean; keys: string[]; never: string[]; roles: string[] }
export interface PluginInfo {
  id: string; name: string; version: string; description: string; author?: string; homepage?: string
  views: PluginView[]; boards: BoardKind[]; connections: { id: string; title: string }[]; blocks: { id: string; title: string; summary?: string; base: string }[]; flows: string[]; instructions: string[]
  origin: 'builtin' | 'installed' | 'catalog' | 'draft' | 'folder' | 'git'; source: string | null; commit: string | null; installedAt: string | null; error: string | null
  permissions: PluginPermissions; contents: { kind: string; title: string; where: string; how: string }[]
}
export interface PluginDraft { id: string; request: string; sample: { things?: Thing[] } | null; plugin?: PluginInfo; error?: string }
export interface ConnectionInfo {
  id: string; pluginId: string; pluginName: string; title: string; description: string; hosts: string[]; role: string | null; roleTitle: string | null; statuses: Record<string, string>
  settings: { id: string; title: string; placeholder?: string; required?: boolean; value: string }[]
  auth: { label: string; help: string; saved: boolean } | null
  operations: { name: string; kind: 'read' | 'event' | 'action'; title: string; role: string | null }[]
  ready: boolean; missing: string[]
}
export interface RoleInfo { id: string; version: number; title: string; description: string; fields: { id: string; title: string; type: string }[]; operations: Record<string, { kind: 'read' | 'event' | 'action'; title: string; required?: boolean; note?: string }> }
export interface PluginsState { plugins: PluginInfo[]; catalog: PluginInfo[]; drafts: PluginDraft[]; connections: ConnectionInfo[]; roles: RoleInfo[]; viewBase: string }
export interface Inspection { ticket: string; origin: { type: string; value: string; commit?: string }; replaces: string | null; plugin: PluginInfo }
export type { Thing }
