import type { Material, Page, SpaceState, Task, Zone } from '../../src/devspace/model'
export type StatusGroup = 'todo' | 'doing' | 'done'
export type ThingKind = 'note' | 'image' | 'file' | 'link' | 'model' | 'page' | 'task' | 'external'
export interface Thing {
  ref: string; id: string; kind: ThingKind; title: string; text: string
  image?: string; model?: string; icon?: string; files?: number; topicId?: string
  status?: string; statusGroup?: StatusGroup; key?: string; url?: string; assignee?: string
  updated?: string; created?: string; archived?: boolean; sourceId?: string; external?: string; paths?: string[]
}
export const statusGroups: StatusGroup[]
export const statusGroupNames: Record<StatusGroup, string>
export const taskStatusNames: Record<Task['status'], string>
export const kindNames: Record<ThingKind, string>
export function taskStatusGroup(status: string): StatusGroup
export function materialKind(material: Material): ThingKind
export function materialThing(material: Material): Thing
export function pageThing(page: Page): Thing
export function taskThing(task: Task): Thing
export function thingByRef(state: SpaceState, ref: string): Thing | undefined
export function zoneThings(state: SpaceState, projectId: string, zone: Zone, external?: Thing[]): Thing[]
export function plainText(value: unknown, max?: number): string
