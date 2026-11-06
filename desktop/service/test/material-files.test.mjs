import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {DevSpace} from '../devspace.mjs';
import {createService} from '../server.mjs';

async function fixture(){const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-material-files-')),store=await new DevSpace(repo).init(),op=async data=>store.mutate({...data,baseRevision:(await store.read()).revision}),projectId=(await store.read()).projects[0].id;const state=await op({action:'create-material',projectId,topicId:'unfiled',title:'Existing note',text:'Original text'});return {repo,store,op,projectId,id:state.materials[0].id}}
const image=store=>store.upload(Readable.from([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')]),'map.svg');

test('attachments append atomically to an existing note, survive restart and appear in image collections',async()=>{
 const {repo,store,op,id}=await fixture(),first=await image(store),second=await store.upload(Readable.from([Buffer.from('second image')]),'screen.png');assert.equal(first.image,true);
 await op({action:'material-files',id,add:[first]});await op({action:'update-material',id,text:'Text edited while uploading'});const result=await op({action:'material-files',id,add:[second,first]});const record=result.materials.find(m=>m.id===id);
 assert.equal(record.text,'Text edited while uploading');assert.equal(record.title,'Existing note');assert.deepEqual(record.files.map(f=>f.path),[first.path,second.path]);assert.equal(record.kind,'image');
 const reopened=await new DevSpace(repo).init();assert.deepEqual((await reopened.read()).materials.find(m=>m.id===id),record);
});
test('removing an attachment preserves its bytes and other references; undo restores it',async()=>{
 const {repo,store,op,id,projectId}=await fixture(),file=await image(store);await op({action:'material-files',id,add:[file]});await op({action:'create-material',projectId,topicId:'unfiled',text:'Shared image',files:[file]});
 let result=await op({action:'material-files',id,remove:[file.path]});assert.equal(result.materials.find(m=>m.id===id).files.length,0);assert.equal(result.materials.find(m=>m.id===id).kind,'note');assert.equal(result.materials.find(m=>m.id!==id).files.length,1);assert.ok(await readFile(path.join(repo,file.path)));
 result=await op({action:'undo'});assert.equal(result.materials.find(m=>m.id===id).files[0].path,file.path);
});
test('attachment validation and stale revisions cannot overwrite material content',async()=>{
 const {store,op,id}=await fixture(),before=await store.read();
 for(const data of [{action:'material-files',id,add:[{path:'../private.png',name:'image',image:true}]},{action:'material-files',id,remove:['../private.png']},{action:'material-files',id:'missing',add:[]}]){await assert.rejects(op(data));assert.deepEqual(await store.read(),before)}
 await op({action:'update-material',id,title:'Updated'});await assert.rejects(store.mutate({action:'material-files',id,add:[],baseRevision:before.revision}),e=>e.status===409);assert.equal((await store.read()).materials[0].title,'Updated');
});
test('uploaded attachment drafts survive a failed attachment request and can be retried',async()=>{
 const {repo,store,op,id}=await fixture(),file=await image(store),key='material:'+id+':attachments';await store.saveDraft({key,text:'',files:[file],version:1});
 const reopened=await new DevSpace(repo).init(),draft=await reopened.readDraft(key);assert.deepEqual(draft.files,[file]);await op({action:'material-files',id,add:draft.files});await store.saveDraft({key,text:'',files:[],version:2,cleared:true});assert.equal((await store.readDraft(key)).files.length,0);assert.equal((await store.read()).materials[0].files.length,1);
});
test('bulk delete removes only selected notes and cleans references; undo restores IDs and attachments',async()=>{
 const {repo,store,op,id,projectId}=await fixture(),file=await image(store);await op({action:'material-files',id,add:[file]});const second=await op({action:'create-material',projectId,topicId:'unfiled',text:'Keep me'}),keep=second.materials.find(m=>m.id!==id).id;
 let result=await op({action:'create-page',projectId,title:'Wiki',layout:'wiki'});const pageId=result.pages[0].id;await op({action:'collection',id:pageId,topicId:'all',view:'list',enabled:true});await op({action:'collection',id:pageId,topicId:'all',view:'list',pinId:id,pinned:true});await op({action:'create-task',projectId,topicId:'unfiled',title:'Keep task',sourceId:id});const before=await store.read();
 await assert.rejects(op({action:'delete-materials',ids:[id,'missing']}));assert.deepEqual(await store.read(),before);
 result=await op({action:'delete-materials',ids:[id]});assert.deepEqual(result.materials.map(m=>m.id),[keep]);assert.equal(result.tasks[0].sourceId,null);assert.ok(result.pages[0].collections.every(c=>!c.pinnedIds?.includes(id)));assert.ok(await readFile(path.join(repo,file.path)));
 result=await op({action:'undo'});assert.deepEqual(result.materials,before.materials);assert.deepEqual(result.pages,before.pages);assert.deepEqual(result.tasks,before.tasks);
});
test('native file import is authenticated and copies a selected file without moving it',async()=>{
 const {repo}=await fixture(),source=path.join(repo,'local image.svg');await writeFile(source,'<svg xmlns="http://www.w3.org/2000/svg"/>');const service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});
 try{const endpoint=service.origin+'/api/devspace/files/import';assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,401);const headers={Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({path:source})});assert.equal(response.status,201);const file=await response.json();assert.equal(file.name,'local image.svg');assert.equal(file.image,true);assert.deepEqual(await readFile(path.join(repo,file.path)),await readFile(source));assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({path:repo})})).status,400)}finally{await service.close()}
});
