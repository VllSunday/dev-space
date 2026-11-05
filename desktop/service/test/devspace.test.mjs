import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { DevSpace } from '../devspace.mjs';
import { createService } from '../server.mjs';

async function fixture(legacy={entities:[]}) {
  const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-test-'));
  await mkdir(path.join(repo,'workspace'));
  await writeFile(path.join(repo,'workspace/workspace.json'),JSON.stringify(legacy));
  const store=await new DevSpace(repo).init();
  const op=async change=>store.mutate({...change,baseRevision:(await store.read()).revision});
  return {repo,store,op};
}
test('blank project is usable without templates or required classification',async()=>{
 const {store,op}=await fixture();const before=await store.read();assert.equal(before.projects.length,1);assert.equal(before.materials.length,0);
 const state=await op({action:'create-material',projectId:before.projects[0].id,topicId:'unfiled',text:'Мысль\nСвободное описание'});
 assert.equal(state.materials[0].title,'Мысль');assert.equal(state.materials[0].text,'Мысль\nСвободное описание');assert.equal((await store.read()).materials.length,1);
});
test('project home and model-page links must stay within their project',async()=>{
 const {repo,store,op}=await fixture();const projectId=(await store.read()).projects[0].id;
 let state=await op({action:'create-page',projectId,title:'Models'});const pageId=state.pages[0].id;
 state=await op({action:'project-home',projectId,pageId});assert.equal(state.projects[0].homePageId,pageId);
 await assert.rejects(op({action:'project-home',projectId,pageId:'missing'}),e=>e.status===400);
 state=await op({action:'create-material',projectId,topicId:'unfiled',text:'Model',modelPageId:pageId,files:[]});assert.equal(state.materials[0].modelPageId,pageId);
 state=await op({action:'create-project',name:'Other project',path:repo});const otherId=state.projects.at(-1).id;
 await assert.rejects(op({action:'create-material',projectId:otherId,topicId:'unfiled',text:'Model',modelPageId:pageId,files:[]}),e=>e.status===400);
 await assert.rejects(op({action:'project-home',projectId:otherId,pageId}),e=>e.status===400);
 state=await op({action:'project-home',projectId,pageId:null});assert.equal(state.projects[0].homePageId,null);
});
test('legacy migration preserves IDs and leaves source registry unchanged',async()=>{
 const original={spaces:[{id:'app',name:'Работа',sections:[{id:'ideas',name:'Идеи'}]}],entities:[{id:'original',spaceId:'app',title:'Мои слова',description:'Не переписывать',category:'ideas',created:'2026-11-05'}]};
 const {repo,store}=await fixture(original);assert.deepEqual(JSON.parse(await readFile(path.join(repo,'workspace/workspace.json'),'utf8')),original);
 const state=await store.read();assert.equal(state.materials[0].legacyId,'original');assert.equal(state.materials[0].text,'Не переписывать');assert.equal(state.projects[0].topics[0].name,'Идеи');
});
test('stale and concurrent mutations cannot overwrite a newer snapshot',async()=>{
 const {store}=await fixture();const state=await store.read();const request={action:'create-topic',projectId:state.projects[0].id,name:'Первая',baseRevision:0};
 const results=await Promise.allSettled([store.mutate(request),store.mutate({...request,name:'Вторая'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.read()).projects[0].topics.length,1);
 await assert.rejects(store.mutate({...request,name:'Третья'}),e=>e.status===409);
});
test('upload is a real file; traversal and missing attachments are rejected',async()=>{
 const {store,repo,op}=await fixture();const file=await store.upload(Readable.from([Buffer.from('actual bytes')]),'../../example.txt');
 assert.equal(file.name,'example.txt');assert.equal(await readFile(path.join(repo,file.path),'utf8'),'actual bytes');const projectId=(await store.read()).projects[0].id;
 const state=await op({action:'create-material',projectId,topicId:'unfiled',text:'Подпись',files:[file]});assert.equal(state.materials[0].files[0].size,12);
 await assert.rejects(op({action:'create-material',projectId,topicId:'unfiled',text:'bad',files:[{path:'../secret',name:'file'}]}),e=>e.status===400);
 await assert.rejects(op({action:'create-material',projectId,topicId:'unfiled',text:'bad',files:[{path:'workspace/devspace/assets/missing.txt',name:'file'}]}));
});
test('deleting topic moves content and undo restores topic and references',async()=>{
 const {store,op}=await fixture();const projectId=(await store.read()).projects[0].id;let state=await op({action:'create-topic',projectId,name:'Мир'});const topicId=state.projects[0].topics[0].id;
 state=await op({action:'create-material',projectId,topicId,text:'Острова'});const materialId=state.materials[0].id;
 await op({action:'create-page',projectId,topicId,title:'Мир игры'});await op({action:'delete-topic',projectId,id:topicId});state=await store.read();assert.equal(state.materials[0].topicId,'unfiled');assert.equal(state.pages[0].topicId,'unfiled');
 state=await op({action:'undo'});assert.equal(state.projects[0].topics[0].id,topicId);assert.equal(state.materials[0].id,materialId);assert.equal(state.materials[0].topicId,topicId);
});
test('page edits preserve stable block IDs; typed blocks reject arbitrary script nodes',async()=>{
 const {store,op}=await fixture();const projectId=(await store.read()).projects[0].id;let state=await op({action:'create-page',projectId,title:'Бриф',blocks:[{id:'intro',type:'text',text:'Первая версия'}]});const pageId=state.pages[0].id;
 state=await op({action:'block',id:pageId,block:{id:'intro',type:'text',text:'Вторая версия'}});assert.equal(state.pages[0].blocks.length,1);assert.equal(state.pages[0].blocks[0].id,'intro');assert.equal(state.pages[0].revision,1);
 await assert.rejects(op({action:'block',id:pageId,block:{id:'evil',type:'script',text:'alert(1)'}}),e=>e.status===400);
});
test('agent proposal is reviewed and applied as separate page; sources remain',async()=>{
 const {store,repo,op}=await fixture();const projectId=(await store.read()).projects[0].id;let state=await op({action:'create-material',projectId,topicId:'unfiled',text:'Исходные слова'});
 const proposal={schemaVersion:1,projectId,topicId:'unfiled',baseRevision:state.revision,title:'Собранная страница',sourceIds:[state.materials[0].id],blocks:[{id:'intro',type:'text',text:'Анализ агента'}]};
 await writeFile(path.join(repo,'workspace/devspace/proposals/ready.json'),JSON.stringify(proposal));assert.equal((await store.proposals())[0].stale,false);
 state=await op({action:'apply-proposal',id:'ready'});assert.equal(state.pages[0].title,proposal.title);assert.equal(state.pages[0].sourceIds[0],state.materials[0].id);assert.equal(state.materials[0].text,'Исходные слова');assert.equal((await store.proposals()).length,0);
 state=await op({action:'undo'});assert.equal(state.pages.length,0);assert.equal(state.materials.length,1);
});
test('stale proposal is retained and cannot overwrite changed content',async()=>{
 const {store,repo,op}=await fixture();const projectId=(await store.read()).projects[0].id;
 await writeFile(path.join(repo,'workspace/devspace/proposals/stale.json'),JSON.stringify({schemaVersion:1,projectId,baseRevision:0,title:'Old',sourceIds:[],blocks:[]}));await op({action:'create-topic',projectId,name:'Изменение'});
 assert.equal((await store.proposals())[0].stale,true);await assert.rejects(op({action:'apply-proposal',id:'stale'}),e=>e.status===409);assert.ok((await readdir(path.join(repo,'workspace/devspace/proposals'))).includes('stale.json'));
});
test('invalid project folder does not create a half-configured project',async()=>{
 const {store,op,repo}=await fixture();await assert.rejects(op({action:'create-project',name:'Ошибка',path:path.join(repo,'missing')}));assert.equal((await store.read()).projects.length,1);
});
test('HTTP routes keep existing authentication; files use same protected API',async()=>{
 const {repo}=await fixture();const service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});
 try{
  const address=new URL(service.urls.workspace),token=address.searchParams.get('token'),origin=address.origin;
  assert.equal((await fetch(origin+'/api/devspace')).status,401);
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const result=await fetch(origin+'/api/devspace',{headers});assert.equal(result.status,200);const state=await result.json();
  const response=await fetch(origin+'/api/devspace',{method:'POST',headers,body:JSON.stringify({action:'create-material',baseRevision:state.revision,projectId:state.projects[0].id,topicId:'unfiled',text:'HTTP запись'})});assert.equal(response.status,200);
  const stale=await fetch(origin+'/api/devspace',{method:'POST',headers,body:JSON.stringify({action:'create-topic',baseRevision:0,projectId:state.projects[0].id,name:'Stale'})});assert.equal(stale.status,409);
  assert.ok(await readFile(path.join(repo,'workspace/devspace/space.json')));
 }finally{await service.close()}
});
test('drafts survive a store restart and stale network writes cannot erase newer input',async()=>{
 const {store,repo}=await fixture();await store.saveDraft({key:'default:world',text:'Новая мысль',files:[],version:20});await store.saveDraft({key:'default:world',text:'Старый текст',files:[],version:10});
 const restarted=await new DevSpace(repo).init();assert.equal((await restarted.readDraft('default:world')).text,'Новая мысль');assert.equal((await restarted.read()).revision,0,'draft autosave must not stale agent proposals');
 await restarted.saveDraft({key:'page:p:b',text:'Неоконченный абзац',baseline:'Прежний',files:[],version:30});assert.equal((await restarted.readDraft('page:p:b')).baseline,'Прежний');
});
test('checkbox/type changes patch fields and cannot revert a preceding blur text save',async()=>{
 const {store,op}=await fixture();const projectId=(await store.read()).projects[0].id;let state=await op({action:'create-page',projectId,title:'Page',blocks:[{id:'check',type:'check',text:'Старое',checked:false}]});const id=state.pages[0].id;
 await op({action:'patch-block',id,blockId:'check',patch:{text:'Новый абзац'}});state=await op({action:'patch-block',id,blockId:'check',patch:{checked:true}});assert.equal(state.pages[0].blocks[0].text,'Новый абзац');assert.equal(state.pages[0].blocks[0].checked,true);
 await assert.rejects(op({action:'update-page',id,blocks:[],expectedPageRevision:0}),e=>e.status===409);
});
