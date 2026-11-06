// Isolated layout fixture: no real CLI or user workspace is opened.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createService} from '../desktop/service/server.mjs';
import {desktopAuth,launchBrowser} from '../desktop/service/test/browser.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repo=await mkdtemp(path.join(os.tmpdir(),'dev-space-panel-ui-'));
const service=await createService({repo,uiDir:path.join(root,'dist'),mcpOptions:{home:repo,env:{}}});
const headers={Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'};
const post=async(route,data)=>{const r=await fetch(service.origin+'/api'+route,{method:'POST',headers,body:JSON.stringify(data)});assert.ok(r.ok);return r.json()};
for(let i=0;i<4;i++){
 const id='layout-agent-'+i,session=service.sessions.make({id,name:'Conversation '+(i+1),agent:i%2?'claude':'codex',cwd:repo,open:true,status:i===2?'stopped':'running',hasConversation:true,createdAt:new Date().toISOString(),cols:80,rows:24,restoreError:i===2?'The original conversation could not be found. The previous terminal screen is saved.':''});
 service.sessions.items.set(id,session);await service.sessions.hydrate(session);
 if(i!==2)session.process={write(){},resize(){},kill(){}};
 await new Promise(resolve=>session.terminal.write(Array.from({length:120},(_,n)=>'Graphite terminal line '+n+'\r\n').join(''),resolve));
}
let browser;
try{
 await post('/settings',{spaceLayout:{agentOpen:true,agentWide:true}});
 browser=await launchBrowser();const context=await browser.newContext({viewport:{width:1440,height:1000}});await desktopAuth(context,service.urls.workspace,'ru');
 const page=await context.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(service.urls.workspace);
 await page.locator('.agent-cell').first().waitFor();await page.getByRole('button',{name:'Раскладка панелей',exact:true}).click();await page.getByRole('button',{name:'Раскладка: 4 панели',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.agent-cell').length===4);
 // A settings broadcast rerenders every pane, exposing the former shared-default bug.
 for(const cell of await page.locator('.agent-cell').all())assert.equal(await cell.getByRole('button',{name:'Терминал',exact:true}).getAttribute('aria-pressed'),'true');
 await page.locator('.agent-cell').first().getByRole('button',{name:'Переписка',exact:true}).click();
 await post('/settings',{terminalFontSize:14});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const independent=await page.locator('.agent-cell').all();assert.equal(await independent[0].getByRole('button',{name:'Переписка',exact:true}).getAttribute('aria-pressed'),'true');
 for(const cell of independent.slice(1))assert.equal(await cell.getByRole('button',{name:'Терминал',exact:true}).getAttribute('aria-pressed'),'true','another chat must keep its own view after a shared rerender');
 const output=path.join(root,'.cache/agent-panels-review');await mkdir(output,{recursive:true});
 for(const width of [1440,800]){
  await page.setViewportSize({width,height:1000});
  for(const cell of await page.locator('.agent-cell').all())await cell.getByRole('button',{name:'Переписка',exact:true}).click();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const input=page.locator('.conversation-composer textarea').first();await input.focus();
  const focus=await input.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,border:getComputedStyle(el).borderTopWidth,accent:getComputedStyle(document.body).getPropertyValue('--pink').trim(),expected:getComputedStyle(document.body).getPropertyValue('--ds-accent').trim()}));
  assert.equal(focus.outline,'none','automatic chat focus must not draw an inner rectangle');assert.equal(focus.border,'0px');assert.equal(focus.accent,focus.expected,'legacy root palette must not recolor the desktop shell');
  const geometry=await page.evaluate(()=>{
   const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
   return {top:rect(document.querySelector('.ds-spaces-top')),bottom:rect(document.querySelector('.ds-space-agents')),cells:[...document.querySelectorAll('.agent-cell')].map(cell=>({cell:rect(cell),context:rect(cell.querySelector('.chat-context')),buttons:[...cell.querySelectorAll('.chat-context-tools button')].map(rect),composer:rect(cell.querySelector('.conversation-composer')),input:rect(cell.querySelector('.conversation-composer textarea'))}))};
  });
  assert.ok(Math.abs(geometry.top.height-geometry.bottom.height)<=1,'spaces and agents split equally');
  for(const cell of geometry.cells){for(const button of cell.buttons){assert.ok(button.left>=cell.context.left-1&&button.right<=cell.context.right+1&&button.bottom<=cell.context.bottom+1,'toolbar controls stay inside their row')}assert.ok(cell.input.height>=30,'composer has room for one line')}
  for(const row of [geometry.cells.filter(c=>c.cell.top<500),geometry.cells.filter(c=>c.cell.top>=500)])if(row.length>1)assert.ok(Math.abs(row[0].composer.bottom-row[1].composer.bottom)<=1,'same-row composers align even with reconnect notice');
  const before=geometry.bottom.top;for(let i=0;i<5;i++)await post('/agent-spaces',{action:'create',name:'Extra '+width+' '+i,cwd:repo});
  await page.waitForFunction(count=>document.querySelectorAll('.ds-space-row').length>=count,width===1440?6:11);
  const after=await page.locator('.ds-space-agents').boundingBox();assert.ok(Math.abs(after.y-before)<=1,'adding spaces does not move the midpoint');
  await page.screenshot({path:path.join(output,'panels-'+width+'.png'),fullPage:true});
 }
 for(const cell of await page.locator('.agent-cell').all())await cell.getByRole('button',{name:'Терминал',exact:true}).click();
 assert.ok((await page.locator('.xterm').count())===4);assert.deepEqual(errors,[]);console.log('PASS: pane headers, composer alignment, fixed sidebar midpoint, terminal switching');
}finally{await browser?.close();for(const session of service.sessions.items.values())session.process=null;await service.close()}
