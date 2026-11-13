import path from 'node:path';
import { mkdir, readFile, readdir, stat, writeFile, unlink, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { saveJson, realFile } from './util.mjs';
import { instantiateTemplate } from './project-template.mjs';
import { pageFlow, reconcileFlow, validateFlow } from './page-flow.mjs';
import { boardKind, boardName, ensureBoards, makeZone, nextPlace, presetBoard, pruneBoards, refExists, zoneColors, zonePatch, zoneSource } from './boards.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = prefix => `${prefix}-${randomUUID().slice(0, 12)}`;
const now = () => new Date().toISOString();
const text = (value, max = 200000) => { if (typeof value !== 'string' || value.length > max) throw fail('Некорректный текст или превышен размер.'); return value; };
const name = value => { const v = text(value, 160).trim(); if (!v) throw fail('Введите название.'); return v; };
const types = new Set(['text', 'heading', 'bullet', 'check', 'quote', 'code', 'image', 'divider', 'model']);
const ref = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
function blocks(value) {
  if (!Array.isArray(value) || value.length > 3000) throw fail('Некорректные блоки страницы.');
  const ids = new Set();
  return value.map(b => {
    if (!b || !ref(b.id) || ids.has(b.id) || !types.has(b.type)) throw fail('Некорректный тип или ID блока.');
    ids.add(b.id);
    if (['image','model'].includes(b.type) && (typeof b.asset !== 'string' || !/^workspace\/devspace\/assets\/[a-zA-Z0-9._-]+$/.test(b.asset) || b.type==='model'&&!/\.glb$/i.test(b.asset))) throw fail('Некорректное вложение.');
    return { id: b.id, type: b.type, text: text(b.text || ''), ...(['image','model'].includes(b.type) ? { asset: b.asset } : {}), ...(b.type === 'check' ? { checked: !!b.checked } : {}) };
  });
}
export function validateProposal(value, state) {
  if (!value || value.schemaVersion !== 1 || !state.projects.some(p => p.id === value.projectId)) throw fail('Предложение относится к неизвестному проекту.');
  if (!Number.isSafeInteger(value.baseRevision) || !Array.isArray(value.sourceIds) || value.sourceIds.length > 2000) throw fail('Укажите версию и источники предложения.');
  const sources = value.sourceIds.map(source => { if (!state.materials.some(m => m.id === source && m.projectId === value.projectId)) throw fail('Источник предложения не найден в проекте.'); return source; });
  const result={ schemaVersion: 1, projectId: value.projectId, topicId: value.topicId || 'unfiled', baseRevision: value.baseRevision, title: name(value.title), blocks: blocks(value.blocks), sourceIds: sources, layout: value.layout === 'wiki' ? 'wiki' : 'document' };
  if(value.flow!==undefined)try{result.flow=validateFlow(value.flow,result,state.projects.find(p=>p.id===value.projectId));}catch(error){throw fail(error.message)}
  return result;
}
export class DevSpace {
  constructor(repo, changed = () => {}) { this.repo = repo; this.folder = path.join(repo, 'workspace', 'devspace'); this.file = path.join(this.folder, 'space.json'); this.changed = changed; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(this.folder, { recursive: true });
    await mkdir(path.join(this.folder, 'assets'), { recursive: true });
    await mkdir(path.join(this.folder, 'proposals'), { recursive: true });
    await mkdir(path.join(this.folder, 'history'), { recursive: true });
    try { await readFile(this.file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let legacy; try { legacy = JSON.parse(await readFile(path.join(this.repo, 'workspace', 'workspace.json'), 'utf8')); } catch { legacy = { entities: [] }; }
      const projects = (legacy.spaces?.length ? legacy.spaces : [{ id: 'default', name: 'Мой проект', sections: [] }]).map(p => ({ id: p.id, name: p.name, path: this.repo, topics: (p.sections || []).filter(t => !['inbox', 'context'].includes(t.id)).map(t => ({ id: t.id, name: t.name })) }));
      const materials = (legacy.entities || []).map(m => ({ id: m.id, projectId: projects.some(p => p.id === m.spaceId) ? m.spaceId : projects[0].id, topicId: projects.find(p=>p.id===(m.spaceId||projects[0].id))?.topics.some(t=>t.id===m.category) ? m.category : 'unfiled', title: m.title, text: m.description || '', kind: 'legacy', legacyId: m.id, files: [], archived: m.status === 'archived', created: m.created || now(), updated: now() }));
      const fresh = { schemaVersion: 1, revision: 0, projects, materials, pages: [], tasks: [] };
      ensureBoards(fresh);
      await saveJson(this.file, fresh);
    }
    await this.addBoards();
    return this;
  }
  // Projects saved before boards existed get their first board here. The change
  // only adds `boards`; a copy of the file is kept and the step can be undone.
  async addBoards() {
    const state = JSON.parse(await readFile(this.file, 'utf8'));
    if (state.schemaVersion !== 1 || !Array.isArray(state.projects)) return;
    const before = structuredClone(state);
    if (!ensureBoards(state)) return;
    if (!before.boards) await writeFile(path.join(this.folder, 'space.before-boards.json'), JSON.stringify(before, null, 2) + '\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await saveJson(path.join(this.folder, 'history', state.revision + '.json'), before);
    state.revision++;
    await saveJson(this.file, state);
  }
  async read() {
    const state = JSON.parse(await readFile(this.file, 'utf8'));
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !['projects','materials','pages','tasks'].every(k => Array.isArray(state[k]))) throw fail('Хранилище повреждено. Восстановите копию из history.', 500);
    state.boards ||= [];
    return state;
  }
  async proposals() {
    const state = await this.read(), list = [];
    const applied = new Set(state.appliedProposals || []);
    for (const file of (await readdir(path.join(this.folder, 'proposals'))).filter(f => /^[\w-]+\.json$/.test(f)).slice(0, 100)) {
      try { if (applied.has(file.slice(0,-5))) continue; const source = path.join(this.folder, 'proposals', file); if ((await stat(source)).size > 4 * 1024 * 1024) continue; const value = validateProposal(JSON.parse(await readFile(source, 'utf8')), state); list.push({ id: file.slice(0,-5), ...value, stale: value.baseRevision !== state.revision }); } catch (error) { list.push({ id: file.slice(0,-5), error: error.message }); }
    }
    return list;
  }
  async upload(request, filename) {
    const rawName = path.basename(text(filename || 'file', 400));
    const suffix = path.extname(rawName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 16);
    const relative = `workspace/devspace/assets/${randomUUID()}${suffix}`;
    const output = path.join(this.repo, relative);
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 100 * 1024 * 1024) throw fail('Файл должен быть не больше 100 МБ.', 413); chunks.push(chunk); }
    await writeFile(output, Buffer.concat(chunks), { flag: 'wx' });
    return { path: relative, name: rawName, size, image: ['.png','.jpg','.jpeg','.webp','.gif','.bmp','.svg','.avif'].includes(suffix) };
  }
  async importFile(source) {
    if(typeof source!=='string'||!source.trim()||source.length>32768)throw fail('Выберите файл для добавления.');
    const file=path.resolve(source),info=await stat(file).catch(()=>null);
    if(!info?.isFile())throw fail('Добавьте файл, а не папку.');
    if(info.size>100*1024*1024)throw fail('Файл должен быть не больше 100 МБ.',413);
    return this.upload(createReadStream(file),path.basename(file));
  }
  async readDraft(key) {
    if (typeof key !== 'string' || key.length > 260 || /[\x00-\x1f]/.test(key)) throw fail('Некорректный адрес черновика.');
    let drafts; try { drafts=JSON.parse(await readFile(path.join(this.folder,'drafts.json'),'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; drafts={}; }
    return drafts[key] || {text:'',files:[],version:0};
  }
  saveDraft(data) {
    const operation=this.queue.catch(()=>{}).then(async()=>{
      await this.readDraft(data.key);
      if(!Number.isSafeInteger(data.version)||data.version<0)throw fail('Некорректная версия черновика.');
      const content=text(data.text||''),files=await this.validateFiles(data.files||[]);
      let drafts;try{drafts=JSON.parse(await readFile(path.join(this.folder,'drafts.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;drafts={};}
      if((drafts[data.key]?.version||0)>data.version)return drafts[data.key];
      drafts[data.key]={text:content,files,version:data.version,baseline:typeof data.baseline==='string'?text(data.baseline):null,cleared:!!data.cleared};await saveJson(path.join(this.folder,'drafts.json'),drafts);return drafts[data.key];
    });this.queue=operation;return operation;
  }
  // `latest` is for changes the service makes itself (a flow step, a plugin
  // operation): they apply to whatever the current version is.
  mutate(data, { latest = false } = {}) {
    const next = this.queue.catch(() => {}).then(async () => {
      const state = await this.read();
      if (!latest && data.baseRevision !== state.revision) throw fail('Содержимое изменилось. Обновите данные и повторите действие; ваш черновик сохранён.', 409);
      const before = structuredClone(state), project = state.projects.find(p => p.id === data.projectId);
      const topicExists = (p, t) => t === 'unfiled' || p?.topics.some(x => x.id === t);
      const material = state.materials.find(m => m.id === data.id), page = state.pages.find(p => p.id === data.id);
      const board = state.boards.find(b => b.id === data.boardId), boardProject = board && state.projects.find(p => p.id === board.projectId), zone = board?.zones.find(z => z.id === data.zoneId);
      const needBoard = () => { if (!board || !boardProject) throw fail('Доска не найдена.', 404); return board; };
      const needZone = () => { needBoard(); if (!zone) throw fail('Зона не найдена.', 404); return zone; };
      // A new thing created inside a hand-picked zone is added to that zone.
      const place = ref => { if (zone?.source.kind === 'refs' && board.projectId === project?.id && !zone.source.refs.includes(ref)) zone.source.refs.unshift(ref); };
      switch (data.action) {
        case 'import-template': {
          const example=await instantiateTemplate(this.repo,data.templateId),base=example.projects[0].name;
          let suffix=2;while(state.projects.some(p=>p.name===example.projects[0].name))example.projects[0].name=base+' ('+(suffix++)+')';
          for(const key of ['projects','pages','materials','tasks'])state[key].push(...example[key]);
          break;
        }
        case 'create-project': {
          let folder = data.path?.trim() || this.repo; folder = path.resolve(folder);
          if (!(await stat(folder).catch(() => null))?.isDirectory()) throw fail('Выберите существующую папку проекта.');
          const created = { id: id('project'), name: name(data.name), path: folder, topics: [] }; state.projects.push(created); state.boards.push(presetBoard(state, created, data.preset || 'empty')); break;
        }
        case 'rename-project': if (!project) throw fail('Проект не найден.'); project.name = name(data.name); break;
        case 'project-home': if (!project || data.pageId && !state.pages.some(p=>p.id===data.pageId&&p.projectId===project.id)) throw fail('Главная страница проекта не найдена.'); project.homePageId = data.pageId || null; break;
        case 'project-path': if (!project || !(await stat(data.path).catch(() => null))?.isDirectory()) throw fail('Папка проекта не найдена.'); project.path = path.resolve(data.path); break;
        case 'navigation-color': {
          if(!project)throw fail('Проект не найден.');
          const keys=['all','unfiled','images','tasks','archive',...project.topics.map(t=>'topic:'+t.id),...state.pages.filter(p=>p.projectId===project.id).map(p=>'page:'+p.id)];
          if(!keys.includes(data.key))throw fail('Пункт навигации больше не существует.',404);
          if(data.color!==null&&data.color!==''&&(typeof data.color!=='string'||!/^#[0-9a-f]{6}$/i.test(data.color)))throw fail('Выберите цвет в формате #RRGGBB.');
          const colors={...project.navigationColors};if(!data.color)delete colors[data.key];else colors[data.key]=data.color.toLowerCase();project.navigationColors=colors;break;
        }
        case 'page-icon': {
          if(!page||page.projectId!==project?.id)throw fail('Страница не найдена.');
          if(typeof data.icon!=='string')throw fail('Некорректный значок.');
          const value=text(data.icon,32).trim();if(/[\x00-\x1f\x7f]/.test(value))throw fail('Некорректный значок.');
          page.icon=value;page.updated=now();page.revision++;break;
        }
        case 'create-topic': if (!project) throw fail('Проект не найден.'); project.topics.push({ id: id('topic'), name: name(data.name) }); break;
        case 'rename-topic': { const t = project?.topics.find(t => t.id === data.id); if (!t) throw fail('Тема не найдена.'); t.name = name(data.name); break; }
        case 'topic-icon': {const t=project?.topics.find(t=>t.id===data.id);if(!t)throw fail('Тема не найдена.');const value=text(data.icon||'',32).trim();if(/[\x00-\x1f\x7f]/.test(value))throw fail('Некорректный значок.');t.icon=value;break;}
        case 'topic-media': {
          const t=project?.topics.find(t=>t.id===data.topicId);if(!t)throw fail('Тема не найдена.');
          const files=await this.validateFiles(data.files),added=[];
          if(!files.length)throw fail('Выберите изображение или GLB.');
          for(const file of files){
            const model=/\.glb$/i.test(file.path),image=/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.path);
            if(!model&&!image)throw fail('В описание темы можно добавить изображения или GLB 2.0.');
            if(model){const verified=await realFile(this.repo,file.path),handle=await open(verified.file,'r');try{const header=Buffer.alloc(12),{bytesRead}=await handle.read(header,0,12,0);if(bytesRead!==12||header.readUInt32LE(0)!==0x46546c67||header.readUInt32LE(4)!==2||header.readUInt32LE(8)!==verified.info.size)throw fail('Файл «'+file.name+'» не является GLB 2.0.')}finally{await handle.close()}}
            if(!(t.blocks||[]).some(b=>b.asset===file.path)&&!added.some(b=>b.asset===file.path))added.push({id:id('block'),type:model?'model':'image',text:file.name,asset:file.path});
          }
          t.blocks=blocks([...(t.blocks||[]),...added]);break;
        }
        case 'topic-block': {const t=project?.topics.find(t=>t.id===data.topicId);if(!t)throw fail('Тема не найдена.');t.blocks||=[];const block=blocks([data.block])[0],at=t.blocks.findIndex(b=>b.id===block.id);if(at<0)t.blocks.push(block);else t.blocks[at]=block;break;}
        case 'topic-patch-block': {const t=project?.topics.find(t=>t.id===data.topicId),at=t?.blocks?.findIndex(b=>b.id===data.blockId);if(at===undefined||at<0)throw fail('Блок темы больше не существует.',409);const patch={};for(const field of ['text','type','checked'])if(data.patch?.[field]!==undefined)patch[field]=data.patch[field];t.blocks[at]=blocks([{...t.blocks[at],...patch}])[0];break;}
        case 'topic-delete-block': {const t=project?.topics.find(t=>t.id===data.topicId);if(!t)throw fail('Тема не найдена.');t.blocks=(t.blocks||[]).filter(b=>b.id!==data.blockId);break;}
        case 'topic-move-block': {const t=project?.topics.find(t=>t.id===data.topicId);if(!t)throw fail('Тема не найдена.');const list=t.blocks||[],i=list.findIndex(b=>b.id===data.blockId),j=i+(data.direction==='up'?-1:1);if(i>=0&&j>=0&&j<list.length)[list[i],list[j]]=[list[j],list[i]];break;}
        case 'page-flow': {if(!page)throw fail('Страница не найдена.');if(data.expectedPageRevision!==page.revision)throw fail('Страница изменилась. Повторите изменение композиции.',409);try{page.flow=validateFlow(data.flow,page,state.projects.find(p=>p.id===page.projectId));}catch(error){throw fail(error.message)}page.revision++;page.updated=now();break;}
        case 'move-topic': { const i = project?.topics.findIndex(t => t.id === data.id), j = i + (data.direction === 'up' ? -1 : 1); if (i === undefined || i < 0 || j < 0 || j >= project.topics.length) break; [project.topics[i],project.topics[j]] = [project.topics[j],project.topics[i]]; break; }
        case 'delete-topic': if (!project) throw fail('Проект не найден.'); project.topics = project.topics.filter(t => t.id !== data.id); for (const list of [state.materials,state.pages,state.tasks]) for (const item of list) if (item.projectId === project.id && item.topicId === data.id) item.topicId = 'unfiled'; for(const p of state.pages)if(p.projectId===project.id){if(p.collections)p.collections=p.collections.filter(c=>c.topicId!==data.id);if(p.flow)p.flow=p.flow.filter(n=>n.type!=='collection'||n.topicId!==data.id);}
          // Zones of the removed topic keep showing its materials, which are now unfiled.
          for (const b of state.boards) if (b.projectId === project.id) { const unfiled = b.zones.some(z => z.source.kind === 'topic' && z.source.topicId === 'unfiled'); let kept = unfiled; b.zones = b.zones.filter(z => { if (z.source.kind !== 'topic' || z.source.topicId !== data.id) return true; if (kept) return false; kept = true; z.source = { kind: 'topic', topicId: 'unfiled' }; return true; }); }
          break;
        case 'create-material': {
          if (!project || !topicExists(project, data.topicId)) throw fail('Тема не найдена.');
          const files = await this.validateFiles(data.files || []), content = text(data.text || '');
          if (data.modelPageId && !state.pages.some(p=>p.id===data.modelPageId&&p.projectId===project.id)) throw fail('Страница для 3D-модели не найдена.');
          if (!content.trim() && !files.length) throw fail('Добавьте текст или файл.');
          state.materials.unshift({ id: id('material'), projectId: project.id, topicId: data.topicId, title: (data.title || content.split('\n')[0] || files[0]?.name || 'Без названия').slice(0,160), text: content, kind: files.some(f => f.image) ? 'image' : files.length ? 'file' : /^https?:\/\/\S+$/.test(content) ? 'link' : 'note', files, ...(data.modelPageId ? {modelPageId: data.modelPageId} : {}), archived: false, created: now(), updated: now() }); place('material:' + state.materials[0].id); break;
        }
        case 'update-material': if (!material) throw fail('Материал не найден.'); if (data.title !== undefined) material.title = name(data.title); if (data.text !== undefined) material.text = text(data.text); if (data.topicId !== undefined) { if (!topicExists(state.projects.find(p=>p.id===material.projectId),data.topicId)) throw fail('Тема не найдена.'); material.topicId = data.topicId; } if (data.archived !== undefined) material.archived = !!data.archived; material.updated = now(); break;
        case 'material-files': {
          if(!material)throw fail('Материал не найден.');
          const add=await this.validateFiles(data.add||[]),remove=data.remove||[];
          if(!Array.isArray(remove)||remove.length>100||remove.some(p=>typeof p!=='string'||!/^workspace\/devspace\/assets\/[a-zA-Z0-9._-]+$/.test(p)))throw fail('Некорректное вложение для удаления.');
          const files=new Map(material.files.filter(f=>!remove.includes(f.path)).map(f=>[f.path,f]));
          for(const file of add)if(!files.has(file.path))files.set(file.path,file);
          if(files.size>100)throw fail('В материале может быть не больше 100 вложений.');
          material.files=[...files.values()];
          if(material.kind!=='legacy')material.kind=material.files.some(f=>f.image)?'image':material.files.length?'file':/^https?:\/\/\S+$/.test(material.text.trim())?'link':'note';
          material.updated=now();break;
        }
        case 'delete-materials': {
          if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>2000||data.ids.some(value=>typeof value!=='string'||!state.materials.some(m=>m.id===value)))throw fail('Выберите существующие материалы для удаления.');
          const ids=new Set(data.ids);state.materials=state.materials.filter(m=>!ids.has(m.id));
          for(const item of state.pages){if(item.sourceIds)item.sourceIds=item.sourceIds.filter(value=>!ids.has(value));for(const entry of [...item.collections||[],...item.flow||[]])if(entry.pinnedIds)entry.pinnedIds=entry.pinnedIds.filter(value=>!ids.has(value));}
          for(const task of state.tasks)if(ids.has(task.sourceId))task.sourceId=null;
          break;
        }
        case 'create-page': if (!project) throw fail('Проект не найден.'); state.pages.push({ id: id('page'), projectId: project.id, topicId: data.topicId || 'unfiled', title: name(data.title || 'Новая страница'), blocks: blocks(data.blocks || [{id:id('block'),type:'text',text:''}]), layout: data.layout === 'wiki' ? 'wiki' : 'document', ...(data.layout==='wiki'?{collections:[]}:{}), sourceIds: [], revision: 0, updated: now() }); place('page:' + state.pages.at(-1).id); break;
        case 'update-page': if (!page) throw fail('Страница не найдена.'); if (data.title !== undefined) page.title = name(data.title); if (data.blocks !== undefined) { if(data.expectedPageRevision!==page.revision)throw fail('Страница изменилась во время редактирования Markdown. Ваш текст сохранён в редакторе; сравните версии.',409);const nextBlocks=blocks(data.blocks);page.flow=reconcileFlow(page.flow,page.blocks,nextBlocks);page.blocks=nextBlocks; } if (data.layout !== undefined) page.layout = data.layout === 'wiki' ? 'wiki' : 'document'; page.updated = now(); page.revision++; break;
        case 'collection': {
          if(!page)throw fail('Страница не найдена.');const owner=state.projects.find(p=>p.id===page.projectId);
          if(data.pinId!==undefined&&(data.enabled!==undefined||typeof data.pinned!=='boolean')||data.pinId===undefined&&typeof data.enabled!=='boolean')throw fail('Укажите действие с коллекцией.');
          if(!['list','tiles','gallery'].includes(data.view)||!(data.topicId==='all'||topicExists(owner,data.topicId)))throw fail('Коллекция не найдена в проекте.');
          const list=page.flow?structuredClone(page.flow.filter(n=>n.type==='collection').filter((n,i,a)=>a.findIndex(c=>c.topicId===n.topicId&&c.view===n.view)===i)):page.collections?structuredClone(page.collections):(page.layout==='wiki'?owner.topics.map(t=>({topicId:t.id,view:'list',pinnedIds:[]})):[]);
          let i=list.findIndex(c=>c.topicId===data.topicId&&c.view===data.view);
          if(data.enabled===false){if(i>=0)list.splice(i,1)}
          else if(data.enabled===true&&i<0){if(list.length>=200)throw fail('На странице можно закрепить не больше 200 коллекций.');list.push({topicId:data.topicId,view:data.view,pinnedIds:[]});i=list.length-1}
          if(data.pinId!==undefined){const source=state.materials.find(m=>m.id===data.pinId&&m.projectId===page.projectId&&!m.archived&&(data.topicId==='all'||m.topicId===data.topicId)&&(data.view!=='gallery'||m.files.some(f=>f.image)));if(!source||i<0)throw fail('Материал не найден в коллекции.');const pins=(list[i].pinnedIds||[]).filter(id=>state.materials.some(m=>m.id===id&&m.projectId===page.projectId&&!m.archived&&(data.topicId==='all'||m.topicId===data.topicId)&&(data.view!=='gallery'||m.files.some(f=>f.image))));if(data.pinned===true&&!pins.includes(data.pinId)){if(pins.length>=8)throw fail('Можно закрепить до 8 записей в превью.');pins.push(data.pinId)}list[i].pinnedIds=data.pinned===false?pins.filter(id=>id!==data.pinId):pins}
          if(page.flow){const remaining=new Map(list.map(c=>[c.topicId+':'+c.view,c])),seen=new Set();page.flow=page.flow.flatMap(n=>{if(n.type!=='collection')return [n];const key=n.topicId+':'+n.view,c=remaining.get(key);seen.add(key);return c?[{...c,id:n.id,type:'collection'}]:[]});for(const [key,c] of remaining)if(!seen.has(key))page.flow.push({...c,id:id('flow'),type:'collection'});}page.collections=list;page.revision++;page.updated=now();break;
        }
        case 'patch-block': { if(!page)throw fail('Страница не найдена.');const index=page.blocks.findIndex(b=>b.id===data.blockId);if(index<0)throw fail('Блок больше не существует.',409);const patch={};for(const field of ['text','type','checked'])if(data.patch?.[field]!==undefined)patch[field]=data.patch[field];page.blocks[index]=blocks([{...page.blocks[index],...patch}])[0];page.revision++;page.updated=now();break; }
        case 'block': { if (!page) throw fail('Страница не найдена.'); const block = blocks([data.block])[0], index = page.blocks.findIndex(b => b.id === block.id); if (index >= 0) page.blocks[index] = block; else {if(data.flowIndex!==undefined&&!page.flow)page.flow=pageFlow(page,state.projects.find(p=>p.id===page.projectId));if(page.flow)page.flow.splice(Number.isInteger(data.flowIndex)?Math.max(0,Math.min(data.flowIndex,page.flow.length)):page.flow.length,0,{id:'flow-'+block.id,type:'block',blockId:block.id});page.blocks.splice(Number.isInteger(data.index) ? Math.max(0, Math.min(page.blocks.length, data.index)) : page.blocks.length,0,block);} page.revision++; page.updated=now(); break; }
        case 'delete-block': if (!page) throw fail('Страница не найдена.'); page.blocks = page.blocks.filter(b => b.id !== data.blockId);if(page.flow)page.flow=page.flow.filter(n=>n.type!=='block'||n.blockId!==data.blockId); page.revision++; break;
        case 'move-block': { if (!page) throw fail('Страница не найдена.'); const i=page.blocks.findIndex(b=>b.id===data.blockId),j=i+(data.direction==='up'?-1:1); if (i>=0&&j>=0&&j<page.blocks.length) [page.blocks[i],page.blocks[j]]=[page.blocks[j],page.blocks[i]]; page.revision++; break; }
        case 'create-task': if (!project) throw fail('Проект не найден.'); state.tasks.push({id:id('task'),projectId:project.id,topicId:data.topicId||'unfiled',title:name(data.title),status:['todo','working','review','done'].includes(data.status)?data.status:'todo',sourceId:data.sourceId||null}); place('task:' + state.tasks.at(-1).id); break;
        case 'task': { const task=state.tasks.find(t=>t.id===data.id); if(!task||!['todo','working','review','done'].includes(data.status)) throw fail('Задача или статус не найдены.'); task.status=data.status; break; }
        case 'update-task': { const task = state.tasks.find(t => t.id === data.id); if (!task) throw fail('Задача не найдена.'); if (data.title !== undefined) task.title = name(data.title); if (data.status !== undefined) { if (!['todo','working','review','done'].includes(data.status)) throw fail('Статус не найден.'); task.status = data.status; } break; }
        case 'delete-task': if (!state.tasks.some(t => t.id === data.id)) throw fail('Задача не найдена.'); state.tasks = state.tasks.filter(t => t.id !== data.id); break;
        case 'delete-page': { if (!page) throw fail('Страница не найдена.'); state.pages = state.pages.filter(p => p.id !== page.id); for (const p of state.projects) if (p.homePageId === page.id) p.homePageId = null; for (const m of state.materials) if (m.modelPageId === page.id) delete m.modelPageId; break; }
        case 'board-create': { if (!project) throw fail('Проект не найден.'); if (state.boards.filter(b => b.projectId === project.id).length >= 50) throw fail('В проекте может быть до 50 досок.'); state.boards.push({ id: id('board'), projectId: project.id, name: boardName(data.name || 'Новая доска'), kind: 'core/free', zones: [] }); break; }
        case 'board-update': { needBoard(); if (data.name !== undefined) board.name = boardName(data.name); if (data.kind !== undefined) board.kind = boardKind(data.kind); break; }
        case 'board-delete': { needBoard(); if (state.boards.filter(b => b.projectId === board.projectId).length < 2) throw fail('У проекта должна остаться хотя бы одна доска.'); state.boards = state.boards.filter(b => b !== board); break; }
        case 'zone-create': {
          needBoard(); if (board.zones.length >= 200) throw fail('На доске может быть до 200 зон.');
          const label = boardName(data.name || 'Новая зона');
          let source = data.source;
          // A new zone for notes and files gets its own topic, so its things stay together everywhere.
          if (!source) { const topic = { id: id('topic'), name: label }; boardProject.topics.push(topic); source = { kind: 'topic', topicId: topic.id }; }
          const created = makeZone(state, board.projectId, { name: label, view: zonePatch({ view: data.view || 'core/list' }).view, source: zoneSource(source, state, boardProject), color: zonePatch({ color: data.color ?? zoneColors[board.zones.length % zoneColors.length] }).color });
          Object.assign(created, nextPlace(board, created.w), zonePatch({ x: data.x, y: data.y, w: data.w, h: data.h }));
          created.h = Math.max(created.h, 8); board.zones.push(created); break;
        }
        case 'zone-update': {
          needZone(); const patch = zonePatch(data, state, boardProject);
          // Renaming a zone renames the topic it was created for, while both still share a name.
          if (patch.name && zone.source.kind === 'topic') { const topic = boardProject.topics.find(t => t.id === zone.source.topicId); if (topic && topic.name === zone.name) topic.name = patch.name; }
          Object.assign(zone, patch); break;
        }
        case 'zone-layout': {
          needBoard(); if (!Array.isArray(data.zones) || data.zones.length > 200) throw fail('Некорректная раскладка доски.');
          for (const item of data.zones) { const target = board.zones.find(z => z.id === item?.id); if (!target) throw fail('Зона не найдена.', 404); Object.assign(target, zonePatch({ x: item.x, y: item.y, w: item.w, h: item.h })); }
          if (Array.isArray(data.order)) board.zones.sort((a, b) => { const ai = data.order.indexOf(a.id), bi = data.order.indexOf(b.id); return (ai < 0 ? 1e6 : ai) - (bi < 0 ? 1e6 : bi); });
          break;
        }
        case 'zone-delete': needZone(); board.zones = board.zones.filter(z => z !== zone); break;
        case 'zone-refs': {
          needZone(); if (zone.source.kind !== 'refs') throw fail('В эту зону вещи попадают из её источника.');
          const add = data.add || [], remove = data.remove || [];
          if (![add, remove].every(list => Array.isArray(list) && list.length <= 500 && list.every(ref => typeof ref === 'string'))) throw fail('Некорректный список вещей.');
          if (add.some(ref => !refExists(state, board.projectId, ref))) throw fail('Вещь не найдена в проекте.');
          zone.source.refs = [...new Set([...add, ...zone.source.refs])].filter(ref => !remove.includes(ref));
          if (zone.source.refs.length > 500) throw fail('В зоне может быть до 500 вещей.'); break;
        }
        case 'apply-proposal': { if(!ref(data.id))throw fail('Неверный ID.');const proposal = validateProposal(JSON.parse(await readFile(path.join(this.folder,'proposals',data.id+'.json'),'utf8')),state);/* A proposal adds a page and changes nothing else, so a newer store is not a conflict; its sources were re-checked above. */if(proposal.baseRevision>state.revision)throw fail('Предложение создано для версии, которой ещё нет.',409);state.pages.push({...proposal,id:id('page'),revision:0,updated:now()});state.appliedProposals=[...(state.appliedProposals||[]),data.id];break; }
        case 'undo': { const histories=(await readdir(path.join(this.folder,'history'))).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>Number(b.slice(0,-5))-Number(a.slice(0,-5))); if(!histories.length)throw fail('Нет действия для отмены.');const old=JSON.parse(await readFile(path.join(this.folder,'history',histories[0]),'utf8'));old.revision=state.revision+1;await saveJson(this.file,old);await unlink(path.join(this.folder,'history',histories[0]));this.changed();return old; }
        default: throw fail('Неизвестное действие.');
      }
      ensureBoards(state); pruneBoards(state);
      await saveJson(path.join(this.folder,'history',state.revision+'.json'),before);
      state.revision++;
      await saveJson(this.file,state);
      const history=(await readdir(path.join(this.folder,'history'))).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>Number(a.slice(0,-5))-Number(b.slice(0,-5)));
      for (const old of history.slice(0,-40)) await unlink(path.join(this.folder,'history',old)).catch(()=>{});
      this.changed();return state;
    });
    this.queue=next;return next;
  }
  async validateFiles(values) {
    if(!Array.isArray(values)||values.length>100)throw fail('Добавьте не больше 100 файлов за раз.');
    const files=[];for(const f of values){if(!f||typeof f.path!=='string'||!/^workspace\/devspace\/assets\/[a-zA-Z0-9._-]+$/.test(f.path))throw fail('Недопустимый путь вложения.');const verified=await realFile(this.repo,f.path);files.push({path:f.path,name:text(f.name,400),size:verified.info.size,image:!!f.image});}return files;
  }
}
