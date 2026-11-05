import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DevSpace} from '../desktop/service/devspace.mjs';

test('bundled game template imports an editable independent project and retains existing content',async()=>{
 const repo=await mkdtemp(path.join(os.tmpdir(),'devspace-template-')),store=await new DevSpace(repo).init();
 const op=async change=>store.mutate({...change,baseRevision:(await store.read()).revision});
 const initial=await store.read();
 await op({action:'create-material',projectId:initial.projects[0].id,topicId:'unfiled',text:'My existing note'});
 const before=await store.read();let state=await op({action:'import-template',templateId:'wind-islands'});const project=state.projects.at(-1);
 assert.deepEqual(state.projects[0],before.projects[0]);assert.deepEqual(state.materials[0],before.materials[0]);
 assert.equal(state.pages.length,6);assert.equal(state.materials.length,13);assert.equal(state.tasks.length,6);assert.equal(project.topics.length,5);
 assert.ok(path.relative(repo,project.path).startsWith('projects'+path.sep));assert.ok((await stat(project.path)).isDirectory());
 const pageIds=new Set(state.pages.map(p=>p.id)),materialIds=new Set(state.materials.map(m=>m.id));
 assert.ok(pageIds.has(project.homePageId));
 const topics=new Set(['unfiled',...project.topics.map(t=>t.id)]);
 for(const page of state.pages){assert.equal(page.projectId,project.id);assert.ok(topics.has(page.topicId));assert.ok(page.sourceIds.every(id=>materialIds.has(id)));for(const c of page.collections||[])assert.ok(topics.has(c.topicId));}
 for(const material of state.materials.filter(m=>m.projectId===project.id)){
  assert.ok(topics.has(material.topicId));if(material.modelPageId)assert.ok(pageIds.has(material.modelPageId));
  for(const file of material.files)assert.equal((await stat(path.join(repo,file.path))).size,file.size);
 }
 for(const page of state.pages)for(const block of page.blocks)if(block.asset)assert.ok((await stat(path.join(repo,block.asset))).isFile());
 state=await op({action:'patch-block',id:state.pages[0].id,blockId:state.pages[0].blocks[0].id,patch:{text:'My editable example'}});
 assert.equal(state.pages[0].blocks[0].text,'My editable example');
 const snapshot=JSON.stringify(state),again=await op({action:'import-template',templateId:'wind-islands'}),copy=again.projects.at(-1);
 assert.notEqual(copy.id,project.id);assert.notEqual(copy.path,project.path);assert.notEqual(copy.name,project.name);
 assert.equal(again.projects.slice(0,-1).length,state.projects.length);
 const firstIds=new Set([...state.pages,...state.materials,...state.tasks].map(item=>item.id));
 for(const item of [...again.pages,...again.materials,...again.tasks].filter(item=>item.projectId===copy.id))assert.equal(firstIds.has(item.id),false);
 assert.deepEqual(again.pages.filter(p=>p.projectId===project.id),state.pages);
 const undone=await op({action:'undo'});assert.deepEqual(undone.projects,state.projects);assert.deepEqual(undone.materials,state.materials);
 assert.equal((await new DevSpace(repo).init().then(s=>s.read())).pages.length,6);
 assert.ok(snapshot.includes('My existing note'));
});

test('template identifiers are allowlisted and stale requests cannot write template files',async()=>{
 const repo=await mkdtemp(path.join(os.tmpdir(),'devspace-template-reject-')),store=await new DevSpace(repo).init();
 for(const templateId of ['../secret','unknown','file:///C:/Users'])await assert.rejects(store.mutate({action:'import-template',templateId,baseRevision:0}),e=>e.status===400);
 await assert.rejects(store.mutate({action:'import-template',templateId:'wind-islands',baseRevision:8}),e=>e.status===409);
 assert.equal((await store.read()).projects.length,1);assert.deepEqual(await readdir(path.join(repo,'workspace/devspace/assets')),[]);
 const source=await readFile(new URL('../desktop/service/templates/wind-islands/template.json',import.meta.url),'utf8');
 assert.equal(/C:\\Users|zheny|AppData|api[_-]?key|access[_-]?token/i.test(source),false);
});
