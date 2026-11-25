import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, contentUrl, uploadSpaceFile } from '../desktop/client'
import { Icon } from '../desktop/Icons'
import { EditableText } from '../devspace/PageEditor'
import PageModelViewer from '../devspace/PageModelViewer'
import ZoneView from '../plugins/ZoneView'
import type { PluginDraft, PluginsState, Thing } from '../plugins/types'
import type { FlowRun } from '../flows/types'
import { runStatus } from '../flows/types'
import type { Board, Project, Proposal, SpaceState, Task, Zone } from '../devspace/model'
import { kindNames, statusGroupNames, taskStatusNames, thingByRef } from '../../desktop/service/things.mjs'
import { changeStatus } from './Board'
import { findView } from './data'

type Mutate = (change: Record<string, unknown>) => Promise<unknown>
export function Popover({ open, close, children, className = '' }: { open: boolean; close: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open) return; const away = (event: PointerEvent) => { if (!ref.current?.parentElement?.contains(event.target as Node)) close() }, key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }; window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key); return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key) } }, [open, close])
  return open ? <div ref={ref} className={'bd-popover ' + className} role="menu">{children}</div> : null
}

// «Добавить»: things, zones, connections from plugins — and, first of all,
// «describe by words», which has an agent build a view for you.
export type AddChoice = 'words' | 'note' | 'file' | 'task' | 'page' | 'zone' | 'board'
export function BoardHeader({ project, projects, board, boards, plugins, level, query, setQuery, chooseProject, newProject, chooseBoard, mutate, notify, add, addConnection, configure }: {
  project: Project; projects: Project[]; board: Board; boards: Board[]; plugins: PluginsState; level: 'board' | 'zone' | 'thing' | 'other'; query: string; setQuery: (value: string) => void
  chooseProject: (id: string) => void; newProject: () => void; chooseBoard: (id: string) => void; mutate: Mutate; notify: (text: string) => void
  add: (choice: AddChoice) => void; addConnection: (connectionId: string) => void; configure: (connectionId: string) => void
}) {
  const [menu, setMenu] = useState<'add' | 'kind' | 'board' | null>(null), [renaming, setRenaming] = useState(false), search = useRef<HTMLInputElement>(null)
  const kinds = plugins.plugins.flatMap(plugin => plugin.boards.map(kind => ({ ref: `${plugin.id}/${kind.id}`, title: kind.title, description: kind.description, plugin: plugin.name, builtin: plugin.id === 'core' })))
  const close = () => setMenu(null)
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.code === 'KeyF' && !(event.target as HTMLElement).closest('.xterm,.ds-agent-pane')) { event.preventDefault(); search.current?.focus(); search.current?.select() } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [])
  return <header className="bd-header">
    <div className="bd-project"><Icon name="workspace" size={15} /><select aria-label="Проект" value={project.id} onChange={event => chooseProject(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="ds-icon" aria-label="Новый проект" title="Новый проект · Ctrl+Alt+N" onClick={newProject}><Icon name="plus" size={13} /></button></div>
    <nav className="bd-tabs" aria-label="Доски проекта">
      {boards.map(item => item.id === board.id && renaming
        ? <form key={item.id} onSubmit={event => { event.preventDefault(); const value = (event.currentTarget.elements.namedItem('name') as HTMLInputElement).value.trim(); setRenaming(false); if (value && value !== item.name) void mutate({ action: 'board-update', boardId: item.id, name: value }).catch(() => {}) }}><input name="name" defaultValue={item.name} autoFocus aria-label="Название доски" onBlur={event => event.currentTarget.form?.requestSubmit()} onKeyDown={event => { if (event.key === 'Escape') setRenaming(false) }} /></form>
        : <button type="button" key={item.id} aria-current={item.id === board.id && level === 'board' ? 'page' : undefined} className={item.id === board.id ? 'active' : ''} title={item.id === board.id ? 'Двойной щелчок — переименовать' : item.name} onClick={() => chooseBoard(item.id)} onDoubleClick={() => { if (item.id === board.id) setRenaming(true) }}>{item.name}</button>)}
      <button type="button" className="ds-icon" aria-label="Новая доска" title="Новая доска" onClick={() => add('board')}><Icon name="plus" size={13} /></button>
    </nav>
    <span className="bd-fill" />
    <label className="bd-search"><Icon name="search" size={13} /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти на доске" aria-label="Найти на доске" onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() } }} />{query && <button type="button" aria-label="Сбросить поиск" onClick={() => setQuery('')}><Icon name="close" size={12} /></button>}</label>
    <div className="bd-menu"><button type="button" className="ds-icon" aria-label="Вид доски" title="Вид доски" aria-expanded={menu === 'kind'} onClick={() => setMenu(menu === 'kind' ? null : 'kind')}><Icon name="settings" size={14} /></button>
      <Popover open={menu === 'kind'} close={close} className="right wide">
        <h5>Вид доски</h5>
        {kinds.map(kind => <button type="button" role="menuitemradio" aria-checked={board.kind === kind.ref} key={kind.ref} onClick={() => { close(); void mutate({ action: 'board-update', boardId: board.id, kind: kind.ref }).catch(() => {}) }}><span>{kind.title}{kind.description && <em>{kind.description}</em>}</span>{!kind.builtin && <small>{kind.plugin}</small>}{board.kind === kind.ref && <Icon name="check" size={13} />}</button>)}
        <p>Вид доски приносят плагины: он меняет раскладку и оформление самой доски.</p>
        <hr />
        <button type="button" role="menuitem" onClick={() => { close(); setRenaming(true) }}><span>Переименовать доску</span></button>
        <button type="button" role="menuitem" className="danger" disabled={boards.length < 2} onClick={() => { close(); void mutate({ action: 'board-delete', boardId: board.id }).then(() => { notify('Доска удалена. Вещи остались в проекте. Отменить: Ctrl+Z'); chooseBoard(boards.find(item => item.id !== board.id)!.id) }).catch(() => {}) }}><span>Удалить доску</span></button>
      </Popover></div>
    <div className="bd-menu"><button type="button" className="ds-primary bd-add-button" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}><Icon name="plus" size={14} />Добавить</button>
      <Popover open={menu === 'add'} close={close} className="right wide">
        <button type="button" role="menuitem" className="featured" onClick={() => { close(); add('words') }}><Icon name="mic" size={15} /><span>Описать словами…<em>Скажите, что хотите видеть и откуда брать данные. Агент соберёт вид и покажет его на примере.</em></span></button>
        <hr />
        <button type="button" role="menuitem" onClick={() => { close(); add('note') }}><Icon name="note" size={14} /><span>Заметка</span></button>
        <button type="button" role="menuitem" onClick={() => { close(); add('file') }}><Icon name="attach" size={14} /><span>Файл, изображение или модель</span></button>
        <button type="button" role="menuitem" onClick={() => { close(); add('task') }}><Icon name="check" size={14} /><span>Задача</span></button>
        <button type="button" role="menuitem" onClick={() => { close(); add('page') }}><Icon name="book" size={14} /><span>Документ</span></button>
        <hr />
        <button type="button" role="menuitem" onClick={() => { close(); add('zone') }}><Icon name="folder" size={14} /><span>Зона</span></button>
        {plugins.connections.filter(item => item.pluginId !== 'tasks').map(item => <button type="button" role="menuitem" key={item.id} onClick={() => { close(); if (item.ready) addConnection(item.id); else configure(item.id) }}><Icon name="mcp" size={14} /><span>{item.title}{!item.ready && <em>Сначала настройте подключение</em>}</span><small>{item.pluginName}</small></button>)}
      </Popover></div>
  </header>
}

const zoneKinds = [
  { id: 'topic', title: 'Заметки и файлы', hint: 'Своя группа материалов', view: 'core/list', source: undefined },
  { id: 'tiles', title: 'Картинки и модели', hint: 'Плитками с превью', view: 'core/tiles', source: undefined },
  { id: 'tasks', title: 'Задачи проекта', hint: 'Доской с колонками', view: 'tasks/columns', source: { kind: 'tasks' } },
  { id: 'pages', title: 'Документы', hint: 'Страницы проекта', view: 'core/list', source: { kind: 'pages' } },
  { id: 'refs', title: 'Подборка', hint: 'Вещи из разных зон', view: 'core/tiles', source: { kind: 'refs', refs: [] } },
  { id: 'outline', title: 'Навигатор проекта', hint: 'Плотный список всего', view: 'core/outline', source: { kind: 'outline' } },
] as const
// Small forms behind «Добавить». Every one ends in a typed operation.
export function AddDialog({ choice, project, board, zones, mutate, notify, close, opened }: { choice: Exclude<AddChoice, 'words'>; project: Project; board: Board; zones: Zone[]; mutate: Mutate; notify: (text: string) => void; close: () => void; opened: (state: SpaceState, kind: 'page' | 'board') => void }) {
  const writable = zones.filter(zone => zone.source.kind === 'topic' || zone.source.kind === 'refs')
  const [text, setText] = useState(''), [zoneId, setZoneId] = useState(writable[0]?.id || ''), [kind, setKind] = useState<string>('topic'), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const titles = { note: 'Новая заметка', file: 'Файл, изображение или модель', task: 'Новая задача', page: 'Новый документ', zone: 'Новая зона', board: 'Новая доска' }
  const target = writable.find(zone => zone.id === zoneId)
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const place = target ? { boardId: board.id, zoneId: target.id, topicId: target.source.kind === 'topic' && target.source.topicId !== 'all' ? target.source.topicId : 'unfiled' } : { topicId: 'unfiled' }
      if (choice === 'note') await mutate({ action: 'create-material', projectId: project.id, text: text.trim(), ...place })
      else if (choice === 'file') await mutate({ action: 'create-material', projectId: project.id, text: text.trim(), files: await Promise.all(files.map(uploadSpaceFile)), ...place })
      else if (choice === 'task') await mutate({ action: 'create-task', projectId: project.id, title: text.trim() })
      else if (choice === 'page') opened(await mutate({ action: 'create-page', projectId: project.id, topicId: 'unfiled', title: text.trim() || 'Новый документ' }) as SpaceState, 'page')
      else if (choice === 'board') opened(await mutate({ action: 'board-create', projectId: project.id, name: text.trim() || 'Новая доска' }) as SpaceState, 'board')
      else { const chosen = zoneKinds.find(item => item.id === kind)!; await mutate({ action: 'zone-create', boardId: board.id, name: text.trim() || chosen.title, view: chosen.view, ...(chosen.source ? { source: chosen.source } : {}) }) }
      if (choice === 'note' || choice === 'file') notify(target ? 'Добавлено в зону «' + target.name + '»' : 'Добавлено в проект')
      close()
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  const ready = choice === 'file' ? files.length > 0 : choice === 'zone' || choice === 'page' || choice === 'board' ? true : !!text.trim()
  return <Sheet title={titles[choice]} close={close}><form className="ds-form" onSubmit={event => { event.preventDefault(); if (ready && !busy) void submit() }}>
    {choice === 'zone' && <div className="bd-kinds" role="radiogroup" aria-label="Что будет в зоне">{zoneKinds.map(item => <label key={item.id} className={kind === item.id ? 'active' : ''}><input type="radio" name="kind" checked={kind === item.id} onChange={() => setKind(item.id)} /><b>{item.title}</b><small>{item.hint}</small></label>)}</div>}
    {choice === 'file' && <label className="bd-file"><input type="file" multiple onChange={event => setFiles([...event.target.files || []])} /><span>{files.length ? files.map(file => file.name).join(', ') : 'Выберите файлы. Изображения и GLB-модели открываются прямо на доске.'}</span></label>}
    {choice === 'note' ? <textarea autoFocus rows={5} value={text} onChange={event => setText(event.target.value)} placeholder="Мысль, ссылка или кусок текста" aria-label="Текст заметки" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && ready) { event.preventDefault(); void submit() } }} />
      : <input autoFocus={choice !== 'file'} value={text} onChange={event => setText(event.target.value)} aria-label="Название" placeholder={choice === 'task' ? 'Что нужно сделать' : choice === 'file' ? 'Подпись (необязательно)' : choice === 'zone' ? 'Название зоны: Локации, Персонажи, Референсы…' : 'Название'} />}
    {(choice === 'note' || choice === 'file') && writable.length > 0 && <label className="bd-select wide"><span>Зона</span><select value={zoneId} onChange={event => setZoneId(event.target.value)} aria-label="Зона">{writable.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>}
    {error && <p className="bd-note warn" role="alert">{error}</p>}
    <div className="ds-actions"><button type="button" className="ds-secondary" onClick={close}>Отмена</button><button className="ds-primary" disabled={!ready || busy}>{busy ? 'Добавляем…' : 'Добавить'}</button></div>
  </form></Sheet>
}
export function Sheet({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close() }, [])
  return <dialog ref={ref} className={'ds-dialog ' + (wide ? 'wide' : '')} aria-label={title} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}><header><h2>{title}</h2><button className="ds-icon" aria-label="Закрыть" onClick={close}><Icon name="close" /></button></header>{children}</dialog>
}

// What agents and flows have produced and a person has not decided on yet.
// It lies on the board dashed until accepted.
export function ProposalTray({ runs, proposals, drafts, decide, resolve, openProposal, openDraft, openFlows, focusAgent }: {
  runs: FlowRun[]; proposals: Proposal[]; drafts: PluginDraft[]
  decide: (run: FlowRun, output: string, note?: string) => Promise<unknown>; resolve: (run: FlowRun, action: 'continue' | 'stop') => Promise<unknown>
  openProposal: (id: string) => void; openDraft: (id: string, run?: FlowRun) => void; openFlows: () => void; focusAgent: (sessionId: string) => void
}) {
  const [returning, setReturning] = useState<string | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState('')
  const act = (id: string, action: () => Promise<unknown>) => { setBusy(id); void action().catch(() => {}).finally(() => setBusy('')) }
  const claimed = new Set(runs.flatMap(run => run.person?.proposal ? [run.person.proposal.kind + ':' + run.person.proposal.id] : []))
  const loose = proposals.filter(item => !item.error && !claimed.has('page:' + item.id)), looseDrafts = drafts.filter(item => !claimed.has('plugin:' + item.id))
  if (!runs.length && !loose.length && !looseDrafts.length) return null
  const open = (run: FlowRun) => { const proposal = run.person?.proposal; if (proposal?.kind === 'page') openProposal(proposal.id); else if (proposal?.kind === 'plugin') openDraft(proposal.id, run); else openFlows() }
  return <div className="bd-tray" aria-label="Предложения и решения">
    {runs.map(run => <article key={run.id} className={'bd-proposal ' + run.status}>
      <header><Icon name="chats" size={13} /><span>{run.status === 'waiting-person' ? 'Предложение' : 'Нужны вы'} · флоу «{run.name}»</span><em>{runStatus[run.status]}</em></header>
      {run.status === 'waiting-person' ? <>
        <h3>{run.person?.proposal?.title || run.item?.title || run.person?.question}</h3>
        {run.person?.summary && <p>{run.person.summary}</p>}
        {returning === run.id ? <form onSubmit={event => { event.preventDefault(); act(run.id, () => decide(run, 'return', note).then(() => { setReturning(null); setNote('') })) }}><input autoFocus value={note} onChange={event => setNote(event.target.value)} placeholder="Что исправить" aria-label="Что исправить" /><button className="ds-primary" disabled={busy === run.id}>Вернуть</button><button type="button" className="ds-secondary" onClick={() => setReturning(null)}>Отмена</button></form>
          : <div className="bd-proposal-actions">{run.outputs.map(output => <button type="button" key={output.id} className={output.id === 'accept' ? 'ds-primary' : 'ds-secondary'} disabled={busy === run.id} onClick={() => output.id === 'return' ? setReturning(run.id) : act(run.id, () => decide(run, output.id))}>{output.id === 'accept' ? 'Принять' : output.id === 'return' ? 'Вернуть' : output.title}</button>)}{run.person?.proposal && <button type="button" className="ds-secondary" onClick={() => open(run)}>Открыть</button>}</div>}
      </> : <>
        <p>{run.reason}</p>
        <div className="bd-proposal-actions">{run.canContinue && <button type="button" className="ds-primary" disabled={busy === run.id} onClick={() => act(run.id, () => resolve(run, 'continue'))}>Продолжить</button>}<button type="button" className="ds-secondary" disabled={busy === run.id} onClick={() => act(run.id, () => resolve(run, 'stop'))}>Остановить флоу</button>{Object.values(run.roles).find(role => role.sessionId) && <button type="button" className="ds-secondary" onClick={() => focusAgent(Object.values(run.roles).find(role => role.sessionId)!.sessionId!)}>К агенту</button>}</div>
      </>}
    </article>)}
    {loose.map(item => <article key={item.id} className="bd-proposal"><header><Icon name="book" size={13} /><span>Предложение страницы</span></header><h3>{item.title}</h3><div className="bd-proposal-actions"><button type="button" className="ds-secondary" onClick={() => openProposal(item.id)}>Открыть</button></div></article>)}
    {looseDrafts.map(item => <article key={item.id} className="bd-proposal"><header><Icon name="mcp" size={13} /><span>Черновик плагина</span></header><h3>{item.plugin?.name || item.id}</h3>{item.error && <p>{item.error}</p>}<div className="bd-proposal-actions"><button type="button" className="ds-secondary" onClick={() => openDraft(item.id)}>Открыть</button></div></article>)}
  </div>
}

// One thing on the whole screen, in the view for its kind. Notes, images and
// documents open in the editors the app already has; this covers the rest.
export function ThingScreen({ thingRef, data, project, plugins, mutate, notify, back, backLabel, openMaterial, external }: { thingRef: string; data: SpaceState; project: Project; plugins: PluginsState; mutate: Mutate; notify: (text: string) => void; back: () => void; backLabel: string; openMaterial: (id: string) => void; external?: Thing }) {
  const thing = thingRef.startsWith('ext:') ? external : thingByRef(data, thingRef)
  const crumbs = (title: string, kind: string) => <header className="bd-crumbs"><button type="button" onClick={back} title="Назад · Alt+←"><Icon name="back" size={14} />{backLabel}</button><b>/</b><h1>{title}</h1><small>{kind}</small></header>
  if (!thing) return <div className="bd-desk">{crumbs('Вещь не найдена', '')}<div className="ds-empty"><h2>Этой вещи больше нет</h2><p>Возможно, её удалили или она пришла из подключения, которое сейчас недоступно.</p></div></div>
  const api = { mutate, notify, project }
  if (thing.kind === 'task' && !thing.external) {
    const task = data.tasks.find(item => item.id === thing.id) as Task, source = data.materials.find(item => item.id === task.sourceId)
    return <div className="bd-desk">{crumbs(task.title, 'Задача')}<div className="bd-desk-body bd-thing">
      <EditableText className="bd-thing-title" label="Название задачи" value={task.title} commit={value => value.trim() && value.trim() !== task.title ? mutate({ action: 'update-task', id: task.id, title: value.trim() }) : undefined} />
      <div className="bd-segment" role="radiogroup" aria-label="Статус">{(Object.keys(taskStatusNames) as Task['status'][]).map(status => <button type="button" role="radio" aria-checked={task.status === status} key={status} onClick={() => void mutate({ action: 'update-task', id: task.id, status }).catch(() => {})}>{taskStatusNames[status]}</button>)}</div>
      {source && <p className="bd-source">Из материала: <button type="button" className="ds-link" onClick={() => openMaterial(source.id)}>{source.title}</button></p>}
      <div className="ds-actions"><button type="button" className="ds-secondary" onClick={() => void mutate({ action: 'delete-task', id: task.id }).then(() => { notify('Задача удалена. Отменить: Ctrl+Z'); back() }).catch(() => {})}><Icon name="trash" size={14} />Удалить задачу</button></div>
    </div></div>
  }
  if (thing.kind === 'model') {
    const material = data.materials.find(item => item.id === thing.id)!
    return <div className="bd-desk">{crumbs(thing.title, '3D-модель')}<div className="bd-desk-body bd-thing wide">
      <PageModelViewer materials={[]} mutate={mutate} modelFiles={material.files.filter(file => /\.glb$/i.test(file.path))} readOnly />
      {thing.text && <p className="bd-thing-text">{thing.text}</p>}
      <div className="ds-actions"><button type="button" className="ds-secondary" onClick={() => openMaterial(material.id)}>Открыть как материал</button></div>
    </div></div>
  }
  // A thing from a connection. Its text came from outside and is shown as plain text.
  const role = plugins.connections.find(item => item.id === thing.external)
  return <div className="bd-desk">{crumbs(thing.title, role?.title || kindNames[thing.kind])}<div className="bd-desk-body bd-thing">
    <h2 className="bd-thing-title">{thing.key && <code>{thing.key}</code>} {thing.title}</h2>
    {thing.statusGroup && <div className="bd-segment" role="radiogroup" aria-label="Статус">{(['todo', 'doing', 'done'] as const).map(group => <button type="button" role="radio" aria-checked={thing.statusGroup === group} key={group} disabled={!role?.operations.some(operation => operation.role === 'setStatus')} onClick={() => void changeStatus(api, thing, group)}>{statusGroupNames[group]}</button>)}{thing.status && <span>в сервисе: {thing.status}</span>}</div>}
    {thing.assignee && <p className="bd-source">Исполнитель: {thing.assignee}</p>}
    {thing.image && <img src={contentUrl('/' + thing.image)} alt="" />}
    {thing.text && <p className="bd-thing-text">{thing.text}</p>}
    {thing.url && <div className="ds-actions"><a className="ds-secondary" href={thing.url} target="_blank" rel="noreferrer noopener"><Icon name="external" size={14} />Открыть в сервисе</a></div>}
  </div></div>
}

// A plugin an agent has built, before it is installed: what it is, what it
// reads and may change, and how it looks on sample data.
export function PluginPreview({ draft, plugins, accept, discard, close, busy }: { draft: PluginDraft; plugins: PluginsState; accept: () => void; discard: () => void; close: () => void; busy: boolean }) {
  const plugin = draft.plugin, view = plugin?.views.find(item => item.level === 'zone'), sample = draft.sample?.things || []
  return <Sheet title={plugin ? 'Плагин «' + plugin.name + '»' : 'Черновик плагина'} close={close} wide><div className="bd-preview">
    {!plugin ? <p className="bd-note warn">{draft.error}</p> : <>
      <p>{plugin.description}</p>
      <Rights plugin={plugin} />
      {view && <section><h4>Как выглядит · на примере данных</h4><div className="bd-sample">{view.render.type === 'code' ? <p className="bd-note">Вид со своим кодом. Он запустится в песочнице после установки.</p> : <ZoneView view={view} pluginId={plugin.id} things={sample} viewBase={plugins.viewBase} zoneName="Пример" open={() => {}} setStatus={() => {}} />}</div></section>}
      {draft.request && <section><h4>Просьба</h4><p className="bd-request">{draft.request}</p></section>}
    </>}
    <div className="ds-actions"><button type="button" className="ds-secondary" disabled={busy} onClick={discard}>Отклонить</button>{plugin && <button type="button" className="ds-primary" disabled={busy} onClick={accept}>{busy ? 'Устанавливаем…' : 'Принять и установить'}</button>}</div>
  </div></Sheet>
}
export function Rights({ plugin }: { plugin: NonNullable<PluginDraft['plugin']> }) {
  const rights = plugin.permissions
  return <section className="bd-rights">
    <h4>Что внутри</h4>
    <ul className="bd-contents">{plugin.contents.map((item, index) => <li key={index}><em>{item.kind}</em><span><b>{item.title}</b> — {item.where} · {item.how}</span></li>)}</ul>
    <h4>Что плагин сможет</h4>
    <dl>
      <dt>Читает</dt><dd>{rights.reads.length ? rights.reads.join('; ') : 'ничего'}</dd>
      <dt>Может менять</dt><dd>{rights.changes.length ? rights.changes.join('; ') : 'ничего'}</dd>
      <dt>Сеть</dt><dd>{rights.network.length ? 'только ' + rights.network.join(', ') : 'нет'}</dd>
      <dt>Код</dt><dd>{rights.code ? 'есть, работает в песочнице' : 'нет, собран настройкой'}</dd>
      {rights.keys.length > 0 && <><dt>Ключи</dt><dd>{rights.keys.join('; ')}</dd></>}
      {rights.roles.length > 0 && <><dt>Играет роль</dt><dd>{rights.roles.join(', ')}</dd></>}
      <dt>Не сможет</dt><dd>{rights.never.join('; ')}</dd>
    </dl>
  </section>
}
export { findView }
export const pluginApi = { inspect: (source: string) => api<import('../plugins/types').Inspection>('/plugins/inspect', { source }), install: (ticket: string) => api('/plugins/install', { ticket }) }
