import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {skillLocations} from '../skill-locations.mjs';
import {ContextLibrary} from '../context.mjs';
import {Files} from '../files.mjs';
import {createService} from '../server.mjs';

test('skill locations distinguish providers and scopes without creating missing folders',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dev-space-skill-roots-')),repo=path.join(root,'project'),home=path.join(root,'home');await mkdir(repo);await mkdir(home);
 await mkdir(path.join(home,'.claude/skills/real-skill'),{recursive:true});await writeFile(path.join(home,'.claude/skills/real-skill/SKILL.md'),'# Existing skill');await mkdir(path.join(repo,'.agents/skills'),{recursive:true});
 const before=await readdir(repo),locations=await skillLocations(repo,home);
 assert.equal(locations.find(l=>l.id==='personal-claude').exists,true);assert.equal(locations.find(l=>l.id==='project-claude').exists,false);assert.equal(locations.find(l=>l.id==='project-agents').exists,true);
 assert.ok(locations.filter(l=>l.scope==='project').every(l=>l.path.startsWith(repo+path.sep)));assert.ok(locations.filter(l=>l.scope==='personal').every(l=>l.path.startsWith(home+path.sep)));assert.deepEqual(await readdir(repo),before);
 const files=new Files(repo);try{const list=await files.list(locations.find(l=>l.id==='personal-claude').path,'all');assert.ok(list.entries.some(e=>e.name==='real-skill'));await assert.rejects(files.list(path.join(repo,'.claude/skills'),'all'),e=>e.status===404&&!e.message.includes('ENOENT'))}finally{await files.close()}
});
test('context library includes personal Claude roots and retains credential restrictions',async()=>{
 const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-skill-context-')),library=new ContextLibrary(repo);
 assert.ok(library.skillRoots.includes(path.join(os.homedir(),'.claude','skills')));assert.ok(library.skillRoots.includes(path.join(repo,'.agents','skills')));
 assert.deepEqual(library.skillRoots.slice(0,2),[path.join(repo,'.agents','skills'),path.join(repo,'.claude','skills')]);
 await mkdir(path.join(repo,'.claude/skills/example'),{recursive:true});const skill=path.join(repo,'.claude/skills/example/SKILL.md');await writeFile(skill,'# Safe instructions');assert.equal((await library.read(skill)).text,'# Safe instructions');
 const secret=path.join(repo,'.claude/skills/example/auth.json');await writeFile(secret,'{}');await assert.rejects(library.read(secret),/credential files/);
});
test('skill discovery requires authentication and uses the selected document project',async()=>{
 const repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-skill-api-')),other=path.join(repo,'other');await mkdir(other);
 const service=await createService({repo,uiDir:repo,mcpOptions:{home:repo,env:{}}});
 try{
  assert.equal((await fetch(service.origin+'/api/skill-locations')).status,401);const headers={Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'};
  const state=await fetch(service.origin+'/api/devspace',{headers}).then(r=>r.json());const changed=await fetch(service.origin+'/api/devspace',{method:'POST',headers,body:JSON.stringify({action:'create-project',name:'Other',path:other,baseRevision:state.revision})}).then(r=>r.json());const id=changed.projects.at(-1).id;
  const response=await fetch(service.origin+'/api/skill-locations?projectId='+id,{headers});assert.equal(response.status,200);const roots=await response.json();assert.equal(roots.find(l=>l.id==='project-claude').path,path.join(other,'.claude','skills'));assert.equal(roots.find(l=>l.id==='project-claude').exists,false);
  assert.equal((await fetch(service.origin+'/api/skill-locations?projectId=missing',{headers})).status,404);
 }finally{await service.close()}
});
