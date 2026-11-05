import { useState } from 'react'
import { Icon } from '../desktop/Icons'
import { contentUrl } from '../desktop/client'
import { collectionMaterials, pageCollections, type Material, type Page, type Project } from './model'

export type OpenTopic=(topicId:string,gallery?:boolean,materialId?:string,filePath?:string)=>void
export default function PageCollections({page,project,materials,mutate,openTopic}:{page:Page;project:Project;materials:Material[];mutate:(change:Record<string,unknown>)=>Promise<unknown>;openTopic:OpenTopic}) {
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const collections=pageCollections(page,project)
 const change=async(data:Record<string,unknown>)=>{setBusy(true);setError('');try{await mutate({action:'collection',id:page.id,...data})}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
 return <section className="ds-collections" aria-label="Закреплённые темы">
  <header><h2>Разделы проекта</h2><button aria-expanded={editing} onClick={()=>setEditing(value=>!value)}><Icon name="pin" size={13}/>{editing?'Готово':'Настроить разделы'}</button></header>
  {editing&&<div className="ds-collection-settings"><p>Закрепите тему или галерею. На главной появится до восьми последних записей.</p>{[{id:'all',name:'Все материалы'}, {id:'unfiled',name:'Без темы'}, ...project.topics].map(topic=><div key={topic.id}><strong>{topic.name}</strong>{(['list','gallery'] as const).map(view=><label key={view}><input type="checkbox" disabled={busy} checked={collections.some(c=>c.topicId===topic.id&&c.view===view)} onChange={event=>void change({topicId:topic.id,view,enabled:event.target.checked})}/>{view==='list'?'Материалы':'Галерея'}</label>)}</div>)}</div>}
  {error&&<p className="ds-inline-error" role="alert">{error}</p>}
  {!collections.length&&!editing&&<p className="ds-muted">Закрепите темы, чтобы видеть новые материалы на этой странице.</p>}
  {collections.map(collection=>{
   const label=collection.topicId==='all'?(collection.view==='gallery'?'Галерея проекта':'Все материалы'):collection.topicId==='unfiled'?'Без темы':project.topics.find(t=>t.id===collection.topicId)?.name||''
   const all=collectionMaterials(materials,project.id,collection),shown=all.slice(0,8)
   return <section key={collection.topicId+':'+collection.view} className="ds-collection" data-collection-topic={collection.topicId} data-collection-view={collection.view}>
    <header><button className="ds-collection-heading" onClick={()=>openTopic(collection.topicId,collection.view==='gallery')}><h3>{label}</h3>{collection.view==='gallery'&&collection.topicId!=='all'&&<span>Галерея</span>}<small>{all.length}</small></button><button className="ds-collection-all" onClick={()=>openTopic(collection.topicId,collection.view==='gallery')}>Смотреть все <Icon name="arrow" size={12}/></button></header>
    <div className="ds-collection-grid">{shown.map(material=>{const cover=material.files.find(f=>f.image),pinned=collection.pinnedIds?.includes(material.id);return <article className="ds-collection-card" key={material.id}>
     <button className="ds-collection-open" onClick={()=>openTopic(collection.topicId,collection.view==='gallery',material.id,collection.view==='gallery'?cover?.path:'')} aria-label={'Открыть: '+material.title}>
      {cover&&<img src={contentUrl('/'+cover.path)} alt="" loading="lazy"/>}<strong>{material.title}</strong><p>{material.text.slice(0,150)}</p><span>{material.files.length?material.files.length+' файлов':'Заметка'}</span>
     </button><button className={'ds-collection-pin '+(pinned?'pinned':'')} disabled={busy} aria-pressed={!!pinned} aria-label={(pinned?'Открепить превью: ':'Показывать первым: ')+material.title} title={pinned?'Открепить превью':'Показывать первым'} onClick={()=>void change({topicId:collection.topicId,view:collection.view,pinId:material.id,pinned:!pinned})}><Icon name="pin" size={12}/></button>
    </article>})}</div>
    {!shown.length&&<button className="ds-collection-empty" onClick={()=>openTopic(collection.topicId,collection.view==='gallery')}>Добавить первый материал <Icon name="plus" size={13}/></button>}
   </section>
  })}
 </section>
}
