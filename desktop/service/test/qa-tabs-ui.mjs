import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../server.mjs';
import { launchBrowser, desktopAuth, clipboardPermissions } from './browser.mjs';
const root = process.cwd(), repo = await mkdtemp(path.join(root, '.cache/qa-tabs-'));
await mkdir(path.join(repo,'workspace'));
const registry = JSON.parse(await readFile(path.join(root,'workspace/workspace.json'),'utf8'));
for (const folder of new Set(registry.entities.map(e=>e.folder))) await cp(path.join(root,'workspace',folder),path.join(repo,'workspace',folder),{recursive:true});
await writeFile(path.join(repo,'workspace/workspace.json'),JSON.stringify(registry));
await cp(path.join(root,'dist'),path.join(repo,'ui'),{recursive:true});
await cp(path.join(root,'public/assets'),path.join(repo,'ui/assets'),{recursive:true});
const service = await createService({repo,uiDir:path.join(repo,'ui'),mcpOptions:{home:repo,env:{}}});
const browser = await launchBrowser();
try {
  const context = await browser.newContext({viewport:{width:1440,height:1000},permissions:clipboardPermissions});
  await desktopAuth(context,service.urls.workspace,'ru');
  const page = await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(service.urls.workspace);
  const tablist = page.getByRole('tablist',{name:'Вкладки спейса'});
  await expect(tablist.getByRole('tab')).toHaveCount(9);
  // Every prepared tab has useful editable notes; none are invented tasks.
  for (const section of registry.spaces.find(s=>s.id==='app-qa').sections) {
    await page.locator(`#space-section-${section.id}`).click();
    await expect(page.locator(`#space-section-${section.id}`)).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.tab-notes a').first()).toBeVisible();
    await expect(page.locator('.task-row')).toHaveCount(registry.entities.filter(e=>e.category===section.id && e.purpose!=='reference' && e.status!=='archived').length);
    await page.getByRole('button',{name:'Передать вкладку агенту',exact:true}).click();
    assert.match(await page.evaluate(()=>navigator.clipboard.readText()),new RegExp('category "'+section.id+'" only'));
    const note = page.locator('.tab-notes a').first(); await note.click();
    await expect(page.locator('.editable-card')).toBeVisible();
    await expect(page.locator(`#space-section-${section.id}`)).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.card-entry').first()).toBeVisible();
    await page.locator(`#space-section-${section.id}`).click();
    await page.screenshot({path:path.join(repo,`tab-${section.id}.png`)});
  }
  // Keyboard activation follows the same navigation and focus.
  await page.locator('#space-section-bugs').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#space-section-ux-ui')).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'Управление вкладками',exact:true}).click();
  const manager = page.getByRole('dialog',{name:'Управление вкладками'});
  await manager.getByLabel('Название новой вкладки',{exact:true}).fill('Release');
  await manager.getByRole('button',{name:'Добавить вкладку',exact:true}).click();
  await expect(manager.getByLabel('Название вкладки: Release',{exact:true})).toBeVisible();
  await manager.getByLabel('Название вкладки: Release',{exact:true}).fill('Regression');
  await manager.getByRole('button',{name:'Сохранить: Release',exact:true}).click();
  await expect(manager.getByLabel('Название вкладки: Regression',{exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'Переместить вкладку влево: Regression',exact:true}).click();
  await expect(manager.getByRole('button',{name:'Переместить вкладку влево: Regression',exact:true})).toBeEnabled();
  let state=JSON.parse(await readFile(path.join(repo,'workspace/workspace.json'),'utf8'));
  const space=state.spaces.find(s=>s.id==='app-qa'), custom=space.sections.find(s=>s.name==='Regression');
  assert.equal(space.sections.at(-2).id,custom.id);
  await manager.getByRole('button',{name:'Закрыть',exact:true}).click();
  await tablist.getByRole('tab',{name:'Regression',exact:true}).click();
  await page.getByRole('button',{name:'+ Новая карточка',exact:true}).click();
  const intake=page.getByRole('dialog',{name:'Новая запись'});
  await expect(intake.getByLabel('Вкладка',{exact:true})).toHaveValue(custom.id);
  await intake.getByLabel('Короткое название').fill('Custom tab task');
  await intake.getByLabel('Описание и мысли').fill('Keep this in my custom tab.');
  await intake.getByRole('button',{name:'Сохранить запись',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Custom tab task',exact:true})).toBeVisible();
  await expect(tablist.getByRole('tab',{name:'Regression',exact:true})).toHaveAttribute('aria-selected','true');
  await page.reload();
  await expect(tablist.getByRole('tab',{name:'Regression',exact:true})).toHaveAttribute('aria-selected','true');
  state=JSON.parse(await readFile(path.join(repo,'workspace/workspace.json'),'utf8'));
  const task=state.entities.find(e=>e.title==='Custom tab task'); assert.equal(task.category,custom.id);
  await page.getByRole('button',{name:'Управление вкладками',exact:true}).click();
  await manager.getByRole('button',{name:'Удалить вкладку: Regression',exact:true}).click();
  await expect(manager.getByRole('alert')).toBeVisible();
  await expect(manager.getByLabel('Название вкладки: Regression',{exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'Закрыть',exact:true}).click();
  const headers={Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(service.origin+`/api/workspace/entities/${task.id}`,{method:'PATCH',headers,body:JSON.stringify({category:'inbox'})})).status,200);
  await page.reload();
  await page.getByRole('button',{name:'Управление вкладками',exact:true}).click();
  await manager.getByRole('button',{name:'Удалить вкладку: Regression',exact:true}).click();
  await expect(manager.getByLabel('Название вкладки: Regression',{exact:true})).toHaveCount(0);
  await manager.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('#space-section-home')).toHaveAttribute('aria-selected','true');
  // Responsive tab navigation remains reachable in both themes.
  for (const theme of ['dark','light']) {
    await fetch(service.origin+'/api/settings',{method:'POST',headers,body:JSON.stringify({workspaceTheme:theme})});
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme',theme);
    for (const width of [1440,768,390]) {
      await page.setViewportSize({width,height:1000});
      for(const tab of await tablist.getByRole('tab').all()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected','true');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow at ${width}`);
      }
      await page.locator('#space-section-ux-ui').click();
      assert.equal(await page.locator('img').evaluateAll(images => images.filter(image=>!image.complete || !image.naturalWidth).length),0,'Visible assets load');
      await page.screenshot({path:path.join(root,`.cache/qa-tabs-${theme}-${width}.png`)});
      await page.getByRole('button',{name:'Управление вкладками',exact:true}).click();
      assert.ok(await manager.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Manager fits');
      await manager.getByRole('button',{name:'Закрыть',exact:true}).click();
    }
  }
  assert.deepEqual(errors,[]);
  console.log('QA tabs passed: prepared notes, scoped agent briefs, create/rename/reorder/delete, occupied-tab protection, custom task routing, reload, keyboard and all tabs at 1440/768/390 in dark/light.');
} finally {await browser.close();await service.close();}
