export type Pane = { kind: 'pane'; id: string; tabs: string[]; selectedId: string | null };
export type PaneNode = Pane | { kind: 'split'; id: string; axis: 'row' | 'column'; ratio: number; first: PaneNode; second: PaneNode };
export interface PaneLayout { root: PaneNode; activePaneId: string; zoomedPaneId: string | null }
export type LayoutAction = { type: 'focus'; paneId: string; tabId?: string } | { type: 'move'; paneId: string; tabId: string } | { type: 'split'; paneId?: string; direction: 'left' | 'right' | 'top' | 'bottom'; newId: string; tabId?: string } | { type: 'close' | 'zoom'; paneId?: string } | { type: 'ratio'; splitId: string; ratio: number };
export const MAX_PANES: number;
export function panes(root: PaneNode): Pane[];
export function validateLayout(value: unknown): PaneLayout;
export function normalizeLayout(value: unknown, openIds: string[]): PaneLayout;
export function changeLayout(current: PaneLayout, action: LayoutAction): PaneLayout;
export function paneGeometry(root: PaneNode): { cells: ({ pane: Pane; x: number; y: number; width: number; height: number })[]; dividers: { id: string; axis: 'row' | 'column'; ratio: number; x: number; y: number; width: number; height: number }[] };
