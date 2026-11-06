import type { ChatSession } from '../desktop/types'
export interface SpaceFile { path: string; name: string; size: number; image: boolean }
export interface Topic { id: string; name: string; icon?: string; blocks?: Block[] }
export interface Project { id: string; name: string; path: string; topics: Topic[]; homePageId?: string | null; navigationColors?: Record<string,string> }
export interface Material { id: string; projectId: string; topicId: string; title: string; text: string; kind: 'note'|'image'|'file'|'link'|'legacy'; files: SpaceFile[]; archived: boolean; created: string; updated: string; legacyId?: string; modelPageId?: string }
export type BlockType = 'text'|'heading'|'bullet'|'check'|'quote'|'code'|'image'|'divider'|'model'
export interface Block { id: string; type: BlockType; text: string; checked?: boolean; asset?: string }
export interface PageCollection { topicId: string; view: 'list'|'tiles'|'gallery'; pinnedIds?: string[] }
export type PageNode = {id:string;type:'title'} | {id:string;type:'block';blockId:string} | ({id:string;type:'collection'} & PageCollection)
export interface Page { id: string; projectId: string; topicId: string; title: string; icon?: string; blocks: Block[]; sourceIds: string[]; revision: number; layout: 'document'|'wiki'; updated: string; collections?: PageCollection[]; flow?: PageNode[] }
export interface Task { id: string; projectId: string; topicId: string; title: string; status: 'todo'|'working'|'review'|'done'; sourceId?: string }
export interface SpaceState { schemaVersion: 1; revision: number; projects: Project[]; materials: Material[]; pages: Page[]; tasks: Task[] }
export interface Proposal { id: string; projectId: string; title: string; blocks: Block[]; sourceIds: string[]; layout: 'document'|'wiki'; baseRevision: number; stale: boolean; error?: string }
export const newId = () => 'block-'+crypto.randomUUID().slice(0,12)
export const blockNames: Record<BlockType,string> = {text:'Текст',heading:'Заголовок',bullet:'Список',check:'Чек-лист',quote:'Заметка',code:'Код',image:'Изображение',divider:'Разделитель',model:'3D-модель'}
export function sessionStatus(session: ChatSession) {
  if (session.status==='starting') return {kind:'working',label:'Запускается'}
  if (session.activity==='waiting') return {kind:'waiting',label:'Нужен ответ'}
  if (session.unread) return {kind:'done',label:'Завершил · результат не прочитан'}
  if (session.status!=='running') return {kind:session.exitCode?'error':'inactive',label:session.exitCode?'Завершился с ошибкой':'Не активен'}
  if (session.attention) return {kind:'waiting',label:'Нужен ответ'}
  if (session.activity==='working') return {kind:'working',label:'Работает'}
  return {kind:'inactive',label:'Готов к задаче'}
}
export const normalizePath=(value:string)=>value.replace(/\\/g,'/').replace(/\/$/,'').toLocaleLowerCase()
export function pageCollections(page:Page,project:Project):PageCollection[] {
 const values=page.flow?page.flow.filter((node):node is Extract<PageNode,{type:'collection'}>=>node.type==='collection'):page.collections??(page.layout==='wiki'?project.topics.map(t=>({topicId:t.id,view:'list' as const})):[])
 return values.filter(c=>['list','tiles','gallery'].includes(c.view)&&(['all','unfiled'].includes(c.topicId)||project.topics.some(t=>t.id===c.topicId)))
}
export function collectionMaterials(materials:Material[],projectId:string,collection:PageCollection,limit=Infinity) {
 const pinned=collection.pinnedIds||[]
 return materials.filter(m=>m.projectId===projectId&&!m.archived&&(collection.topicId==='all'||m.topicId===collection.topicId)&&(collection.view!=='gallery'||m.files.some(f=>f.image))).sort((a,b)=>{
  const ai=pinned.indexOf(a.id),bi=pinned.indexOf(b.id)
  if(ai>=0||bi>=0)return ai<0?1:bi<0?-1:ai-bi
  return b.created.localeCompare(a.created)||a.id.localeCompare(b.id)
 }).slice(0,limit)
}
export function remainingDraft(saved:{text:string;files:SpaceFile[]},current:{text:string;files:SpaceFile[]}) {
 const paths=new Set(saved.files.map(f=>f.path))
 return {text:current.text===saved.text?'':current.text.startsWith(saved.text)?current.text.slice(saved.text.length):current.text,files:current.files.filter(f=>!paths.has(f.path))}
}
export function safeLink(text:string){try{const u=new URL(text);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
export function toMarkdown(page: Pick<Page,'blocks'> & Partial<Pick<Page,'flow'>>) {
  const ordered=page.flow?page.flow.flatMap(n=>n.type==='block'?page.blocks.filter(b=>b.id===n.blockId):[]):page.blocks
  return ordered.map(b=>b.type==='heading'?'## '+b.text:b.type==='bullet'?'- '+b.text:b.type==='check'?`- [${b.checked?'x':' '}] ${b.text}`:b.type==='quote'?'> '+b.text:b.type==='code'?'```\n'+b.text+'\n```':b.type==='image'?`![${b.text}](${b.asset})`:b.type==='model'?`[3D: ${b.text}](${b.asset})`:b.type==='divider'?'---':b.text).join('\n\n')
}
export function fromMarkdown(value: string, old: Block[] = []): Block[] {
  const blocks: Block[]=[],used=new Set<string>();let code: string[]|null=null
  const add=(type:BlockType,text:string,extra:Partial<Block>={})=>{const match=old.find(b=>!used.has(b.id)&&b.type===type&&b.text===text);const id=match?.id||newId();used.add(id);blocks.push({id,type,text,...extra})}
  for(const line of value.replace(/\r/g,'').split('\n')){
    if(/^```/.test(line)){if(code===null)code=[];else{add('code',code.join('\n'));code=null}continue}
    if(code!==null){code.push(line);continue}
    if(!line.trim())continue
    const image=line.match(/^!\[(.*?)\]\((workspace\/devspace\/assets\/[\w.-]+)\)$/)
    if(image){add('image',image[1],{asset:image[2]});continue}
    const model=line.match(/^\[3D: (.*?)\]\((workspace\/devspace\/assets\/[\w.-]+\.glb)\)$/i)
    if(model){add('model',model[1],{asset:model[2]});continue}
    if(line==='---'){add('divider','');continue}
    if(/^#{1,3} /.test(line))add('heading',line.replace(/^#{1,3} /,''))
    else if(/^- \[[ xX]\] /.test(line))add('check',line.slice(6),{checked:line[3].toLowerCase()==='x'})
    else if(/^- /.test(line))add('bullet',line.slice(2))
    else if(/^> /.test(line))add('quote',line.slice(2))
    else add('text',line)
  }
  if(code!==null)add('code',code.join('\n'))
  return blocks.length?blocks:[{id:newId(),type:'text',text:''}]
}
