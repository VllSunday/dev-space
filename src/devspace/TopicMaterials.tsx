import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../desktop/Icons'
import { contentUrl } from '../desktop/client'
import { ZoomImage } from '../components/ImagePreview'
import { EditableText } from './PageEditor'
import { safeLink, type Material, type Project, type SpaceFile } from './model'
import PageModelViewer from './PageModelViewer'
import MaterialAttachments from './MaterialAttachments'
import './material-attachments.css'

export default function TopicMaterials({editing=false,project,materials,gallery,targetId,filePath,selected,select,open,quick,mutate,artifact,legacy,remove}: {editing?:boolean;project:Project;materials:Material[];gallery:boolean;targetId:string;filePath:string;selected:string[];select:(id:string,checked:boolean)=>void;open:(id:string)=>void;quick:(id:string)=>void;mutate:(value:Record<string,unknown>)=>Promise<unknown>;artifact:(file:SpaceFile)=>void;legacy:(id:string)=>void;remove:(ids:string[])=>void}) {
 const root=useRef<HTMLDivElement>(null),[count,setCount]=useState(24),[editingId,setEditingId]=useState('')
 const photos=gallery?materials.flatMap(material=>material.files.flatMap((file,fileIndex)=>file.image?[{material,file,fileIndex}]:[])):[]
 const targetIndex=gallery?photos.findIndex(p=>p.material.id===targetId&&(!filePath||p.file.path===filePath)):materials.findIndex(m=>m.id===targetId)
 const visibleCount=Math.max(count,targetIndex+1)
 useLayoutEffect(()=>{
  if(!targetId)return
  const elements=[...root.current?.querySelectorAll<HTMLElement>('[data-material-id]')||[]]
  const target=elements.find(el=>el.dataset.materialId===targetId&&(!gallery||!filePath||el.dataset.filePath===filePath))
  if(target){target.scrollIntoView({block:'start'});(target.querySelector<HTMLElement>('.ds-material-attachments')||target).focus({preventScroll:true});if(editing||editingId===targetId)target.querySelector<HTMLElement>('.ds-record-text')?.focus({preventScroll:true})}
 },[targetId,filePath,gallery,editing,editingId])
 const archive=(m:Material)=>void mutate({action:'update-material',id:m.id,archived:!m.archived}).then(()=>{if(m.id===targetId)open('')}).catch(()=>{})
 const choose=(m:Material)=><input type="checkbox" aria-label={'Выбрать: '+m.title} checked={selected.includes(m.id)} onChange={event=>select(m.id,event.target.checked)}/>
 return <div className={'ds-topic-records '+(gallery?'photo-grid':'')} ref={root}>
  {gallery?photos.slice(0,visibleCount).map(({material,file,fileIndex})=><article key={material.id+':'+file.path+':'+fileIndex} tabIndex={-1} data-material-id={material.id} data-file-path={file.path} className={'ds-photo-record '+(material.id===targetId&&(!filePath||file.path===filePath)?'target':'')}>
   <ZoomImage src={contentUrl('/'+file.path)} alt={file.name}/><footer>{choose(material)}<button onClick={()=>open(material.id)} title="Открыть запись в теме">{material.title}</button><button aria-label={'Быстрый просмотр: '+material.title} title="Быстрый просмотр" onClick={()=>quick(material.id)}><Icon name="search" size={13}/></button></footer>
  </article>):materials.slice(0,visibleCount).map(material=><article key={material.id} data-material-id={material.id} tabIndex={-1} className={'ds-topic-record '+(material.id===targetId?'target expanded':'')+(selected.includes(material.id)?' selected':'')} draggable={material.id!==targetId} onDragStart={event=>event.dataTransfer.setData('text/devspace-material',material.id)} onKeyDown={event=>{if(event.code==='Space'&&event.target===event.currentTarget){event.preventDefault();quick(material.id)}}}>
   {material.id===targetId?<div className="ds-record-editor">
    <header><span>Материал · {project.topics.find(t=>t.id===material.topicId)?.name||'Без темы'}</span><button aria-label="Свернуть материал" onClick={()=>open('')}><Icon name="close" size={14}/></button></header>
    <MaterialAttachments key={material.id} material={material} editing={editing||editingId===material.id} mutate={mutate} artifact={artifact}>
    {editing||editingId===material.id?<><EditableText value={material.title} label="Название материала" className="ds-record-title" draftKey={'material:'+material.id+':title'} commit={title=>mutate({action:'update-material',id:material.id,title:title.trim()||'Материал'})}/>
    <EditableText value={material.text} label="Текст материала" className="ds-record-text" draftKey={'material:'+material.id+':text'} commit={text=>mutate({action:'update-material',id:material.id,text})}/>{!editing&&<button onClick={()=>setEditingId('')}>Готово</button>}</>:<><h2 className="ds-record-title">{material.title}</h2><p className="ds-record-text">{material.text}</p><button className="ds-edit-description" onClick={()=>setEditingId(material.id)}><Icon name="edit" size={13}/>Редактировать материал</button></>}
    {material.files.some(file=>/\.glb$/i.test(file.name))&&<PageModelViewer readOnly modelFiles={material.files.filter(file=>/\.glb$/i.test(file.name))} materials={[]} mutate={mutate}/>}
    {safeLink(material.text.trim())&&<a href={safeLink(material.text.trim())!} target="_blank" rel="noreferrer">Открыть ссылку <Icon name="external" size={12}/></a>}
    </MaterialAttachments>
    <footer><label>Тема<select aria-label="Тема материала" value={material.topicId} onChange={event=>void mutate({action:'update-material',id:material.id,topicId:event.target.value}).catch(()=>{})}><option value="unfiled">Без темы</option>{project.topics.map(topic=><option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><button onClick={()=>void mutate({action:'create-task',projectId:material.projectId,topicId:material.topicId,title:material.title,sourceId:material.id}).catch(()=>{})}><Icon name="clean" size={13}/>Создать задачу</button>{material.legacyId&&<button onClick={()=>legacy(material.legacyId!)}>Исходная карточка</button>}<button onClick={()=>archive(material)}>{material.archived?'Восстановить':'В архив'}</button><button className="ds-delete-material" onClick={()=>remove([material.id])}><Icon name="trash" size={13}/>Удалить материал</button></footer>
   </div>:<div className="ds-record-summary">{choose(material)}<button className="ds-record-open" onClick={()=>open(material.id)}><h3>{material.title}</h3><p>{material.text}</p><small>{material.files.length?material.files.length+' файлов':'Заметка'} · {new Date(material.created).toLocaleDateString('ru-RU')}</small></button>{material.files.find(f=>f.image)&&<button className="ds-record-cover" aria-label={'Открыть: '+material.title} onClick={()=>open(material.id)}><img src={contentUrl('/'+material.files.find(f=>f.image)!.path)} alt="" loading="lazy"/></button>}<div className="ds-record-actions"><button aria-label={'Удалить материал: '+material.title} title="Удалить материал · можно отменить Ctrl+Z" onClick={()=>remove([material.id])}><Icon name="trash" size={14}/></button><button aria-label={'Быстрый просмотр: '+material.title} title="Быстрый просмотр" onClick={()=>quick(material.id)}><Icon name="search" size={14}/></button><button aria-label={material.archived?'Восстановить материал':'Архивировать материал'} onClick={()=>archive(material)}><Icon name="history" size={14}/></button></div></div>}
  </article>)}
  {(gallery?photos.length:materials.length)>visibleCount&&<button className="ds-load-more" onClick={()=>setCount(visibleCount+24)}>Показать ещё</button>}
 </div>
}
