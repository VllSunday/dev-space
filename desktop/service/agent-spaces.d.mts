import type {Settings,ChatSession,AgentSpace} from '../../src/desktop/types'
export function initializeAgentSpaces(settings:Settings,repo:string,sessions?:ChatSession[]):void
export function sessionSpaceId(settings:Settings,sessionId:string):string
export function agentSpacesSnapshot(settings:Settings):{spaces:AgentSpace[];assignments:Record<string,string>;selectedId:string;collapsedGroups:string[]}
export function changeAgentSpaces(settings:Settings,data:Record<string,unknown>,sessions:ChatSession[],options?:{closeSessions?:(ids:string[])=>Promise<void>}):Promise<ReturnType<typeof agentSpacesSnapshot>>
