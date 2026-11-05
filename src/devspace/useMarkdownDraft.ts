import { useEffect, useRef, useState } from 'react'
import { api } from '../desktop/client'
import { toMarkdown, type Page } from './model'

export function useMarkdownDraft(page:Page,commit:(text:string,revision:number)=>Promise<unknown>,recovered:()=>void) {
 const key='page:'+page.id+':markdown',storageKey='devspace.'+key
 const [value,setValue]=useState(()=>toMarkdown(page)),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false)
 const valueRef=useRef(value),dirtyRef=useRef(dirty),base=useRef(toMarkdown(page)),clock=useRef(0),pageRef=useRef(page),commitRef=useRef(commit),recoveredRef=useRef(recovered)
 valueRef.current=value;dirtyRef.current=dirty;pageRef.current=page;commitRef.current=commit;recoveredRef.current=recovered
 const persist=async(cleared=false,keepalive=false)=>{
  const version=Math.max(Date.now(),clock.current+1);clock.current=version
  const draft={key,text:cleared?'':valueRef.current,files:[],baseline:base.current,version,cleared}
  try{localStorage.setItem(storageKey,JSON.stringify(draft))}catch{ /* The file-backed copy is authoritative. */ }
  await api('/devspace/drafts',draft,'PUT',{keepalive})
 }
 const persistRef=useRef(persist);persistRef.current=persist
 const touched=useRef(false),restoredVersion=useRef(0)
 const mounted=useRef(true),saving=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{if(!dirtyRef.current){base.current=toMarkdown(page);valueRef.current=base.current;setValue(base.current)}},[page])
 useEffect(()=>{
  let active=true
  const restore=(draft:{text:string;baseline?:string;version:number;cleared?:boolean})=>{
   if(!active||touched.current||!draft.version||draft.version<restoredVersion.current)return
   restoredVersion.current=draft.version
   if(draft.cleared||draft.text===toMarkdown(pageRef.current)){base.current=toMarkdown(pageRef.current);valueRef.current=base.current;dirtyRef.current=false;setValue(base.current);setDirty(false);setConflict(false);setError('');return}
   clock.current=Math.max(clock.current,draft.version||0);base.current=draft.baseline??toMarkdown(pageRef.current);valueRef.current=draft.text;dirtyRef.current=true;setValue(draft.text);setDirty(true);recoveredRef.current()
   if(base.current!==toMarkdown(pageRef.current)){setConflict(true);setError('Сохранённая страница изменилась. Черновик восстановлен; сравните версии перед сохранением.')}
  }
  try{const local=JSON.parse(localStorage.getItem(storageKey)||'null');if(local)restore(local)}catch{ /* Ignore a damaged browser cache. */ }
  void api<{text:string;baseline:string;version:number;cleared?:boolean}>('/devspace/drafts?key='+encodeURIComponent(key)).then(draft=>{clock.current=Math.max(clock.current,draft.version||0);restore(draft)}).catch(()=>{})
  const hide=()=>{if(dirtyRef.current)void persistRef.current(false,true).catch(()=>{})};window.addEventListener('pagehide',hide)
  return()=>{active=false;window.removeEventListener('pagehide',hide);if(dirtyRef.current)void persistRef.current().catch(()=>{})}
 },[key])
 useEffect(()=>{if(!dirty)return;const timer=setTimeout(()=>void persistRef.current().catch(error=>setError('Черновик не сохранён: '+error.message)),250);return()=>clearTimeout(timer)},[value,dirty])
 const change=(text:string)=>{touched.current=true;valueRef.current=text;dirtyRef.current=true;setValue(text);setDirty(true);try{localStorage.setItem(storageKey,JSON.stringify({text,baseline:base.current,version:Math.max(Date.now(),clock.current+1)}))}catch{ /* The debounced file copy remains enabled. */ }}
 const save=async(reviewed=false)=>{
  if(!mounted.current||saving.current||!dirtyRef.current)return
  const latest=pageRef.current,text=valueRef.current,current=toMarkdown(latest)
  if(!reviewed&&base.current!==current&&text!==current){setConflict(true);setError('Страница изменилась. Черновик сохранён; сравните версии перед сохранением.');await persistRef.current().catch(()=>{});return}
  saving.current=true
  try{
   if(text!==current)await commitRef.current(text,latest.revision)
   if(mounted.current&&valueRef.current===text){base.current=text;dirtyRef.current=false;setDirty(false);setConflict(false);setError('');await persistRef.current(true)}
  }catch(error){if(mounted.current){setError((error as Error).message);await persistRef.current().catch(()=>{})}}
  finally{saving.current=false}
 }
 return {value,change,save,error,conflict,dirty}
}
