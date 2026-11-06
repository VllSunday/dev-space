import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {api,reportError,useDesktop} from '../desktop/client'
import {AgentLogo,Icon} from '../desktop/Icons'
import {tabColors} from '../desktop/chatOrder'
import type {AgentSpace,ChatSession} from '../desktop/types'
import {sessionStatus} from './model'
import {sessionSpaceId} from '../../desktop/service/agent-space-model.mjs'

type Props={active:AgentSpace;collapsed:boolean;toggle:()=>void;choose:(id:string)=>void;select:(session:ChatSession)=>void;newChat:()=>void;settings:()=>void}
export default function AgentSpacesSidebar({active,collapsed,toggle,choose,select,newChat,settings}:Props){
 const state=useDesktop(),spaces=state.settings.agentSpaces||[active]
 const [editor,setEditor]=useState<AgentSpace|'new'|null>(null),[move,setMove]=useState<string|null>(null),[drag,setDrag]=useState('')
 const [renaming,setRenaming]=useState<string|null>(null),[groupName,setGroupName]=useState(''),[groupError,setGroupError]=useState('')
 const sessions=state.sessions.filter(s=>s.open&&sessionSpaceId(state.settings,s.id)===active.id)
 const groups=[...new Set(spaces.map(s=>s.group))],collapsedGroups=state.settings.collapsedAgentSpaceGroups||[]
 const change=(data:Record<string,unknown>)=>api('/agent-spaces',data)
 const run=(data:Record<string,unknown>)=>void change(data).catch(reportError)
 const count=(id:string)=>state.sessions.filter(s=>s.open&&sessionSpaceId(state.settings,s.id)===id).length
 return <aside className={'ds-spaces-sidebar '+(collapsed?'is-collapsed':'')} aria-label="Спейсы и агенты">
  <div className="ds-spaces-top"><div className="ds-spaces-heading"><span>Спейсы</span><button className="ds-icon" title="Создать локальный спейс" aria-label="Создать локальный спейс" onClick={()=>setEditor('new')}><Icon name="plus" size={15}/></button></div>
  <div className="ds-spaces-list">{groups.map(group=><section key={group||'ungrouped'} className="ds-space-group">
   {group&&<div className="ds-space-group-heading"><button title={group} aria-expanded={!collapsedGroups.includes(group)} onClick={()=>run({action:'collapse-group',name:group,collapsed:!collapsedGroups.includes(group)})}><Icon name={collapsedGroups.includes(group)?'arrow':'down'} size={12}/><span>{group}</span></button><button className="ds-icon" title={'Переименовать группу '+group} aria-label={'Переименовать группу '+group} onClick={()=>{setRenaming(group);setGroupName(group);setGroupError('')}}><Icon name="edit" size={12}/></button></div>}
   {(!group||!collapsedGroups.includes(group)||collapsed)&&spaces.filter(s=>s.group===group).map(space=><div className={'ds-space-row '+(active.id===space.id?'active':'')} key={space.id} draggable onDragStart={event=>{setDrag(space.id);event.dataTransfer.setData('text/devspace-agent-space',space.id)}} onDragEnd={()=>setDrag('')} onDragOver={event=>{if(drag&&drag!==space.id)event.preventDefault()}} onDrop={event=>{event.preventDefault();if(drag&&drag!==space.id)run({action:'reorder',id:drag,beforeId:space.id});setDrag('')}}>
    <button className="ds-space-select" aria-pressed={active.id===space.id} title={space.name+' · '+count(space.id)+' агентов\n'+space.cwd} onClick={()=>choose(space.id)}><span className="ds-space-badge" style={{color:space.color||'var(--ds-text)'}}>{space.id==='local'?<Icon name="workspace" size={17}/>:Array.from(space.name)[0]?.toUpperCase()}</span><span className="ds-space-name">{space.name}</span><small>{count(space.id)}</small></button>
    <button className="ds-icon ds-space-edit" title={'Настроить спейс '+space.name} aria-label={'Настроить спейс '+space.name} onClick={()=>setEditor(space)}><Icon name="more" size={15}/></button>
   </div>)}
  </section>)}</div></div>
  <section className="ds-space-agents" aria-label={'Агенты спейса '+active.name}>
   <div className="ds-spaces-heading"><span>Агенты <small>{sessions.length}</small></span><button className="ds-icon" title="Новый агент в этом спейсе · Ctrl+Shift+T" aria-label="Новый агент в этом спейсе" onClick={newChat}><Icon name="plus" size={15}/></button></div>
   {!collapsed&&<p className="ds-space-context" title={active.cwd}>{active.name}</p>}
   <div className="ds-space-agent-items">{sessions.map(session=>{const status=sessionStatus(session);return <div className={'ds-space-agent-row '+(session.id===state.selectedId?'active':'')} key={session.id}>
    <button className="ds-agent-item" title={session.name+' · '+status.label+'\n'+session.cwd} onClick={()=>select(session)}><span className="ds-agent-glyph"><AgentLogo agent={session.agent} size={18}/><i className={'ds-agent-status '+status.kind}/></span><span className="ds-agent-item-text"><strong>{session.name}</strong><small>{status.label}</small></span></button>
    <button className="ds-icon ds-space-agent-move" title={'Перенести '+session.name+' в другой спейс'} aria-label={'Перенести '+session.name+' в другой спейс'} onClick={()=>setMove(session.id)}><Icon name="more" size={14}/></button>
   </div>})}{!sessions.length&&!collapsed&&<div className="ds-space-empty"><p>Здесь пока нет агентов</p><button onClick={newChat}>+ Открыть чат</button></div>}</div>
  </section>
  <footer className="ds-spaces-footer"><button className="ds-icon" onClick={toggle} title={collapsed?'Развернуть спейсы':'Свернуть спейсы'} aria-label={collapsed?'Развернуть спейсы':'Свернуть спейсы'}><Icon name={collapsed?'arrow':'back'} size={15}/></button><span className="ds-local-status">{state.connected?'Локально':'Соединение…'}</span><button className="ds-icon" title="Настройки приложения" aria-label="Настройки приложения" onClick={settings}><Icon name="settings" size={15}/></button></footer>
  {editor&&<SpaceEditor space={editor==='new'?null:editor} otherSpaces={spaces.filter(s=>editor==='new'||s.id!==editor.id)} agents={editor==='new'?[]:state.sessions.filter(s=>sessionSpaceId(state.settings,s.id)===editor.id)} remove={async data=>{if(editor==='new')return;await change({action:'delete',id:editor.id,...data});setEditor(null)}} initialCwd={active.cwd||state.repo} groups={groups.filter((g):g is string=>!!g)} close={()=>setEditor(null)} save={async data=>{await change({action:editor==='new'?'create':'update',...(editor==='new'?{}:{id:editor.id}),...data});setEditor(null)}}/>}
  {move&&<SpaceDialog title="Перенести агента" close={()=>setMove(null)}><form className="ds-form" onSubmit={event=>{event.preventDefault();const id=(event.currentTarget.elements.namedItem('space') as HTMLSelectElement).value;void change({action:'assign',sessionId:move,spaceId:id}).then(()=>setMove(null)).catch(reportError)}}><label>Спейс<select name="space" defaultValue={active.id}>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p className="ds-muted">Чат и переписка сохранятся. Рабочая папка уже запущенного агента останется прежней.</p><footer><button type="button" className="ds-secondary" onClick={()=>setMove(null)}>Отмена</button><button className="ds-primary">Перенести</button></footer></form></SpaceDialog>}
  {renaming&&<SpaceDialog title="Название группы" close={()=>setRenaming(null)}><form className="ds-form" onSubmit={event=>{event.preventDefault();void change({action:'rename-group',name:renaming,newName:groupName.trim()}).then(()=>setRenaming(null)).catch(error=>setGroupError((error as Error).message))}}><label>Название<input autoFocus maxLength={60} value={groupName} onChange={e=>setGroupName(e.target.value)}/></label><p className="ds-muted">Пустое название уберёт группу. Спейсы и агенты сохранятся.</p>{groupError&&<p role="alert">{groupError}</p>}<footer><button className="ds-primary">Сохранить</button></footer></form></SpaceDialog>}
 </aside>
}

function SpaceDialog({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const el=ref.current!;el.showModal();return()=>el.close()},[])
 return createPortal(<dialog ref={ref} className="ds-dialog ds-space-dialog" aria-label={title} onCancel={e=>{e.preventDefault();close()}} onClick={e=>{if(e.target===e.currentTarget)close()}}><header><h2>{title}</h2><button className="ds-icon" aria-label="Закрыть" onClick={close}><Icon name="close"/></button></header>{children}</dialog>,document.body)
}
function SpaceEditor({space,otherSpaces,agents,remove,initialCwd,groups,close,save}:{space:AgentSpace|null;otherSpaces:AgentSpace[];agents:ChatSession[];remove:(data:{agentAction:'move'|'close';destinationId?:string})=>Promise<void>;initialCwd:string;groups:string[];close:()=>void;save:(data:Record<string,unknown>)=>Promise<void>}){
 const [name,setName]=useState(space?.name||''),[cwd,setCwd]=useState(space?.cwd||initialCwd),[color,setColor]=useState(space?.color||''),[group,setGroup]=useState(space?.group||'')
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const [deleting,setDeleting]=useState(false),[destinationId,setDestinationId]=useState(otherSpaces[0]?.id||'')
 const [agentAction,setAgentAction]=useState<'move'|'close'>('move')
 if(deleting&&space)return <SpaceDialog title={'Удалить спейс «'+space.name+'»?'} close={()=>{if(!busy)setDeleting(false)}}><form className="ds-form" onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await remove({agentAction,...(agentAction==='move'?{destinationId}:{})})}catch(error){setError((error as Error).message);setBusy(false)}}}>
  <label>Что сделать с агентами<select value={agentAction} disabled={busy} onChange={event=>{setAgentAction(event.target.value as 'move'|'close');setError('')}}><option value="move">Перенести в другой спейс</option><option value="close">Не переносить — закрыть агентов</option></select></label>
  {agentAction==='move'?<><p>Удалится только спейс. Запущенные агенты продолжат работу.</p><label>Перенести агентов в спейс<select value={destinationId} disabled={busy} required onChange={event=>setDestinationId(event.target.value)}>{otherSpaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p className="ds-muted">Всего агентов: {agents.length}. Они появятся в списке выбранного спейса.</p></>:<><p>Агенты этого спейса будут закрыты, их запущенные процессы остановятся. Они не появятся в списках других спейсов.</p><p className="ds-muted">Чаты сохранятся в общей истории: их можно открыть снова. Рабочие папки и файлы останутся на месте.</p>{agents.length>0&&<details className="ds-space-delete-agents"><summary>Чаты спейса: {agents.length}</summary><ul>{agents.map(agent=><li key={agent.id}>{agent.name}</li>)}</ul></details>}</>}
  <p className="ds-muted">Проект справа останется прежним.</p>
  {error&&<p className="ds-space-error" role="alert">{error}</p>}<footer><button type="button" className="ds-secondary" disabled={busy} onClick={()=>setDeleting(false)}>Отмена</button><button className="ds-space-delete" disabled={busy||(agentAction==='move'&&!otherSpaces.some(s=>s.id===destinationId))}>{busy?'Удаляем…':agentAction==='close'?'Закрыть агентов и удалить спейс':'Удалить спейс'}</button></footer>
 </form></SpaceDialog>
 return <SpaceDialog title={space?'Настроить спейс':'Новый локальный спейс'} close={()=>{if(!busy)close()}}><form className="ds-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await save({name:name.trim(),cwd,color:color||null,group:group.trim()||null})}catch(error){setError((error as Error).message);setBusy(false)}}}>
  <label>Название<input autoFocus value={name} maxLength={100} required onChange={e=>setName(e.target.value)} placeholder="Например: Работа, Личное, Эксперименты"/></label>
  <label>Рабочая папка для новых агентов<input value={cwd} required onChange={e=>setCwd(e.target.value)} spellCheck={false}/></label><p className="ds-muted">Спейс объединяет чаты. Проект справа выбирается отдельно. Папка существующих агентов не изменится.</p>
  <fieldset className="ds-space-colors"><legend>Цвет</legend><button type="button" aria-pressed={!color} onClick={()=>setColor('')}>Авто</button>{tabColors.map(c=><button type="button" key={c.value} title={c.name} aria-label={c.name} aria-pressed={color===c.value} onClick={()=>setColor(c.value)} style={{backgroundColor:c.value}}/>)}<input type="color" aria-label="Свой цвет спейса" value={color||'#a6afbc'} onChange={e=>setColor(e.target.value)}/></fieldset>
  <label>Группа <small>необязательно</small><input list="agent-space-groups" value={group} maxLength={60} onChange={e=>setGroup(e.target.value)} placeholder="Без группы"/><datalist id="agent-space-groups">{groups.map(g=><option key={g} value={g}/>)}</datalist></label>
  {error&&<p className="ds-space-error" role="alert">{error}</p>}{space&&<div className="ds-space-delete-section"><button type="button" className="ds-space-delete" disabled={busy||!otherSpaces.length} onClick={()=>{setError('');setDeleting(true)}}><Icon name="trash" size={14}/>Удалить спейс</button>{!otherSpaces.length&&<p className="ds-muted">Это единственный спейс. Чтобы удалить его, сначала создайте другой.</p>}</div>}<footer><button type="button" className="ds-secondary" disabled={busy} onClick={close}>Отмена</button><button className="ds-primary" disabled={busy||!name.trim()||!cwd.trim()}>{busy?'Сохраняем…':space?'Сохранить':'Создать спейс'}</button></footer>
 </form></SpaceDialog>
}
