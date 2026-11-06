// Synthetic data only; no real agent is launched or user material changed.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createService} from '../desktop/service/server.mjs';
import {desktopAuth,launchBrowser} from '../desktop/service/test/browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-material-ui-')),svg='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="gray"/></svg>';
const service=await createService({repo,uiDir:path.join(root,'dist'),mcpOptions:{home:repo,env:{}}}),headers={Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'};
const read=()=>fetch(service.origin+'/api/devspace',{headers}).then(r=>r.json());
const op=async data=>{const state=await read(),r=await fetch(service.origin+'/api/devspace',{method:'POST',headers,body:JSON.stringify({...data,baseRevision:state.revision})});assert.ok(r.ok);return r.json()};
let browser;
try{
 const projectId=(await read()).projects[0].id;let state=await op({action:'create-material',projectId,topicId:'unfiled',text:'Existing note'});const id=state.materials[0].id;state=await op({action:'create-material',projectId,topicId:'unfiled',text:'Second note'});
 browser=await launchBrowser();const context=await browser.newContext({viewport:{width:1440,height:1000}});await desktopAuth(context,service.urls.workspace,'ru');const page=await context.newPage();page.setDefaultTimeout(8000);await page.goto(service.urls.workspace);if(await page.locator('.ds-agent-pane').count())await page.keyboard.press('Control+j');
 await page.locator(`[data-material-id="${id}"] .ds-record-open`).click();const editor=page.locator('.ds-material-attachments');await editor.locator('input[type=file]').setInputFiles({name:'from-picker.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await page.waitForFunction(()=>document.querySelectorAll('.ds-record-files figure').length===1);
 const source=path.join(repo,'native-drop.svg');await writeFile(source,svg);const box=await editor.boundingBox();await page.evaluate(({source,box})=>window.dispatchEvent(new CustomEvent('mrmak-file-drop',{detail:{phase:'drop',paths:[source],x:box.x+20,y:box.y+20}})),{source,box});
 await page.waitForFunction(()=>document.querySelectorAll('.ds-record-files figure').length===2);state=await read();assert.equal(state.materials.length,2,'file drop attaches to the existing record instead of creating another note');assert.equal(state.materials.find(m=>m.id===id).files.length,2);
 await page.getByRole('button',{name:'Редактировать материал',exact:true}).click();await page.getByRole('button',{name:'Убрать вложение: from-picker.svg',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.ds-record-files figure').length===1);
 await page.getByRole('button',{name:'Свернуть материал',exact:true}).click();for(const checkbox of await page.locator('.ds-record-summary input[type=checkbox]').all())await checkbox.check();await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-material-id]'));assert.equal((await read()).materials.length,0);
 await page.locator('.ds-toast-undo').click();await page.waitForFunction(()=>document.querySelectorAll('.ds-topic-record').length===2);assert.equal((await read()).materials.length,2);assert.equal((await read()).materials.find(m=>m.id===id).files.length,1);
 console.log('PASS: existing-note images, native drop routing, detach, bulk delete and undo');
}finally{await browser?.close();await service.close()}
