export interface BlockParam { type: 'role' | 'need' | 'text' | 'enum' | 'number' | 'step' | 'object'; title?: string; required?: boolean; values?: string[]; min?: number; max?: number; default?: string | number }
export interface BlockInfo { id: string; title: string; summary: string; plugin: string | null; base: string | null; agent: boolean; person: boolean; params: Record<string, BlockParam>; labels: Record<string, Record<string, string>>; outputs: { id: string; title: string; hint?: string }[] }
export interface FlowStep { block: string; title?: string; with: Record<string, unknown>; next: Record<string, string>; limit: Record<string, number> }
export interface Flow { flow: 1; id: string; name: string; description: string; roles: Record<string, { title: string; agent?: string }>; needs: Record<string, { role: string }>; limits: { handoffs?: number }; start: string; steps: Record<string, FlowStep> }
export interface FlowProblem { step: string | null; text: string }
export interface FlowEntry { id: string; origin: 'builtin' | 'user' | 'plugin' | 'draft'; plugin?: string; file: string; name: string; description?: string; flow: Flow | null; text: string; problems: FlowProblem[]; ok: boolean; order: string[]; editable?: boolean; changed?: boolean }
export interface RunProposal { kind: 'page' | 'plugin' | 'flow'; id: string; title: string }
export interface FlowRun {
  id: string; flowId: string; name: string; projectId: string; spaceId: string | null
  status: 'running' | 'waiting-person' | 'needs-person' | 'done' | 'stopped'; reason: string | null; canContinue: boolean; current: string | null
  item: { title: string; key: string | null; ref: string | null } | null
  steps: { id: string; title: string; block: string; kind: 'agent' | 'person' | 'code'; state: 'done' | 'current' | 'todo' }[]
  roles: Record<string, { title: string; sessionId: string | null; agent: string; active: boolean }>
  needs: Record<string, { connectionId: string; title: string }>
  person: { question: string; summary: string; proposal: RunProposal | null } | null
  outputs: { id: string; title: string }[]
  path: { step: string; title: string; output: string; summary: string; at: string }[]
  counters: { handoffs: number; edges: Record<string, number> }; limits: { handoffs?: number }
  parentId: string | null; children: string[]; createdAt: string; updatedAt: string
}
export interface FlowDecision { id: string; at: string; runId: string; kind: 'connection' | 'agent' | 'step' | 'call-person' | 'resolve' | 'outcome'; step: string | null; situation: string; options: string[]; choice: string; by: string; note?: string; policy: { name: string; version: string | number } }
export interface FlowsState { flows: FlowEntry[]; drafts: FlowEntry[]; blocks: BlockInfo[]; runs: FlowRun[]; reference: string; commands: { name: string; title: string }[] }
export const terminalNames: Record<string, string> = { '@done': 'Готово', '@stopped': 'Остановить', '@person': 'Позвать меня' }
export const runStatus: Record<FlowRun['status'], string> = { running: 'идёт', 'waiting-person': 'ждёт вас', 'needs-person': 'нужны вы', done: 'готово', stopped: 'остановлен' }
