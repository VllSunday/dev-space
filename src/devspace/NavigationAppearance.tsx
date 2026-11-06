import {useEffect,useRef,useState,type CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import {Icon,TopicIcon} from '../desktop/Icons'
import TopicIconPicker from './TopicIconPicker'
import type {Page,Project} from './model'
import './navigation-appearance.css'

export function navigationAppearance(project:Project,key:string){
 const color=project.navigationColors?.[key]
 return {'data-nav-key':key,'data-nav-color':color||undefined,style:color?{'--ds-nav-tint':color+'26','--ds-nav-active':color+'45','--ds-nav-edge':color+'99'} as CSSProperties:undefined}
}

const colors=[['Розовый','#dba3bb'],['Персиковый','#dfa48b'],['Золотой','#d7bd80'],['Зелёный','#a5bd91'],['Мятный','#8cc8b4'],['Голубой','#91b6da'],['Сиреневый','#b8a2d4'],['Серый','#a6afbc']]

export default function NavigationAppearance({project,pages,initialKey,close,mutate}:{project:Project;pages:Page[];initialKey:string;close:()=>void;mutate:(data:Record<string,unknown>)=>Promise<unknown>}){
 const entries=[
  ...[['all','Все материалы','files'],['unfiled','Без темы','folder'],['images','Все изображения','image'],['tasks','Задачи','clean'],['archive','Архив','history']].map(([key,name,defaultIcon])=>({key,name,defaultIcon,icon:undefined as string|undefined,kind:'builtin',id:''})),
  ...project.topics.map(t=>({key:'topic:'+t.id,name:'Тема · '+t.name,defaultIcon:'folder',icon:t.icon,kind:'topic',id:t.id})),
  ...pages.filter(p=>p.projectId===project.id).map(p=>({key:'page:'+p.id,name:(p.id===project.homePageId?'Главная · ':'Страница · ')+p.title,defaultIcon:'workspace',icon:p.icon,kind:'page',id:p.id})),
 ]
 const [key,setKey]=useState(initialKey),[customByKey,setCustomByKey]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const item=entries.find(e=>e.key===key)||entries[0],saved=project.navigationColors?.[item.key]||''
 const custom=customByKey[item.key]||saved||'#91b6da'
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const element=dialog.current!;element.showModal();return()=>element.close()},[])
 const save=async(color:string|null)=>{if(busy)return;setBusy(true);setError('');try{await mutate({action:'navigation-color',projectId:project.id,key:item.key,color})}catch(error){setError((error as Error).message)}finally{setBusy(false)}}
 return createPortal(<dialog ref={dialog} className="ds-dialog ds-navigation-appearance" aria-label="Значки и цвета навигации" onCancel={event=>{event.preventDefault();if(!busy)close()}} onClick={event=>{if(event.target===event.currentTarget&&!busy)close()}}>
  <header><h2>Значки и цвета</h2><button className="ds-icon" disabled={busy} aria-label="Закрыть оформление" onClick={close}><Icon name="close"/></button></header>
  <div className="ds-form">
   <p className="ds-muted">Оформление пунктов панели проекта. Один цвет можно назначить нескольким темам и страницам.</p>
   <label>Пункт панели<select autoFocus value={item.key} disabled={busy} onChange={event=>{setKey(event.target.value);setError('')}}>{entries.map(entry=><option key={entry.key} value={entry.key}>{entry.name}</option>)}</select></label>
   <div className="ds-nav-preview" {...navigationAppearance(project,item.key)}>{item.icon?<TopicIcon value={item.icon} size={18}/>:<Icon name={item.defaultIcon} size={18}/>}<span>{item.name}</span></div>
   {item.kind!=='builtin'&&<TopicIconPicker key={item.key} topic={item} kind={item.kind==='page'?'страницы':'темы'} commit={icon=>mutate({action:item.kind==='page'?'page-icon':'topic-icon',projectId:project.id,id:item.id,icon})}/>}
   <fieldset className="ds-navigation-colors" disabled={busy}><legend>Цвет фона</legend><button type="button" aria-pressed={!saved} onClick={()=>void save(null)}>Без цвета</button>{colors.map(([name,color])=><button type="button" key={color} title={name} aria-label={'Цвет фона: '+name} aria-pressed={saved===color} onClick={()=>void save(color)} style={{backgroundColor:color}}/>)}</fieldset>
   <div className="ds-nav-custom"><label>Свой цвет<input type="color" aria-label="Свой цвет фона" disabled={busy} value={custom} onChange={event=>setCustomByKey(previous=>({...previous,[item.key]:event.target.value}))}/></label><button type="button" disabled={busy} onClick={()=>void save(custom)}>Применить цвет</button></div>
   <p className="ds-muted">Цвет сохраняется в этом проекте. Активный пункт выделяется сильнее. Быстрый доступ — правая кнопка мыши по пункту панели.</p>
   <p role="status" className={error?'ds-space-error':'ds-muted'}>{error|| (busy?'Сохраняем…':'Изменения сохраняются автоматически.')}</p>
   <footer><button className="ds-primary" disabled={busy} onClick={close}>Готово</button></footer>
  </div>
 </dialog>,document.body)
}
