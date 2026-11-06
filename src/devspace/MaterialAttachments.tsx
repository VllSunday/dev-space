import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react'
import {api,contentUrl,uploadSpaceFile} from '../desktop/client'
import {Icon} from '../desktop/Icons'
import {ZoomImage} from '../components/ImagePreview'
import type {Material,SpaceFile} from './model'

export default function MaterialAttachments({material,editing=true,mutate,artifact,children}:{material:Material;editing?:boolean;mutate:(data:Record<string,unknown>)=>Promise<unknown>;artifact?:(file:SpaceFile)=>void;children:ReactNode}){
 const area=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),mounted=useRef(true),queue=useRef<Promise<unknown>>(Promise.resolve()),pendingRef=useRef<SpaceFile[]>([]),clock=useRef(0)
 const [pending,setPending]=useState<SpaceFile[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[dragging,setDragging]=useState(false)
 const key='material:'+material.id+':attachments'
 const updatePending=useCallback((files:SpaceFile[])=>{pendingRef.current=files;if(mounted.current)setPending(files)},[])
 const savePending=useCallback(async()=>{clock.current=Math.max(Date.now(),clock.current+1);await api('/devspace/drafts',{key,text:'',files:pendingRef.current,version:clock.current,cleared:!pendingRef.current.length},'PUT')},[key])
 const flush=async()=>{
  const files=[...pendingRef.current];if(!files.length)return
  await mutate({action:'material-files',id:material.id,add:files})
  const saved=new Set(files.map(f=>f.path));updatePending(pendingRef.current.filter(f=>!saved.has(f.path)));await savePending()
 }
 const run=(work:()=>Promise<void>)=>{
  queue.current=queue.current.catch(()=>{}).then(async()=>{
   if(mounted.current){setBusy(true);setError('');setStatus('Сохраняем вложения…')}
   try{await work();if(mounted.current)setStatus('Вложения сохранены')}
   catch(error){if(mounted.current){setError((error as Error).message);setStatus('')}}
   finally{if(mounted.current){setBusy(false);setDragging(false)}}
  })
 }
 const attach=(items:File[]|string[])=>{
  if(!items.length)return
  if(items.length>20){setError('Добавляйте не больше 20 файлов за один раз.');return}
  run(async()=>{
   for(const item of items){
    const file=typeof item==='string'?await api<SpaceFile>('/devspace/files/import',{path:item}):await uploadSpaceFile(item)
    updatePending([...pendingRef.current.filter(f=>f.path!==file.path),file]);await savePending()
   }
   await flush()
  })
 }
 const attachRef=useRef(attach);useEffect(()=>{attachRef.current=attach})
 useEffect(()=>{
  mounted.current=true;let alive=true
  void api<{files:SpaceFile[];version:number}>('/devspace/drafts?key='+encodeURIComponent(key)).then(d=>{
   if(!alive)return;clock.current=Math.max(clock.current,d.version||0)
   const attached=new Set(material.files.map(f=>f.path)),all=new Map([...d.files||[],...pendingRef.current].filter(f=>!attached.has(f.path)).map(f=>[f.path,f]));updatePending([...all.values()])
  }).catch(error=>{if(alive)setError((error as Error).message)})
  return()=>{alive=false;mounted.current=false}
 },[key,updatePending])
 useEffect(()=>{
  const drop=(event:Event)=>{
   const detail=(event as CustomEvent<{phase:string;x?:number;y?:number;paths?:string[]}>).detail
   if(!detail)return
   if(detail.phase==='leave'){setDragging(false);return}
   if(!Number.isFinite(detail.x)||!Number.isFinite(detail.y))return
   const inside=!!area.current?.contains(document.elementFromPoint(detail.x!,detail.y!));setDragging(inside&&detail.phase!=='drop')
   if(inside&&detail.phase==='drop'&&detail.paths?.length)attachRef.current(detail.paths)
  }
  window.addEventListener('mrmak-file-drop',drop);return()=>window.removeEventListener('mrmak-file-drop',drop)
 },[])
 const remove=(file:SpaceFile)=>run(async()=>{await mutate({action:'material-files',id:material.id,remove:[file.path]})})
 return <div ref={area} tabIndex={-1} className={'ds-material-attachments '+(dragging?'is-dragging':'')} onPasteCapture={event=>{
  const files=[...event.clipboardData.files];if(!files.length)return;event.preventDefault();event.stopPropagation();attach(files)
 }} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setDragging(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();event.stopPropagation();setDragging(false);attach([...event.dataTransfer.files])}}>
  {children}
  <div className="ds-record-files">{material.files.map(file=><figure key={file.path}>
   {file.image&&<ZoomImage src={contentUrl('/'+file.path)} alt={file.name}/>}
   <figcaption><a href={contentUrl('/'+file.path)+'?download=1'} download={file.name}>{file.name} · {Math.max(1,Math.round(file.size/1024))} КБ <Icon name="external" size={12}/></a>{/\.html?$/i.test(file.name)&&artifact&&<button type="button" onClick={()=>artifact(file)}>Открыть HTML-артефакт</button>}{editing&&<button type="button" className="ds-attachment-remove" disabled={busy} aria-label={'Убрать вложение: '+file.name} title="Убрать из материала" onClick={()=>remove(file)}><Icon name="close" size={14}/></button>}</figcaption>
  </figure>)}</div>
  {!!pending.length&&<div className="ds-attachment-pending"><span>Ещё не прикреплено</span>{pending.map(file=><div key={file.path}>{file.image&&<img src={contentUrl('/'+file.path)} alt=""/>}<span>{file.name}</span><button type="button" disabled={busy} aria-label={'Убрать несохранённое вложение: '+file.name} onClick={()=>run(async()=>{updatePending(pendingRef.current.filter(f=>f.path!==file.path));await savePending()})}><Icon name="close" size={13}/></button></div>)}<button type="button" className="ds-secondary" disabled={busy} onClick={()=>run(flush)}>Повторить сохранение</button></div>}
  <div className="ds-attachment-toolbar"><button type="button" className="ds-secondary" disabled={busy} onClick={()=>{input.current!.accept='image/*';input.current?.click()}}><Icon name="image" size={15}/>Добавить изображение</button><button type="button" disabled={busy} onClick={()=>{input.current!.accept='';input.current?.click()}}><Icon name="attach" size={15}/>Файл</button><small>Можно вставить Ctrl+V или перетащить сюда</small></div>
  <input ref={input} type="file" multiple hidden onChange={event=>{attach([...event.currentTarget.files||[]]);event.currentTarget.value=''}}/>
  {error&&<p className="ds-attachment-error" role="alert">{error}{!!pending.length&&' Загруженные файлы сохранены в черновике.'}</p>}{!error&&status&&<p className="ds-attachment-status" role="status">{status}</p>}
  {dragging&&<div className="ds-attachment-drop" aria-hidden="true"><Icon name="image" size={24}/><span>Добавить файлы к этому материалу</span></div>}
 </div>
}
