import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { normalizeLayout, changeLayout, panes, paneGeometry, validateLayout } from '../desktop/service/pane-layout.mjs';
import { createService } from '../desktop/service/server.mjs';
const require = createRequire(new URL('../desktop/service/package.json', import.meta.url));
const { WebSocket } = require('ws');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allTabs = layout => panes(layout.root).flatMap(pane => pane.tabs).sort();

test('splitting up to four panes covers the workspace and retains each live tab once', () => {
  let layout = normalizeLayout(null, ['a','b','c','d']);
  layout = changeLayout(layout, {type:'split',direction:'right',newId:'right'});
  layout = changeLayout(layout, {type:'split',paneId:'pane-main',direction:'bottom',newId:'bottom-left'});
  layout = changeLayout(layout, {type:'split',paneId:'right',direction:'bottom',newId:'bottom-right'});
  assert.equal(panes(layout.root).length,4); assert.deepEqual(allTabs(layout),['a','b','c','d']);
  const cells = paneGeometry(layout.root).cells;
  assert.equal(cells.reduce((sum,cell)=>sum+cell.width*cell.height,0),10000);
  assert.ok(cells.every(cell=>cell.width===50&&cell.height===50));
  assert.equal(changeLayout(layout,{type:'split',direction:'right',newId:'fifth'}),layout);
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(layout))),layout);
});
test('moving and closing panes never close chats or lose the source selection', () => {
  let layout=changeLayout(normalizeLayout(null,['a','b','c']),{type:'split',direction:'right',newId:'p2'});
  layout=changeLayout(layout,{type:'move',paneId:'p2',tabId:'a'});
  assert.equal(panes(layout.root).find(p=>p.id==='p2').selectedId,'a');
  assert.deepEqual(allTabs(layout),['a','b','c']);
  layout=changeLayout(layout,{type:'zoom',paneId:'p2'});assert.equal(layout.zoomedPaneId,'p2');
  layout=changeLayout(layout,{type:'close',paneId:'p2'});assert.equal(panes(layout.root).length,1);assert.deepEqual(allTabs(layout),['a','b','c']);
  assert.equal(layout.zoomedPaneId,layout.activePaneId);
  layout=normalizeLayout(layout,['b','d']);assert.deepEqual(allTabs(layout),['b','d']);
  assert.ok(panes(layout.root)[0].tabs.includes(panes(layout.root)[0].selectedId));
});
test('resizing is bounded; malformed and duplicate layout identities are rejected',()=>{
  let layout=changeLayout(normalizeLayout(null,['a','b']),{type:'split',direction:'right',newId:'p2'});
  layout=changeLayout(layout,{type:'ratio',splitId:layout.root.id,ratio:9});assert.equal(layout.root.ratio,.8);
  assert.equal(changeLayout(layout,{type:'ratio',splitId:layout.root.id,ratio:NaN}),layout);
  const bad=structuredClone(layout);bad.root.second.tabs.push(bad.root.first.tabs[0]);assert.throws(()=>validateLayout(bad));
  const loop=structuredClone(layout);loop.root.second.id=loop.root.first.id;assert.throws(()=>validateLayout(loop));
  assert.deepEqual(allTabs(normalizeLayout({root:null},['a','b'])),['a','b']);
});

async function fixture() {
  const repo=await mkdtemp(path.join(os.tmpdir(),'devspace-splits-'));
  await mkdir(path.join(repo,'workspace'));
  const native=[];
  const service=await createService({repo,uiDir:repo,native:event=>native.push(event),mcpOptions:{home:repo,env:{}}});
  const request=(route,data,method=data===undefined?'GET':'POST')=>fetch(service.origin+'/api'+route,{method,headers:{Authorization:`Bearer ${service.token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
  return {repo,service,request,native};
}
test('project layouts persist separately; invalid layouts do not replace a saved layout',async()=>{
  const {repo,service,request}=await fixture();
  try{
    const project=(await (await request('/devspace')).json()).projects[0];
    const layout=changeLayout(normalizeLayout(null,[]),{type:'split',direction:'bottom',newId:'two'});
    assert.equal((await request('/agent-layout',{projectId:project.id,layout})).status,200);
    assert.equal((await request('/agent-layout',{projectId:'unknown',layout})).status,400);
    const bad=structuredClone(layout);bad.root.ratio=0;assert.equal((await request('/agent-layout',{projectId:project.id,layout:bad})).status,400);
    const stored=JSON.parse(await readFile(path.join(repo,'.devspace/settings.json'),'utf8'));
    assert.deepEqual(stored.agentLayouts[project.id],layout);
    let settings=await (await request('/settings',{spaceLayout:{projectId:project.id,topicId:'all',toolsWidth:736}})).json();
    assert.equal(settings.spaceLayout.toolsWidth,736);
    settings=await (await request('/settings',{spaceLayout:{projectId:project.id,topicId:'all',agentWidth:640}})).json();
    assert.equal(settings.spaceLayout.toolsWidth,736);
    assert.equal(JSON.parse(await readFile(path.join(repo,'.devspace/settings.json'),'utf8')).spaceLayout.toolsWidth,736);
    assert.equal((await fetch(service.origin+'/api/appearance/fonts')).status,401);
  }finally{await service.close();}
});
const waitFor=async(check)=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('Timed out waiting for fixture event');await new Promise(resolve=>setTimeout(resolve,5));}};
async function socket(service) {
  const ws=new WebSocket(service.origin.replace('http:','ws:')+'/events',{origin:service.origin}),events=[];
  ws.on('message',raw=>events.push(JSON.parse(raw)));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  ws.send(JSON.stringify({type:'auth',surface:'desktop',token:service.token}));await waitFor(()=>events.some(e=>e.type==='connected'));
  const send=value=>ws.send(JSON.stringify(value));
  const barrier=async()=>{const n=events.filter(e=>e.type==='pong').length;send({type:'ping'});await waitFor(()=>events.filter(e=>e.type==='pong').length>n);};
  return {ws,events,send,barrier};
}
test('one desktop socket streams four real session snapshots and independent outputs',async()=>{
  const {service}=await fixture();let client;
  try{
    for(const id of ['a','b','c','d','e']) service.sessions.items.set(id,service.sessions.make({id,agent:'shell',name:id,cwd:service.sessions.repo,open:true,status:'stopped',createdAt:new Date().toISOString(),cols:80,rows:24}));
    client=await socket(service);
    for(const id of ['a','b','c','d']) client.send({type:'subscribe',id});
    await waitFor(()=>client.events.filter(e=>e.type==='snapshot').length===4);
    for(const id of ['a','b','c','d'])service.sessions.emit('output',{id,data:'output '+id,sequence:1});
    await waitFor(()=>client.events.filter(e=>e.type==='output').length===4);
    client.send({type:'subscribe',id:'e'});await waitFor(()=>client.events.some(e=>e.type==='service-error'));
    client.send({type:'unsubscribe',id:'a'});await client.barrier();
    service.sessions.emit('output',{id:'a',data:'hidden',sequence:2});service.sessions.emit('output',{id:'b',data:'visible',sequence:2});await client.barrier();
    assert.equal(client.events.filter(e=>e.type==='output'&&e.id==='a').length,1);
    assert.equal(client.events.filter(e=>e.type==='output'&&e.id==='b').length,2);
    assert.equal(service.sessions.get('a').open,true);assert.equal(service.sessions.get('a').process,null);
  }finally{client?.ws.terminate();await service.close();}
});
test('late snapshots cannot reset a replacement subscription of the same terminal',async()=>{
  const {service}=await fixture();let client;
  try{
    service.sessions.items.set('a',service.sessions.make({id:'a',agent:'shell',name:'a',open:true,status:'stopped',createdAt:new Date().toISOString(),cols:80,rows:24}));
    const pending=[];service.sessions.snapshot=()=>new Promise(resolve=>pending.push(resolve));
    client=await socket(service);client.send({type:'subscribe',id:'a'});await client.barrier();
    client.send({type:'unsubscribe',id:'a'});client.send({type:'subscribe',id:'a'});await client.barrier();
    pending[0]({session:{id:'a'},data:'old',sequence:1});pending[1]({session:{id:'a'},data:'current',sequence:2});
    await waitFor(()=>client.events.some(e=>e.type==='snapshot'));await client.barrier();
    assert.deepEqual(client.events.filter(e=>e.type==='snapshot').map(e=>e.data),['current']);
  }finally{client?.ws.terminate();await service.close();}
});
test('custom fonts stay protected, are validated, deduplicated and removed safely',async()=>{
  const {service,request}=await fixture();
  try{
    const filename=(await readdir(path.join(source,'public/fonts'))).find(name=>name.endsWith('.woff2'));
    const bytes=await readFile(path.join(source,'public/fonts',filename));
    const upload=(name,data)=>fetch(service.origin+'/api/appearance/fonts',{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'X-File-Name':encodeURIComponent(name)},body:data});
    assert.equal((await upload('bad.exe',bytes)).status,400);assert.equal((await upload('bad.ttf',Buffer.from('not a font'))).status,400);
    const response=await upload('../../My Font.woff2',bytes);assert.equal(response.status,201);const font=await response.json();assert.equal(font.name,'My Font.woff2');
    assert.equal((await (await upload('duplicate.woff2',bytes)).json()).id,font.id);
    assert.equal((await (await request('/appearance/fonts')).json()).length,1);
    assert.equal((await fetch(service.origin+'/api/appearance/fonts/'+font.id)).status,401);
    const downloaded=await request('/appearance/fonts/'+font.id);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
    await request('/settings',{display:{interfaceFont:font.family,terminalFont:font.family}});
    assert.equal((await request('/appearance/fonts/'+font.id,{},'DELETE')).status,200);
    const settings=await (await request('/settings',{display:{zoom:125}})).json();assert.equal(settings.display.interfaceFont,'Segoe UI');assert.equal(settings.display.terminalFont,'Cascadia Code');assert.equal(settings.display.zoom,125);
    assert.equal((await request('/appearance/fonts/'+font.id)).status,404);
  }finally{await service.close();}
});
test('display updates merge individual fields and native zoom rejects unsafe values',async()=>{
  const {service,request,native}=await fixture();
  try{
    await request('/settings',{display:{interfaceFont:'Geist'}});
    let settings=await (await request('/settings',{display:{terminalFont:'JetBrains Mono'}})).json();assert.equal(settings.display.interfaceFont,'Geist');
    assert.equal((await request('/settings',{display:{interfaceFont:'url(https://example.test)'}})).status,400);
    settings=await (await request('/settings',{})).json();assert.equal(settings.display.interfaceFont,'Geist');
    assert.equal((await request('/window',{window:'workspace',action:'zoom',value:1.25})).status,200);
    assert.equal(native.at(-1).value,1.25);
    assert.equal((await request('/window',{window:'workspace',action:'zoom',value:100})).status,400);
  }finally{await service.close();}
});
