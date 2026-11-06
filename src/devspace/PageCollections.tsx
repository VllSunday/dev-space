import { useEffect, useRef, useState } from 'react'
import { Icon, TopicIcon } from '../desktop/Icons'
import { contentUrl } from '../desktop/client'
import { ModelViewer } from '../lib/three/viewer'
import { collectionMaterials, pageCollections, type Material, type Page, type Project, type PageCollection } from './model'

export type OpenTopic=(topicId:string,gallery?:boolean,materialId?:string,filePath?:string,editing?:boolean)=>void
function ModelThumbnail({asset}:{asset:string}){
 const host=useRef<HTMLDivElement>(null)
 useEffect(()=>{const node=host.current;if(!node)return;let viewer:ModelViewer|undefined;const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting)||viewer)return;try{viewer=new ModelViewer(node);viewer.setAutoRotate(false);void viewer.load(contentUrl('/'+asset)).catch(()=>{node.dataset.failed='true'})}catch{node.dataset.failed='true'}},{rootMargin:'80px'});observer.observe(node);return()=>{observer.disconnect();viewer?.dispose()}},[asset])
 return <div className="ds-model-thumbnail" ref={host} aria-label="Превью 3D-модели"><span>GLB</span></div>
}
export default function PageCollections({page,project,materials,mutate,openTopic,collection,onViewChange,settingsOnly=false}: {page:Page;project:Project;materials:Material[];mutate:(change:Record<string,unknown>)=>Promise<unknown>;openTopic:OpenTopic;collection?:PageCollection;onViewChange?:(view:PageCollection['view'])=>void;settingsOnly?:boolean}) {
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const collections=collection?[collection]:pageCollections(page,project)
 const change=async(data:Record<string,unknown>)=>{setBusy(true);setError('');try{await mutate({action:'collection',id:page.id,...data})}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
 return <section className={'ds-collections '+(collection?'single-collection':'')} aria-label={collection?'Превью темы':'Закреплённые темы'}>
  {!collection&&<><header><h2>Разделы проекта</h2><button aria-expanded={editing} onClick={()=>setEditing(value=>!value)}><Icon name="pin" size={13}/>{editing?'Готово':'Настроить разделы'}</button></header>
  {editing&&<div className="ds-collection-settings"><p>Закрепите тему или галерею. На главной появится до восьми последних записей.</p>{[{id:'all',name:'Все материалы'}, {id:'unfiled',name:'Без темы'}, ...project.topics].map(topic=><div key={topic.id}><strong>{topic.name}</strong>{(['list','gallery'] as const).map(view=><label key={view}><input type="checkbox" disabled={busy} checked={collections.some(c=>c.topicId===topic.id&&(view==='list'?c.view!=='gallery':c.view===view))} onChange={event=>void change({topicId:topic.id,view:view==='list'?collections.find(c=>c.topicId===topic.id&&c.view!=='gallery')?.view||'list':view,enabled:event.target.checked})}/>{view==='list'?'Материалы':'Галерея'}</label>)}</div>)}</div>}</>}
  {error&&<p className="ds-inline-error" role="alert">{error}</p>}
  {!collections.length&&!editing&&!settingsOnly&&<p className="ds-muted">Закрепите темы, чтобы видеть новые материалы на этой странице.</p>}
  {!settingsOnly&&collections.map(item=>{
   const topic=project.topics.find(t=>t.id===item.topicId),label=item.topicId==='all'?(item.view==='gallery'?'Галерея проекта':'Все материалы'):item.topicId==='unfiled'?'Без темы':topic?.name||''
   const all=collectionMaterials(materials,project.id,item),shown=all.slice(0,8),photos=all.flatMap(material=>material.files.filter(f=>f.image).map(file=>({material,file}))).slice(0,8)
   return <section key={item.topicId+':'+item.view} className="ds-collection" data-collection-topic={item.topicId} data-collection-view={item.view}>
    <header><button className="ds-collection-heading" onClick={()=>openTopic(item.topicId,item.view==='gallery')}><TopicIcon value={topic?.icon} size={16}/><h3>{label}</h3><Icon name="arrow" size={12}/><small>{all.length}</small></button>{onViewChange&&<label className="ds-collection-view">Вид<select aria-label={'Вид раздела '+label} value={item.view} onChange={e=>onViewChange(e.target.value as PageCollection['view'])}><option value="list">Список</option><option value="tiles">Плитки</option><option value="gallery">Галерея</option></select></label>}</header>
    <div className="ds-collection-grid" data-view={item.view}>{(item.view==='gallery'?photos.map(({material,file})=>({material,cover:file})):shown.map(material=>({material,cover:material.files.find(f=>f.image)}))).map(({material,cover},i)=>{const pinned=item.pinnedIds?.includes(material.id),model=material.files.find(f=>/\.glb$/i.test(f.name));return <article className="ds-collection-card" key={material.id+':'+i}>
     <button className="ds-collection-open" onClick={()=>openTopic(item.topicId,item.view==='gallery',material.id,item.view==='gallery'?cover?.path:'')} aria-label={'Открыть: '+material.title}>
      {item.view==='tiles'&&model?<ModelThumbnail asset={model.path}/>:cover&&<img src={contentUrl('/'+cover.path)} alt="" loading="lazy"/>}<span className="ds-collection-copy"><strong>{material.title}</strong>{item.view!=='gallery'&&<p>{material.text.slice(0,200)}</p>}{item.view==='tiles'&&<small>{model?'3D-модель':cover?'Изображение':material.files.length?'Файл':'Заметка'}</small>}</span>{item.view==='list'&&<Icon name="arrow" size={13}/>}</button>
     <button className={'ds-collection-pin '+(pinned?'pinned':'')} disabled={busy} aria-pressed={!!pinned} aria-label={(pinned?'Открепить превью: ':'Показывать первым: ')+material.title} title={pinned?'Открепить превью':'Показывать первым'} onClick={()=>void change({topicId:item.topicId,view:item.view,pinId:material.id,pinned:!pinned})}><Icon name="pin" size={12}/></button>
    </article>})}</div>
    {!(item.view==='gallery'?photos:shown).length&&<button className="ds-collection-empty" onClick={()=>openTopic(item.topicId,item.view==='gallery')}>{item.view==='gallery'?'В теме пока нет изображений · открыть тему':'Добавить первый материал'} <Icon name="plus" size={13}/></button>}
   </section>
  })}
 </section>
}
