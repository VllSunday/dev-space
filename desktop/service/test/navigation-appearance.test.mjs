import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DevSpace} from '../devspace.mjs';

async function fixture(){const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-nav-')),store=await new DevSpace(repo).init(),op=async data=>store.mutate({...data,baseRevision:(await store.read()).revision});const projectId=(await store.read()).projects[0].id;return{repo,store,op,projectId}}

test('navigation colors cover builtins, topics and pages and survive renames and restart',async()=>{
 const {repo,store,op,projectId}=await fixture();let state=await op({action:'create-topic',projectId,name:'Category'});const topic=state.projects[0].topics[0];
 state=await op({action:'create-page',projectId,title:'Document'});const page=state.pages[0],blocks=structuredClone(page.blocks);
 const keys=['all','unfiled','images','tasks','archive','topic:'+topic.id,'page:'+page.id];for(const key of keys)await op({action:'navigation-color',projectId,key,color:'#91B6DA'});
 await op({action:'rename-topic',projectId,id:topic.id,name:'Renamed category'});await op({action:'update-page',id:page.id,title:'Renamed document'});
 const restarted=await new DevSpace(repo).init();state=await restarted.read();for(const key of keys)assert.equal(state.projects[0].navigationColors[key],'#91b6da');assert.deepEqual(state.pages[0].blocks,blocks);
});

test('page icon metadata preserves document content, IDs, composition and Markdown revision protection',async()=>{
 const {op,projectId,store}=await fixture();let state=await op({action:'create-page',projectId,title:'Document'});const page=structuredClone(state.pages[0]);
 state=await op({action:'page-icon',projectId,id:page.id,icon:'steel:map'});assert.equal(state.pages[0].icon,'steel:map');assert.deepEqual(state.pages[0].blocks,page.blocks);assert.deepEqual(state.pages[0].flow,page.flow);assert.equal(state.pages[0].id,page.id);assert.equal(state.pages[0].revision,page.revision+1);
 await assert.rejects(op({action:'update-page',id:page.id,blocks:page.blocks,expectedPageRevision:page.revision}),e=>e.status===409);
 state=await op({action:'page-icon',projectId,id:page.id,icon:'🗺️'});assert.equal(state.pages[0].icon,'🗺️');state=await op({action:'page-icon',projectId,id:page.id,icon:''});assert.equal(state.pages[0].icon,'');assert.deepEqual((await store.read()).pages[0].blocks,page.blocks);
});

test('appearance is project-specific, reversible and resettable',async()=>{
 const {op,projectId}=await fixture();let state=await op({action:'create-project',name:'Other'});const other=state.projects.at(-1).id;
 await op({action:'navigation-color',projectId,key:'all',color:'#dba3bb'});state=await op({action:'navigation-color',projectId:other,key:'all',color:'#a5bd91'});assert.equal(state.projects[0].navigationColors.all,'#dba3bb');assert.equal(state.projects.at(-1).navigationColors.all,'#a5bd91');
 state=await op({action:'navigation-color',projectId,key:'all',color:null});assert.equal(state.projects[0].navigationColors.all,undefined);state=await op({action:'undo'});assert.equal(state.projects[0].navigationColors.all,'#dba3bb');
 state=await op({action:'create-page',projectId,title:'Icon undo'});const id=state.pages[0].id;await op({action:'page-icon',projectId,id,icon:'✦'});state=await op({action:'undo'});assert.equal(state.pages[0].icon,undefined);
});

test('invalid, foreign and stale appearance requests leave all data unchanged',async()=>{
 const {op,store,projectId}=await fixture();let state=await op({action:'create-page',projectId,title:'Document'});const id=state.pages[0].id;state=await op({action:'create-project',name:'Other'});const other=state.projects.at(-1).id,before=await store.read();
 for(const data of [
  {action:'navigation-color',projectId,key:'all',color:'#fff'},{action:'navigation-color',projectId,key:'all',color:'red;background:url(x)'},{action:'navigation-color',projectId,key:'__proto__',color:'#abcdef'},
  {action:'navigation-color',projectId:other,key:'page:'+id,color:'#abcdef'},{action:'navigation-color',projectId,key:'topic:missing',color:'#abcdef'},
  {action:'page-icon',projectId:other,id,icon:'✦'},{action:'page-icon',projectId,id,icon:'bad\nicon'},{action:'page-icon',projectId,id,icon:'a'.repeat(33)},
 ]){await assert.rejects(op(data));assert.deepEqual(await store.read(),before)}
 await assert.rejects(store.mutate({action:'navigation-color',projectId,key:'all',color:'#abcdef',baseRevision:before.revision-1}),e=>e.status===409);assert.deepEqual(await store.read(),before);
});
