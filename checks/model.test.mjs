import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMarkdown,toMarkdown,normalizePath,remainingDraft,safeLink,sessionStatus } from '../src/devspace/model.ts';

test('Markdown follows the visible composition and keeps rich block kinds',()=>{
 const blocks=[{id:'a',type:'text',text:'First'},{id:'b',type:'quote',text:'Second'},{id:'m',type:'model',text:'Courier',asset:'workspace/devspace/assets/courier.glb'}];
 const flow=[{id:'f-b',type:'block',blockId:'b'},{id:'collection',type:'collection',topicId:'world',view:'list'},{id:'f-a',type:'block',blockId:'a'},{id:'f-m',type:'block',blockId:'m'}];
 const markdown=toMarkdown({blocks,flow});assert.ok(markdown.indexOf('Second')<markdown.indexOf('First'));assert.ok(!markdown.includes('collection'));
 const parsed=fromMarkdown(markdown,blocks);assert.equal(parsed[0].type,'quote');assert.equal(parsed.at(-1).type,'model');assert.equal(parsed.at(-1).asset,blocks[2].asset);
});
test('status derives from live session rather than simulated timers',()=>{
 const s={status:'running',activity:'idle',attention:false,unread:false};
 assert.equal(sessionStatus({...s,activity:'working'}).kind,'working');assert.equal(sessionStatus({...s,attention:true}).kind,'waiting');assert.equal(sessionStatus({...s,unread:true}).kind,'done');assert.equal(sessionStatus({...s,status:'exited'}).kind,'inactive');assert.equal(sessionStatus({...s,status:'exited',exitCode:1}).kind,'error');
 assert.equal(sessionStatus({...s,unread:true,attention:true}).kind,'done','actual completion sets both flags');
});
test('capture clears only the submitted snapshot and preserves input typed during save',()=>{
 const one={path:'one',name:'one',image:false,size:1},two={path:'two',name:'two',image:false,size:1};
 assert.deepEqual(remainingDraft({text:'Старый текст',files:[one]},{text:'Старый текст\nНовая мысль',files:[one,two]}),{text:'\nНовая мысль',files:[two]});
 assert.deepEqual(remainingDraft({text:'A',files:[]},{text:'Исправленное A',files:[]}),{text:'Исправленное A',files:[]});
});
test('markdown round-trip keeps fenced code blank lines, images, checks and stable IDs',()=>{
 const blocks=[{id:'code',type:'code',text:'one\n\ntwo'},{id:'image',type:'image',text:'Остров',asset:'workspace/devspace/assets/example.webp'},{id:'check',type:'check',text:'Готово',checked:true}];
 const parsed=fromMarkdown(toMarkdown({blocks}),blocks);assert.deepEqual(parsed,blocks);
});
test('paths and URLs are safe under Windows and malformed input',()=>{
 assert.equal(normalizePath('C:\\Projects\\Game\\'),'c:/projects/game');assert.equal(safeLink('http://x:bad'),null);assert.equal(safeLink('javascript:alert(1)'),null);assert.equal(safeLink('https://example.com/'),'https://example.com/');
});
