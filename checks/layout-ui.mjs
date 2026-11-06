// Render the actual desktop shell; an unconstrained flex child used to leave
// most of a maximized window empty. No CLI agent or user workspace is opened.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../desktop/service/server.mjs';
import { desktopAuth, launchBrowser } from '../desktop/service/test/browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = await mkdtemp(path.join(os.tmpdir(), 'dev-space-layout-'));
await mkdir(path.join(repo, 'workspace'));
await writeFile(path.join(repo, 'workspace/workspace.json'), JSON.stringify({ entities: [] }));
const service = await createService({ repo, uiDir: path.join(root, 'dist'), mcpOptions: { home: repo, env: {} } });
let browser;
try {
  browser = await launchBrowser();
  const context = await browser.newContext();
  await desktopAuth(context, service.urls.workspace, 'ru');
  const page = await context.newPage();
  await page.goto(service.urls.workspace);
  await page.locator('.dev-space .ds-canvas').waitFor();
  const results = [];
  for (const width of [901, 960, 1150, 1151, 1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const collapsed of [false, true]) {
      if (await page.locator('.dev-space').evaluate(el => el.classList.contains('project-nav-collapsed')) !== collapsed) await page.keyboard.press('Control+b');
      for (const agentsOpen of [false, true]) {
        if (await page.locator('.ds-agent-pane').count() !== Number(agentsOpen)) await page.keyboard.press('Control+j');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const rects = await page.evaluate(() => {
          const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && { left: r.left, right: r.right, width: r.width }; };
          return { shell: rect('.dev-space'), canvas: rect('.ds-canvas'), pane: rect('.ds-agent-pane'), viewport: innerWidth, scroll: document.documentElement.scrollWidth };
        });
        assert.ok(Math.abs(rects.shell.width - width) <= 1, `shell must fill ${width}px: ${JSON.stringify(rects)}`);
        assert.ok(Math.abs((agentsOpen&&width<=1150?rects.pane.right:rects.canvas.right) - (width - 8)) <= 1, `rightmost area must reach the window edge: ${JSON.stringify(rects)}`);
        assert.ok(rects.scroll <= width, `shell must not overflow: ${JSON.stringify(rects)}`);
        assert.ok(rects.canvas.width >= 350, 'workspace must remain usable');
        if (agentsOpen&&width>1150) assert.ok(rects.pane.right <= rects.canvas.left, 'left agent pane must precede the project without overlap');
        if (agentsOpen&&width<=1150) assert.ok(rects.pane.left>=0&&rects.pane.right<=width, 'narrow agent area must stay fully inside the window');
        results.push({ width, collapsed, agentsOpen, canvasWidth: Math.round(rects.canvas.width) });
      }
    }
  }
  const handle=page.getByRole('separator',{name:'Ширина области агентов',exact:true}),before=await page.locator('.ds-agent-pane').boundingBox(),box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2);await page.mouse.up();
  const after=await page.locator('.ds-agent-pane').boundingBox();assert.ok(after.width>before.width+60,'dragging a left dock divider right should make the dock wider');
  await handle.focus();await handle.press('ArrowRight');assert.ok((await page.locator('.ds-agent-pane').boundingBox()).width>after.width,'ArrowRight should widen the left-hand dock');
  console.log(JSON.stringify({ passed: results.length, results, leftDockResize:true }, null, 2));
} finally {
  await browser?.close();
  await service.close();
}
