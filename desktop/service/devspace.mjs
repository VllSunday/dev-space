import path from 'node:path';
import { mkdir, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { saveJson, realFile } from './util.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = prefix => `${prefix}-${randomUUID().slice(0, 12)}`;
const now = () => new Date().toISOString();
const text = (value, max = 200000) => { if (typeof value !== 'string' || value.length > max) throw fail('Некорректный текст или превышен размер.'); return value; };
const name = value => { const v = text(value, 160).trim(); if (!v) throw fail('Введите название.'); return v; };
const types = new Set(['text', 'heading', 'bullet', 'check', 'quote', 'code', 'image']);
const ref = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
function blocks(value) {
  if (!Array.isArray(value) || value.length > 3000) throw fail('Некорректные блоки страницы.');
  const ids = new Set();
  return value.map(b => {
    if (!b || !ref(b.id) || ids.has(b.id) || !types.has(b.type)) throw fail('Некорректный тип или ID блока.');
    ids.add(b.id);
    if (b.type === 'image' && (typeof b.asset !== 'string' || !/^workspace\/devspace\/assets\/[a-zA-Z0-9._-]+$/.test(b.asset))) throw fail('Некорректное вложение.');
    return { id: b.id, type: b.type, text: text(b.text || ''), ...(b.type === 'image' ? { asset: b.asset } : {}), ...(b.type === 'check' ? { checked: !!b.checked } : {}) };
  });
}
export function validateProposal(value, state) {
  if (!value || value.schemaVersion !== 1 || !state.projects.some(p => p.id === value.projectId)) throw fail('Предложение относится к неизвестному проекту.');
  if (!Number.isSafeInteger(value.baseRevision) || !Array.isArray(value.sourceIds) || value.sourceIds.length > 2000) throw fail('Укажите версию и источники предложения.');
  const sources = value.sourceIds.map(source => { if (!state.materials.some(m => m.id === source && m.projectId === value.projectId)) throw fail('Источник предложения не найден в проекте.'); return source; });
  return { schemaVersion: 1, projectId: value.projectId, topicId: value.topicId || 'unfiled', baseRevision: value.baseRevision, title: name(value.title), blocks: blocks(value.blocks), sourceIds: sources, layout: value.layout === 'wiki' ? 'wiki' : 'document' };
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
      await saveJson(this.file, { schemaVersion: 1, revision: 0, projects, materials, pages: [], tasks: [] });
    }
    return this;
  }
  async read() {
    const state = JSON.parse(await readFile(this.file, 'utf8'));
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !['projects','materials','pages','tasks'].every(k => Array.isArray(state[k]))) throw fail('Хранилище повреждено. Восстановите копию из history.', 500);
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
    return { path: relative, name: rawName, size, image: ['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(suffix) };
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
  mutate(data) {
    const next = this.queue.catch(() => {}).then(async () => {
      const state = await this.read();
      if (data.baseRevision !== state.revision) throw fail('Содержимое изменилось. Обновите данные и повторите действие; ваш черновик сохранён.', 409);
      const before = structuredClone(state), project = state.projects.find(p => p.id === data.projectId);
      const topicExists = (p, t) => t === 'unfiled' || p?.topics.some(x => x.id === t);
      const material = state.materials.find(m => m.id === data.id), page = state.pages.find(p => p.id === data.id);
      switch (data.action) {
        case 'create-project': {
          let folder = data.path?.trim() || this.repo; folder = path.resolve(folder);
          if (!(await stat(folder).catch(() => null))?.isDirectory()) throw fail('Выберите существующую папку проекта.');
          state.projects.push({ id: id('project'), name: name(data.name), path: folder, topics: [] }); break;
        }
        case 'rename-project': if (!project) throw fail('Проект не найден.'); project.name = name(data.name); break;
        case 'project-home': if (!project || data.pageId && !state.pages.some(p=>p.id===data.pageId&&p.projectId===project.id)) throw fail('Главная страница проекта не найдена.'); project.homePageId = data.pageId || null; break;
        case 'project-path': if (!project || !(await stat(data.path).catch(() => null))?.isDirectory()) throw fail('Папка проекта не найдена.'); project.path = path.resolve(data.path); break;
        case 'create-topic': if (!project) throw fail('Проект не найден.'); project.topics.push({ id: id('topic'), name: name(data.name) }); break;
        case 'rename-topic': { const t = project?.topics.find(t => t.id === data.id); if (!t) throw fail('Тема не найдена.'); t.name = name(data.name); break; }
        case 'move-topic': { const i = project?.topics.findIndex(t => t.id === data.id), j = i + (data.direction === 'up' ? -1 : 1); if (i === undefined || i < 0 || j < 0 || j >= project.topics.length) break; [project.topics[i],project.topics[j]] = [project.topics[j],project.topics[i]]; break; }
        case 'delete-topic': if (!project) throw fail('Проект не найден.'); project.topics = project.topics.filter(t => t.id !== data.id); for (const list of [state.materials,state.pages,state.tasks]) for (const item of list) if (item.projectId === project.id && item.topicId === data.id) item.topicId = 'unfiled'; for(const p of state.pages)if(p.projectId===project.id&&p.collections)p.collections=p.collections.filter(c=>c.topicId!==data.id); break;
        case 'create-material': {
          if (!project || !topicExists(project, data.topicId)) throw fail('Тема не найдена.');
          const files = await this.validateFiles(data.files || []), content = text(data.text || '');
          if (data.modelPageId && !state.pages.some(p=>p.id===data.modelPageId&&p.projectId===project.id)) throw fail('Страница для 3D-модели не найдена.');
          if (!content.trim() && !files.length) throw fail('Добавьте текст или файл.');
          state.materials.unshift({ id: id('material'), projectId: project.id, topicId: data.topicId, title: (data.title || content.split('\n')[0] || files[0]?.name || 'Без названия').slice(0,160), text: content, kind: files.some(f => f.image) ? 'image' : files.length ? 'file' : /^https?:\/\/\S+$/.test(content) ? 'link' : 'note', files, ...(data.modelPageId ? {modelPageId: data.modelPageId} : {}), archived: false, created: now(), updated: now() }); break;
        }
        case 'update-material': if (!material) throw fail('Материал не найден.'); if (data.title !== undefined) material.title = name(data.title); if (data.text !== undefined) material.text = text(data.text); if (data.topicId !== undefined) { if (!topicExists(state.projects.find(p=>p.id===material.projectId),data.topicId)) throw fail('Тема не найдена.'); material.topicId = data.topicId; } if (data.archived !== undefined) material.archived = !!data.archived; material.updated = now(); break;
        case 'create-page': if (!project) throw fail('Проект не найден.'); state.pages.push({ id: id('page'), projectId: project.id, topicId: data.topicId || 'unfiled', title: name(data.title || 'Новая страница'), blocks: blocks(data.blocks || [{id:id('block'),type:'text',text:''}]), layout: data.layout === 'wiki' ? 'wiki' : 'document', ...(data.layout==='wiki'?{collections:[]}:{}), sourceIds: [], revision: 0, updated: now() }); break;
        case 'update-page': if (!page) throw fail('Страница не найдена.'); if (data.title !== undefined) page.title = name(data.title); if (data.blocks !== undefined) { if(data.expectedPageRevision!==page.revision)throw fail('Страница изменилась во время редактирования Markdown. Ваш текст сохранён в редакторе; сравните версии.',409);page.blocks = blocks(data.blocks); } if (data.layout !== undefined) page.layout = data.layout === 'wiki' ? 'wiki' : 'document'; page.updated = now(); page.revision++; break;
        case 'collection': {
          if(!page)throw fail('Страница не найдена.');const owner=state.projects.find(p=>p.id===page.projectId);
          if(data.pinId!==undefined&&(data.enabled!==undefined||typeof data.pinned!=='boolean')||data.pinId===undefined&&typeof data.enabled!=='boolean')throw fail('Укажите действие с коллекцией.');
          if(!['list','gallery'].includes(data.view)||!(data.topicId==='all'||topicExists(owner,data.topicId)))throw fail('Коллекция не найдена в проекте.');
          const list=page.collections?structuredClone(page.collections):(page.layout==='wiki'?owner.topics.map(t=>({topicId:t.id,view:'list',pinnedIds:[]})):[]);
          let i=list.findIndex(c=>c.topicId===data.topicId&&c.view===data.view);
          if(data.enabled===false){if(i>=0)list.splice(i,1)}
          else if(data.enabled===true&&i<0){if(list.length>=200)throw fail('На странице можно закрепить не больше 200 коллекций.');list.push({topicId:data.topicId,view:data.view,pinnedIds:[]});i=list.length-1}
          if(data.pinId!==undefined){const source=state.materials.find(m=>m.id===data.pinId&&m.projectId===page.projectId&&!m.archived&&(data.topicId==='all'||m.topicId===data.topicId)&&(data.view!=='gallery'||m.files.some(f=>f.image)));if(!source||i<0)throw fail('Материал не найден в коллекции.');const pins=(list[i].pinnedIds||[]).filter(id=>state.materials.some(m=>m.id===id&&m.projectId===page.projectId&&!m.archived&&(data.topicId==='all'||m.topicId===data.topicId)&&(data.view!=='gallery'||m.files.some(f=>f.image))));if(data.pinned===true&&!pins.includes(data.pinId)){if(pins.length>=8)throw fail('Можно закрепить до 8 записей в превью.');pins.push(data.pinId)}list[i].pinnedIds=data.pinned===false?pins.filter(id=>id!==data.pinId):pins}
          page.collections=list;page.revision++;page.updated=now();break;
        }
        case 'patch-block': { if(!page)throw fail('Страница не найдена.');const index=page.blocks.findIndex(b=>b.id===data.blockId);if(index<0)throw fail('Блок больше не существует.',409);const patch={};for(const field of ['text','type','checked'])if(data.patch?.[field]!==undefined)patch[field]=data.patch[field];page.blocks[index]=blocks([{...page.blocks[index],...patch}])[0];page.revision++;page.updated=now();break; }
        case 'block': { if (!page) throw fail('Страница не найдена.'); const block = blocks([data.block])[0], index = page.blocks.findIndex(b => b.id === block.id); if (index >= 0) page.blocks[index] = block; else page.blocks.splice(Number.isInteger(data.index) ? Math.max(0, Math.min(page.blocks.length, data.index)) : page.blocks.length,0,block); page.revision++; page.updated=now(); break; }
        case 'delete-block': if (!page) throw fail('Страница не найдена.'); page.blocks = page.blocks.filter(b => b.id !== data.blockId); page.revision++; break;
        case 'move-block': { if (!page) throw fail('Страница не найдена.'); const i=page.blocks.findIndex(b=>b.id===data.blockId),j=i+(data.direction==='up'?-1:1); if (i>=0&&j>=0&&j<page.blocks.length) [page.blocks[i],page.blocks[j]]=[page.blocks[j],page.blocks[i]]; page.revision++; break; }
        case 'create-task': if (!project) throw fail('Проект не найден.'); state.tasks.push({id:id('task'),projectId:project.id,topicId:data.topicId||'unfiled',title:name(data.title),status:'todo',sourceId:data.sourceId||null}); break;
        case 'task': { const task=state.tasks.find(t=>t.id===data.id); if(!task||!['todo','working','review','done'].includes(data.status)) throw fail('Задача или статус не найдены.'); task.status=data.status; break; }
        case 'apply-proposal': { if(!ref(data.id))throw fail('Неверный ID.');const proposal = validateProposal(JSON.parse(await readFile(path.join(this.folder,'proposals',data.id+'.json'),'utf8')),state);if(proposal.baseRevision!==state.revision)throw fail('Предложение создано для прошлой версии. Попросите агента обновить его.',409);state.pages.push({...proposal,id:id('page'),revision:0,updated:now()});state.appliedProposals=[...(state.appliedProposals||[]),data.id];break; }
        case 'undo': { const histories=(await readdir(path.join(this.folder,'history'))).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>Number(b.slice(0,-5))-Number(a.slice(0,-5))); if(!histories.length)throw fail('Нет действия для отмены.');const old=JSON.parse(await readFile(path.join(this.folder,'history',histories[0]),'utf8'));old.revision=state.revision+1;await saveJson(this.file,old);await unlink(path.join(this.folder,'history',histories[0]));this.changed();return old; }
        default: throw fail('Неизвестное действие.');
      }
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
