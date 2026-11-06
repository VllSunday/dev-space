import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {sessionSpaceId} from './agent-space-model.mjs';
export {sessionSpaceId} from './agent-space-model.mjs';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const title=(value,max=100)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw fail('Введите корректное название.');return value.trim()};
const color=value=>{if(!value)return null;if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw fail('Некорректный цвет спейса.');return value.toLowerCase()};
const group=value=>value?title(value,60):null;
async function folder(value){if(typeof value!=='string'||!value.trim())throw fail('Укажите локальную рабочую папку.');const result=path.resolve(value);if(!(await stat(result).catch(()=>null))?.isDirectory())throw fail('Выберите существующую локальную папку.');return result}
export function initializeAgentSpaces(settings,repo,sessions=[]){
 const firstSetup=!Array.isArray(settings.agentSpaces)||!settings.agentSpaces.length;
 if(firstSetup)settings.agentSpaces=[{id:'local',name:'Этот компьютер',cwd:repo,color:null,group:null}];
 settings.agentSessionSpaces||={};settings.agentSpaceLayouts||={};settings.collapsedAgentSpaceGroups||=[];
 if(firstSetup&&!settings.agentSpaceLayouts.local){
  const legacy=settings.agentLayouts?.[settings.spaceLayout?.projectId]||Object.values(settings.agentLayouts||{})[0];
  if(legacy)settings.agentSpaceLayouts.local=structuredClone(legacy);
 }
 for(const session of sessions)settings.agentSessionSpaces[session.id]=sessionSpaceId(settings,session.id);
 if(!settings.agentSpaces.some(s=>s.id===settings.selectedAgentSpaceId))settings.selectedAgentSpaceId=settings.agentSpaces[0].id;
}
export function agentSpacesSnapshot(settings){return {spaces:settings.agentSpaces,assignments:settings.agentSessionSpaces,selectedId:settings.selectedAgentSpaceId,collapsedGroups:settings.collapsedAgentSpaceGroups}}
export async function changeAgentSpaces(settings,data,sessions,{closeSessions}={}){
 const spaces=settings.agentSpaces.map(s=>({...s})),at=spaces.findIndex(s=>s.id===data.id),target=spaces[at];
 if(data.action==='create'){
  if(spaces.length>=200)throw fail('Можно создать до 200 локальных спейсов.');
  spaces.push({id:'agent-space-'+randomUUID().slice(0,12),name:title(data.name),cwd:await folder(data.cwd),color:color(data.color),group:group(data.group)});
 }else if(data.action==='update'){
  if(!target)throw fail('Спейс не найден.',404);
  if(data.name!==undefined)target.name=title(data.name);
  if(data.cwd!==undefined)target.cwd=await folder(data.cwd);
  if(data.color!==undefined)target.color=color(data.color);
  if(data.group!==undefined)target.group=group(data.group);
 }else if(data.action==='delete'){
  if(!target)throw fail('Спейс не найден.',404);
  if(spaces.length===1)throw fail('Нужен хотя бы один спейс. Сначала создайте другой.');
  const agentAction=data.agentAction??'move';
  if(!['move','close'].includes(agentAction))throw fail('Выберите, что сделать с агентами.');
  const destination=agentAction==='close'?spaces.find(s=>s.id!==target.id):spaces.find(s=>s.id===data.destinationId&&s.id!==target.id);
  if(!destination)throw fail('Выберите другой спейс для сохранения агентов.');
  const assignments={...settings.agentSessionSpaces};
  const owned=sessions.filter(session=>sessionSpaceId(settings,session.id)===target.id);
  if(agentAction==='close'){
   const open=owned.filter(s=>s.open||['starting','running'].includes(s.status)).map(s=>s.id);
   if(open.length){if(!closeSessions)throw fail('Закрытие агентов недоступно.',503);await closeSessions(open)}
   // Closed chats stay in history, rather than being assigned to another space.
   for(const session of owned)delete assignments[session.id];
   for(const [id,owner] of Object.entries(assignments))if(owner===target.id)delete assignments[id];
  }else{
   // Include closed and legacy sessions; only their grouping changes, never the process or history.
   for(const session of owned)assignments[session.id]=destination.id;
   for(const [id,owner] of Object.entries(assignments))if(owner===target.id)assignments[id]=destination.id;
  }
  spaces.splice(at,1);
  const layouts={...settings.agentSpaceLayouts};delete layouts[target.id];
  settings.agentSessionSpaces=assignments;settings.agentSpaceLayouts=layouts;
  if(settings.selectedAgentSpaceId===target.id)settings.selectedAgentSpaceId=destination.id;
  settings.collapsedAgentSpaceGroups=(settings.collapsedAgentSpaceGroups||[]).filter(name=>spaces.some(s=>s.group===name));
 }else if(data.action==='select'){
  if(!target)throw fail('Спейс не найден.',404);settings.selectedAgentSpaceId=target.id;
 }else if(data.action==='assign'){
  if(!sessions.some(s=>s.id===data.sessionId)||!spaces.some(s=>s.id===data.spaceId))throw fail('Агент или спейс не найден.',404);
  settings.agentSessionSpaces={...settings.agentSessionSpaces,[data.sessionId]:data.spaceId};
 }else if(data.action==='rename-group'){
  const before=title(data.name,60),after=group(data.newName);
  for(const space of spaces)if(space.group===before)space.group=after;
  settings.collapsedAgentSpaceGroups=(settings.collapsedAgentSpaceGroups||[]).filter(n=>n!==before);
 }else if(data.action==='collapse-group'){
  if(typeof data.collapsed!=='boolean')throw fail('Укажите состояние группы.');
  const name=title(data.name,60),next=new Set(settings.collapsedAgentSpaceGroups||[]);if(data.collapsed)next.add(name);else next.delete(name);settings.collapsedAgentSpaceGroups=[...next];
 }else if(data.action==='reorder'){
  if(!target)throw fail('Спейс не найден.',404);
  if(data.id===data.beforeId)return agentSpacesSnapshot(settings);
  const before=spaces.findIndex(s=>s.id===data.beforeId);if(!target||before<0)throw fail('Спейс не найден.');const moved=spaces.splice(at,1)[0];spaces.splice(spaces.findIndex(s=>s.id===data.beforeId),0,moved);
 }else throw fail('Неизвестное действие со спейсом.');
 settings.agentSpaces=spaces;
 return agentSpacesSnapshot(settings);
}
