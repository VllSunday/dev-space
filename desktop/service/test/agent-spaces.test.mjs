import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {initializeAgentSpaces,changeAgentSpaces,sessionSpaceId} from '../agent-spaces.mjs';
import {createService} from '../server.mjs';
import {normalizeLayout} from '../pane-layout.mjs';
import {Handoffs,HANDOFF_REQUEST} from '../handoff.mjs';

async function fixture(){const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-agents-'));const settings={spaceLayout:{projectId:'document-project',topicId:'story'}};const sessions=[{id:'old-agent',nativeId:'conversation-preserved',cwd:repo,open:false}];initializeAgentSpaces(settings,repo,sessions);return {repo,settings,sessions,change:data=>changeAgentSpaces(settings,data,sessions)}}

test('first setup copies the last project pane layout and never overwrites a space layout',()=>{
 const layout=normalizeLayout(null,['agent-a','agent-b']),settings={spaceLayout:{projectId:'project-a'},agentLayouts:{'project-a':layout}};
 initializeAgentSpaces(settings,os.tmpdir());assert.deepEqual(settings.agentSpaceLayouts.local,layout);assert.notEqual(settings.agentSpaceLayouts.local,layout);
 const next=normalizeLayout(null,['agent-c']);settings.agentSpaceLayouts.local=next;initializeAgentSpaces(settings,os.tmpdir());assert.deepEqual(settings.agentSpaceLayouts.local,next);assert.deepEqual(settings.agentLayouts['project-a'],layout);
});

test('legacy agents retain the original local space after reorder and restart',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Personal',cwd:repo,color:'#91B6DA',group:'My spaces'});const id=settings.agentSpaces[1].id;
 await change({action:'reorder',id,beforeId:'local'});assert.equal(sessionSpaceId(settings,'old-agent'),'local');assert.equal(sessionSpaceId(settings,'missing-assignment'),'local');
 const saved=structuredClone(settings);initializeAgentSpaces(saved,repo,sessions);assert.deepEqual(saved.agentSpaces,settings.agentSpaces);assert.equal(saved.agentSessionSpaces['old-agent'],'local');
 await change({action:'reorder',id,beforeId:id});assert.equal(settings.agentSpaces[0].id,id);
});
test('spaces are independent from projects and moving an agent preserves native metadata',async()=>{
 const {repo,settings,sessions,change}=await fixture(),before=structuredClone(sessions),right=structuredClone(settings.spaceLayout);
 await change({action:'create',name:'Work',cwd:repo,color:'#91b6da',group:null});const id=settings.agentSpaces[1].id;
 await change({action:'select',id});await change({action:'assign',sessionId:'old-agent',spaceId:id});await change({action:'update',id,name:'Renamed',color:'#dba3bb',group:'Work'});
 assert.deepEqual(settings.spaceLayout,right);assert.deepEqual(sessions,before);assert.equal(sessionSpaceId(settings,'old-agent'),id);assert.equal(settings.selectedAgentSpaceId,id);
});
test('handoff continuation inherits the source space before completion even after switching spaces',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Work',cwd:repo});const work=settings.agentSpaces[1].id;await change({action:'assign',sessionId:'old-agent',spaceId:work});
 const old={...sessions[0],name:'Work chat',agent:'codex',bypass:false},next={id:'continued'};
 const handoffs=new Handoffs({repo,sessions:{get:()=>old,create:async()=>{sessions.push(next);return next}},transcripts:{read:async()=>({messages:[{role:'user',text:HANDOFF_REQUEST},{role:'assistant',text:'# Handoff\nContinue work'}]})},changed:()=>{},opened:async(id,sourceId)=>{assert.equal(sourceId,old.id);await change({action:'assign',sessionId:id,spaceId:sessionSpaceId(settings,sourceId)})}});
 handoffs.completed=async()=>{};await handoffs.finish(old.id,0);assert.equal(handoffs.state(old.id).status,'done');assert.equal(sessionSpaceId(settings,next.id),work);assert.equal(settings.selectedAgentSpaceId,'local');
});
test('groups support renaming, collapse and ungroup without removing spaces',async()=>{
 const {repo,settings,change}=await fixture();await change({action:'create',name:'Alpha',cwd:repo,group:'Work'});await change({action:'create',name:'Beta',cwd:repo,group:'Work'});
 await change({action:'collapse-group',name:'Work',collapsed:true});assert.deepEqual(settings.collapsedAgentSpaceGroups,['Work']);
 await change({action:'rename-group',name:'Work',newName:'Team'});assert.equal(settings.agentSpaces.filter(s=>s.group==='Team').length,2);assert.deepEqual(settings.collapsedAgentSpaceGroups,[]);
 await change({action:'rename-group',name:'Team',newName:''});assert.ok(settings.agentSpaces.every(s=>s.group===null));assert.equal(settings.agentSpaces.length,3);
});
test('invalid requests leave existing spaces and assignments unchanged',async()=>{
 const {repo,settings,change}=await fixture(),before=structuredClone(settings);
 for(const data of [{action:'update',id:'local',name:'Changed',cwd:path.join(repo,'missing')},{action:'create',name:'Invalid',cwd:repo,color:'red'},{action:'assign',sessionId:'missing',spaceId:'local'},{action:'select',id:'missing'},{action:'collapse-group',name:'Work',collapsed:'false'},{action:'update',id:'local',name:' '},{action:'reorder',id:'local',beforeId:'missing'}]){
  await assert.rejects(change(data));assert.deepEqual(settings,before);
 }
});

test('deleting a selected space transfers running, closed and saved agents without changing sessions or projects',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Temporary',cwd:repo,group:'Temporary group'});const id=settings.agentSpaces[1].id;
 sessions.push({id:'live',status:'running',open:true,nativeId:'live-history',cwd:repo});
 await change({action:'assign',sessionId:'old-agent',spaceId:id});await change({action:'assign',sessionId:'live',spaceId:id});await change({action:'select',id});
 settings.agentSessionSpaces['saved-agent']=id;settings.agentSpaceLayouts[id]={source:true};settings.agentSpaceLayouts.local={destination:true};settings.collapsedAgentSpaceGroups=['Temporary group'];
 const before=structuredClone(sessions),right=structuredClone(settings.spaceLayout);
 await change({action:'delete',id,destinationId:'local'});
 assert.deepEqual(sessions,before);assert.deepEqual(settings.spaceLayout,right);assert.equal(settings.selectedAgentSpaceId,'local');
 assert.equal(settings.agentSpaces.length,1);for(const agent of ['old-agent','live','saved-agent'])assert.equal(settings.agentSessionSpaces[agent],'local');
 assert.equal(settings.agentSpaceLayouts[id],undefined);assert.deepEqual(settings.agentSpaceLayouts.local,{destination:true});assert.deepEqual(settings.collapsedAgentSpaceGroups,[]);
 const saved=structuredClone(settings);initializeAgentSpaces(saved,repo,sessions);assert.deepEqual(saved,settings);
});

test('the original local space can be removed while legacy agents are preserved',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Keep',cwd:repo});const id=settings.agentSpaces[1].id;
 sessions.push({id:'legacy-unassigned',open:true});await change({action:'select',id});
 await change({action:'delete',id:'local',destinationId:id});
 assert.equal(settings.selectedAgentSpaceId,id);assert.equal(settings.agentSpaces[0].id,id);assert.equal(settings.agentSessionSpaces['legacy-unassigned'],id);assert.equal(settings.agentSessionSpaces['old-agent'],id);
 initializeAgentSpaces(settings,repo,sessions);assert.equal(settings.agentSpaces.length,1);assert.equal(settings.agentSpaces[0].id,id);
});

test('deletion rejects the last space, missing destinations and stale IDs atomically',async()=>{
 const {repo,settings,change}=await fixture();let before=structuredClone(settings);
 await assert.rejects(change({action:'delete',id:'local',destinationId:'local'}));assert.deepEqual(settings,before);
 await change({action:'create',name:'Other',cwd:repo});before=structuredClone(settings);
 for(const data of [{id:'local',destinationId:'missing'},{id:'local',destinationId:'local'},{id:'missing',destinationId:'local'},{id:'local'}]){
  await assert.rejects(change({action:'delete',...data}));assert.deepEqual(settings,before);
 }
});

test('delete without transfer closes only the source agents and keeps closed history intact',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Temporary',cwd:repo});const id=settings.agentSpaces[1].id;
 sessions.push({id:'source-live',status:'running',open:true,nativeId:'keep-source',cwd:repo},{id:'destination-live',status:'running',open:true,cwd:repo});
 await change({action:'assign',sessionId:'source-live',spaceId:id});await change({action:'assign',sessionId:'old-agent',spaceId:id});await change({action:'select',id});
 settings.agentSessionSpaces['saved-only']=id;const before=structuredClone(sessions),closed=[];
 await changeAgentSpaces(settings,{action:'delete',id,agentAction:'close'},sessions,{closeSessions:async ids=>{closed.push(...ids);for(const id of ids)sessions.find(s=>s.id===id).open=false}});
 assert.deepEqual(closed,['source-live']);assert.equal(settings.agentSpaces.length,1);assert.equal(settings.selectedAgentSpaceId,'local');
 assert.equal(settings.agentSessionSpaces['source-live'],undefined);assert.equal(settings.agentSessionSpaces['old-agent'],undefined);assert.equal(settings.agentSessionSpaces['saved-only'],undefined);
 assert.equal(sessions.find(s=>s.id==='destination-live').open,true);assert.equal(sessions.find(s=>s.id==='source-live').nativeId,'keep-source');assert.deepEqual(sessions.map(s=>({...s,open:before.find(b=>b.id===s.id).open})),before);
});

test('an empty space can be deleted without a transfer destination or close handler',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Empty',cwd:repo});const id=settings.agentSpaces[1].id;
 await changeAgentSpaces(settings,{action:'delete',id,agentAction:'close'},sessions);assert.equal(settings.agentSpaces.length,1);assert.equal(sessions[0].open,false);
});

test('failed agent close retains the space and assignments for retry',async()=>{
 const {repo,settings,sessions,change}=await fixture();await change({action:'create',name:'Keep',cwd:repo});const id=settings.agentSpaces[1].id;sessions.push({id:'live',open:true});await change({action:'assign',sessionId:'live',spaceId:id});const before=structuredClone(settings);
 await assert.rejects(changeAgentSpaces(settings,{action:'delete',id,agentAction:'close'},sessions,{closeSessions:async()=>{throw Error('Stop failed')}}),/Stop failed/);assert.deepEqual(settings,before);
 await assert.rejects(changeAgentSpaces(settings,{action:'delete',id,agentAction:'close'},sessions));assert.deepEqual(settings,before);
 let calls=0;for(const data of [{id:'missing',agentAction:'close'},{id,agentAction:'invalid'}])await assert.rejects(changeAgentSpaces(settings,{action:'delete',...data},sessions,{closeSessions:async()=>{calls++}}));assert.equal(calls,0);assert.deepEqual(settings,before);
});

test('authenticated deletion without transfer persists chat closure and history across restart',async()=>{
 const {repo}=await fixture();await mkdir(path.join(repo,'.devspace'));const stamp=new Date().toISOString();
 await writeFile(path.join(repo,'.devspace/sessions.json'),JSON.stringify([{id:'source',name:'Source chat',agent:'shell',cwd:repo,open:true,nativeId:'keep-history',createdAt:stamp},{id:'other',name:'Other chat',agent:'shell',cwd:repo,open:true,createdAt:stamp}]));
 let service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});
 const request=async(route,data)=>{const response=await fetch(service.origin+'/api'+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(response.status,200);return response.json()};
 try{
  const right=await request('/devspace'),created=await request('/agent-spaces',{action:'create',name:'Remove',cwd:repo}),id=created.spaces[1].id;
  await request('/agent-spaces',{action:'assign',sessionId:'source',spaceId:id});await request('/agent-spaces',{action:'select',id});
  const removed=await request('/agent-spaces',{action:'delete',id,agentAction:'close'});assert.equal(removed.spaces.length,1);assert.equal(removed.assignments.source,undefined);
  assert.equal(service.sessions.get('source').open,false);assert.equal(service.sessions.get('other').open,true);assert.equal(service.sessions.get('source').nativeId,'keep-history');
  assert.ok((await request('/history')).some(s=>s.id==='source'&&!s.open));assert.deepEqual(await request('/devspace'),right);
  await service.close();service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});assert.equal((await request('/agent-spaces')).spaces.length,1);assert.equal(service.sessions.get('source').open,false);assert.equal(service.sessions.get('other').open,true);assert.equal(service.sessions.get('source').nativeId,'keep-history');
 }finally{await service.close()}
});
test('authenticated space operations and separate pane layouts persist across service restart',async()=>{
 const {repo}=await fixture();await mkdir(path.join(repo,'.devspace'));await writeFile(path.join(repo,'.devspace/sessions.json'),JSON.stringify([{id:'old-agent',name:'Old',agent:'shell',cwd:repo,open:false,nativeId:'keep-this-id',createdAt:new Date().toISOString()}]));
 let service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});
 const client=()=>{const {origin}=service;return async(route,data)=>{const response=await fetch(origin+'/api'+route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()}}};
 try{
  assert.equal((await fetch(service.origin+'/api/agent-spaces')).status,401);let request=client();
  const right=await request('/devspace');const created=await request('/agent-spaces',{action:'create',name:'Other',cwd:repo,group:'Work',color:'#91b6da'});assert.equal(created.status,200);const id=created.data.spaces[1].id;
  await request('/agent-spaces',{action:'select',id});await request('/agent-spaces',{action:'assign',sessionId:'old-agent',spaceId:id});
  assert.deepEqual((await request('/devspace')).data,right.data);
  const layout=normalizeLayout(null,['old-agent']);assert.equal((await request('/agent-space-layout',{spaceId:id,layout})).status,200);assert.equal((await request('/agent-space-layout',{spaceId:'missing',layout})).status,404);
  await service.close();service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});request=client();const result=(await request('/agent-spaces')).data;
  assert.equal(result.selectedId,id);assert.equal(result.assignments['old-agent'],id);assert.equal(service.sessions.list()[0].nativeId,'keep-this-id');
  const disk=JSON.parse(await readFile(path.join(repo,'.devspace/settings.json'),'utf8'));assert.deepEqual(disk.agentSpaceLayouts[id],layout);assert.equal(disk.agentSpaceLayouts.local,undefined);
  assert.equal((await request('/agent-spaces',{action:'delete',id,destinationId:'local'})).status,200);
  await service.close();service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});request=client();const afterDelete=(await request('/agent-spaces')).data;
  assert.equal(afterDelete.spaces.length,1);assert.equal(afterDelete.selectedId,'local');assert.equal(afterDelete.assignments['old-agent'],'local');assert.equal(service.sessions.list()[0].nativeId,'keep-this-id');assert.deepEqual((await request('/devspace')).data,right.data);
 }finally{await service.close()}
});
