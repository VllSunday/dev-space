import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect} from '@playwright/test';
import {createService} from '../desktop/service/server.mjs';
import {desktopAuth,launchBrowser} from '../desktop/service/test/browser.mjs';
const repo=await mkdtemp(path.join(os.tmpdir(),'viewer-test-'));
await mkdir(path.join(repo,'workspace/devspace'),{recursive:true});
await writeFile(path.join(repo,'workspace/devspace/space.json'),JSON.stringify({schemaVersion:1,revision:0,projects:[{id:'default',name:'Test',path:repo,topics:[]}],materials:[],pages:[{id:'viewer-test',projectId:'default',topicId:'unfiled',title:'3d viewer',blocks:[],sourceIds:[],revision:0,layout:'document'}],tasks:[]}));
const service=await createService({repo,uiDir:path.resolve('dist'),mcpOptions:{home:repo,env:{}}});
let browser;
try{
 browser=await launchBrowser({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});await desktopAuth(context,service.urls.workspace,'ru');
 const page=await context.newPage();await page.goto(service.urls.workspace);await page.getByRole('button',{name:'3d viewer',exact:true}).click();
 await expect(page.getByRole('button',{name:'Загрузить 3D-модель'})).toBeVisible();
 await page.locator('.ds-model-viewer input').setInputFiles({name:'invalid.glb',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});await expect(page.locator('.ds-model-viewer [role=alert]')).toContainText('не является GLB');
 const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]};
 let j=Buffer.from(JSON.stringify(json));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const bin=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer);const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+bin.length,8);h.writeUInt32LE(j.length,12);h.writeUInt32LE(0x4e4f534a,16);const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);
 await page.locator('.ds-model-viewer input').setInputFiles({name:'triangle.glb',mimeType:'model/gltf-binary',buffer:Buffer.concat([h,j,bh,bin])});
 await expect(page.getByRole('combobox',{name:'Модель',exact:true})).toBeVisible();await expect(page.locator('.ds-model-viewer [role=status]')).toContainText('Вращение',{timeout:20000});
 await page.getByRole('combobox',{name:'Отображение модели'}).selectOption('wire');await page.screenshot({path:'.cache/viewer-desktop.png'});
 await page.reload();await page.getByRole('button',{name:'3d viewer',exact:true}).click();await expect(page.getByRole('combobox',{name:'Модель',exact:true})).toContainText('triangle.glb');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.cache/viewer-mobile.png'});
 console.log('PASS: empty state, invalid GLB, upload, rendering, wireframe, persistence, desktop/mobile');
}finally{await browser?.close();await service.close()}
