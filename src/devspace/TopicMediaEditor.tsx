import {useEffect,useRef,useState,type ReactNode} from 'react'
import {api,uploadSpaceFile} from '../desktop/client'
import {Icon} from '../desktop/Icons'
import type {SpaceFile,Topic} from './model'

export default function TopicMediaEditor({topic,projectId,mutate,children}:{topic:Topic;projectId:string;mutate:(data:Record<string,unknown>)=>Promise<unknown>;children:ReactNode}){
 const area=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),queue=useRef<Promise<unknown>>(Promise.resolve()),pending=useRef<SpaceFile[]>([]),clock=useRef(0),mounted=useRef(true)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pendingFiles,setPendingFiles]=useState<SpaceFile[]>([]),[dragging,setDragging]=useState(false)
 const key='topic:'+topic.id+':media',count=pendingFiles.length
 const persist=async()=>{clock.current=Math.max(Date.now(),clock.current+1);await api('/devspace/drafts',{key,text:'',files:pending.current,version:clock.current,cleared:!pending.current.length},'PUT')}
 const flush=async()=>{const files=[...pending.current];if(!files.length)return;await mutate({action:'topic-media',projectId,topicId:topic.id,files});const saved=new Set(files.map(f=>f.path));pending.current=pending.current.filter(f=>!saved.has(f.path));if(mounted.current)setPendingFiles([...pending.current]);await persist()}
 const run=(work:()=>Promise<void>)=>{queue.current=queue.current.catch(()=>{}).then(async()=>{if(mounted.current){setBusy(true);setError('')}try{await work()}catch(error){if(mounted.current)setError((error as Error).message)}finally{if(mounted.current){setBusy(false);setDragging(false)}}})}
 const attach=(files:File[]|string[])=>{
  if(!files.length)return;if(files.length>20){setError('Добавляйте не больше 20 файлов за один раз.');return}
  run(async()=>{for(const source of files){if(typeof source!=='string'&&!/\.(png|jpe?g|webp|gif|bmp|svg|avif|glb)$/i.test(source.name))throw Error('Выберите изображение или GLB 2.0.');const file=typeof source==='string'?await api<SpaceFile>('/devspace/files/import',{path:source}):await uploadSpaceFile(source);pending.current=[...pending.current,file];if(mounted.current)setPendingFiles([...pending.current]);await persist()}await flush()})
 }
 const attachRef=useRef(attach);useEffect(()=>{attachRef.current=attach})
 useEffect(()=>{
  mounted.current=true;let alive=true
  void api<{files:SpaceFile[];version:number}>('/devspace/drafts?key='+encodeURIComponent(key)).then(d=>{if(!alive)return;clock.current=Math.max(clock.current,d.version||0);const existing=new Set((topic.blocks||[]).map(b=>b.asset));pending.current=[...new Map([...d.files||[],...pending.current].filter(f=>!existing.has(f.path)).map(f=>[f.path,f])).values()];setPendingFiles([...pending.current])}).catch(error=>{if(alive)setError((error as Error).message)})
  return()=>{alive=false;mounted.current=false}
 },[key])
 useEffect(()=>{
  const drop=(event:Event)=>{const d=(event as CustomEvent<{phase:string;x?:number;y?:number;paths?:string[]}>).detail;if(!d)return;if(d.phase==='leave'){setDragging(false);return}if(!Number.isFinite(d.x)||!Number.isFinite(d.y))return;const inside=!!area.current?.contains(document.elementFromPoint(d.x!,d.y!));setDragging(inside&&d.phase!=='drop');if(inside&&d.phase==='drop'&&d.paths?.length)attachRef.current(d.paths)}
  window.addEventListener('mrmak-file-drop',drop);return()=>window.removeEventListener('mrmak-file-drop',drop)
 },[])
 const choose=(accept:string)=>{input.current!.accept=accept;input.current?.click()}
 return <div ref={area} className={'ds-topic-editor-surface ds-topic-media '+(dragging?'is-dragging':'')} onPasteCapture={event=>{const files=[...event.clipboardData.files];if(files.length){event.preventDefault();event.stopPropagation();attach(files)}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();event.stopPropagation();setDragging(false);attach([...event.dataTransfer.files])}}}>
  {children}
  <input hidden ref={input} type="file" multiple aria-label="Медиа описания темы" onChange={event=>{attach([...event.currentTarget.files||[]]);event.currentTarget.value=''}}/>
  <div className="ds-editor-footer"><button type="button" disabled={busy} onClick={()=>choose('image/*')}><Icon name="image" size={14}/>Изображение</button><button type="button" disabled={busy} onClick={()=>choose('.glb')}><Icon name="cube" size={14}/>3D-модель</button><span className="ds-muted">Или вставьте картинку / перетащите изображение или GLB</span></div>
  {busy&&<p role="status" className="ds-editor-hint">Загружаем и сохраняем медиа…</p>}{!!count&&!busy&&<><div className="ds-inline-error"><span>Не добавлено файлов: {count}. Загрузка сохранена в черновике.</span><button type="button" onClick={()=>run(flush)}>Повторить</button></div><ul className="ds-topic-pending">{pendingFiles.map(file=><li key={file.path}><span>{file.name}</span><button type="button" aria-label={'Убрать из черновика: '+file.name} onClick={()=>run(async()=>{pending.current=pending.current.filter(f=>f.path!==file.path);setPendingFiles([...pending.current]);await persist()})}><Icon name="close" size={13}/></button></li>)}</ul></>}{error&&<p role="alert" className="ds-inline-error">{error}</p>}
 </div>
}
