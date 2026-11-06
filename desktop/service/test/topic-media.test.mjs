import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {DevSpace} from '../devspace.mjs';

async function fixture(){const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-topic-media-')),store=await new DevSpace(repo).init(),op=async data=>store.mutate({...data,baseRevision:(await store.read()).revision}),projectId=(await store.read()).projects[0].id;const created=await op({action:'create-topic',projectId,name:'Media'}),topicId=created.projects[0].topics[0].id;const upload=(name,bytes)=>store.upload(Readable.from([Buffer.from(bytes)]),name);return{repo,store,op,projectId,topicId,upload}}
function glb(){const json=Buffer.from('{"asset":{"version":"2.0"}}  '),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([header,json])}

test('topic description mixes text, image and GLB and survives restart without duplicate uploads',async()=>{
 const {repo,store,op,projectId,topicId,upload}=await fixture();await op({action:'topic-block',projectId,topicId,block:{id:'keep-text',type:'text',text:'User text'}});
 const image=await upload('photo.svg','<svg xmlns="http://www.w3.org/2000/svg"/>'),model=await upload('courier.glb',glb());let state=await op({action:'topic-media',projectId,topicId,files:[image,model,image]});
 assert.deepEqual(state.projects[0].topics[0].blocks.map(b=>b.type),['text','image','model']);const before=structuredClone(state.projects[0].topics[0].blocks);
 state=await op({action:'topic-media',projectId,topicId,files:[image,model]});assert.deepEqual(state.projects[0].topics[0].blocks,before);
 const reopened=await new DevSpace(repo).init();assert.deepEqual((await reopened.read()).projects[0].topics[0].blocks,before);assert.equal((await store.read()).materials.length,0);
});

test('invalid media batches leave existing topic blocks unchanged',async()=>{
 const {store,op,projectId,topicId,upload}=await fixture(),image=await upload('photo.png',Buffer.from([1,2,3])),bad=await upload('invalid.glb','not a model'),wrong=await upload('file.txt','text'),truncated=await upload('truncated.glb',glb().subarray(0,12)),before=await store.read();
 for(const files of [[image,bad],[wrong],[truncated],[{...image,path:'../outside.png'}],[]]){await assert.rejects(op({action:'topic-media',projectId,topicId,files}));assert.deepEqual(await store.read(),before)}
 await assert.rejects(op({action:'topic-media',projectId,topicId:'missing',files:[image]}));assert.deepEqual(await store.read(),before);
});

test('media blocks support caption editing, ordering, removal and undo while retaining files',async()=>{
 const {repo,op,projectId,topicId,upload}=await fixture(),image=await upload('image.svg','<svg/>'),model=await upload('model.glb',glb());let state=await op({action:'topic-media',projectId,topicId,files:[image,model]});const [a,b]=state.projects[0].topics[0].blocks;
 await op({action:'topic-patch-block',projectId,topicId,blockId:a.id,patch:{text:'Caption'}});state=await op({action:'topic-move-block',projectId,topicId,blockId:b.id,direction:'up'});assert.equal(state.projects[0].topics[0].blocks[0].id,b.id);
 await op({action:'topic-delete-block',projectId,topicId,blockId:b.id});assert.ok((await stat(path.join(repo,model.path))).isFile());state=await op({action:'undo'});assert.equal(state.projects[0].topics[0].blocks[0].asset,model.path);assert.equal(state.projects[0].topics[0].blocks[1].text,'Caption');
});

test('uploaded topic media draft can be recovered and retried without replacing edited text',async()=>{
 const {repo,store,op,projectId,topicId,upload}=await fixture(),image=await upload('image.svg','<svg/>'),key='topic:'+topicId+':media';await store.saveDraft({key,text:'',files:[image],version:1});await op({action:'topic-block',projectId,topicId,block:{id:'late-text',type:'text',text:'Added during upload'}});
 const reopened=await new DevSpace(repo).init(),draft=await reopened.readDraft(key);let state=await reopened.read();state=await reopened.mutate({action:'topic-media',projectId,topicId,files:draft.files,baseRevision:state.revision});assert.deepEqual(state.projects[0].topics[0].blocks.map(b=>b.type),['text','image']);assert.equal(state.projects[0].topics[0].blocks[0].text,'Added during upload');
});
