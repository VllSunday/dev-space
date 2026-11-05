import type { ChatSession } from '../desktop/types'
export interface SpaceFile { path: string; name: string; size: number; image: boolean }
export interface Topic { id: string; name: string }
export interface Project { id: string; name: string; path: string; topics: Topic[]; homePageId?: string | null }
export interface Material { id: string; projectId: string; topicId: string; title: string; text: string; kind: 'note'|'image'|'file'|'link'|'legacy'; files: SpaceFile[]; archived: boolean; created: string; updated: string; legacyId?: string; modelPageId?: string }
export type BlockType = 'text'|'heading'|'bullet'|'check'|'quote'|'code'|'image'
export interface Block { id: string; type: BlockType; text: string; checked?: boolean; asset?: string }
export interface Page { id: string; projectId: string; topicId: string; title: string; blocks: Block[]; sourceIds: string[]; revision: number; layout: 'document'|'wiki'; updated: string }
export interface Task { id: string; projectId: string; topicId: string; title: string; status: 'todo'|'working'|'review'|'done'; sourceId?: string }
export interface SpaceState { schemaVersion: 1; revision: number; projects: Project[]; materials: Material[]; pages: Page[]; tasks: Task[] }
export interface Proposal { id: string; projectId: string; title: string; blocks: Block[]; sourceIds: string[]; layout: 'document'|'wiki'; baseRevision: number; stale: boolean; error?: string }
export const newId = () => 'block-'+crypto.randomUUID().slice(0,12)
export const blockNames: Record<BlockType,string> = {text:'Текст',heading:'Заголовок',bullet:'Список',check:'Чек-лист',quote:'Цитата',code:'Код',image:'Изображение'}
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
export function remainingDraft(saved:{text:string;files:SpaceFile[]},current:{text:string;files:SpaceFile[]}) {
 const paths=new Set(saved.files.map(f=>f.path))
 return {text:current.text===saved.text?'':current.text.startsWith(saved.text)?current.text.slice(saved.text.length):current.text,files:current.files.filter(f=>!paths.has(f.path))}
}
export function safeLink(text:string){try{const u=new URL(text);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
export function toMarkdown(page: Pick<Page,'blocks'>) {
  return page.blocks.map(b=>b.type==='heading'?'## '+b.text:b.type==='bullet'?'- '+b.text:b.type==='check'?`- [${b.checked?'x':' '}] ${b.text}`:b.type==='quote'?'> '+b.text:b.type==='code'?'```\n'+b.text+'\n```':b.type==='image'?`![${b.text}](${b.asset})`:b.text).join('\n\n')
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
    if(/^#{1,3} /.test(line))add('heading',line.replace(/^#{1,3} /,''))
    else if(/^- \[[ xX]\] /.test(line))add('check',line.slice(6),{checked:line[3].toLowerCase()==='x'})
    else if(/^- /.test(line))add('bullet',line.slice(2))
    else if(/^> /.test(line))add('quote',line.slice(2))
    else add('text',line)
  }
  if(code!==null)add('code',code.join('\n'))
  return blocks.length?blocks:[{id:newId(),type:'text',text:''}]
}
