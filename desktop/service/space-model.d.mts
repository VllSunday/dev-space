import type { WorkspaceState, WorkspaceEntity, WorkspaceSpace } from '../../src/types';
export const defaultSpace: string;
export const workflowStates: readonly ['backlog', 'in-progress', 'review', 'blocked', 'done'];
export const priorities: readonly ['normal', 'low', 'high', 'urgent'];
export const testingSections: string[];
export function spacesOf(registry: WorkspaceState): WorkspaceSpace[];
export function spaceOf(entity: WorkspaceEntity): string;
export function workflowOf(entity: WorkspaceEntity): string;
