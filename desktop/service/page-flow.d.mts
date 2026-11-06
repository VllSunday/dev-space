import type { Page, Project, PageNode, Block } from '../../src/devspace/model'
export function pageFlow(page:Page,project:Project):PageNode[]
export function reconcileFlow(flow:PageNode[]|undefined,previous:Block[],next:Block[]):PageNode[]|undefined
export function validateFlow(value:unknown,page:Page,project:Project):PageNode[]
