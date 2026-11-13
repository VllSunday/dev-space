import { useEffect, useState } from 'react'
import { api } from '../desktop/client'
import { Icon } from '../desktop/Icons'
import { Rights } from '../board/BoardChrome'
import type { FlowsState } from '../flows/types'
import type { ConnectionInfo, Inspection, PluginInfo, PluginsState } from './types'
import '../flows/flows.css'

// Plugins: what is installed, what can be installed and which roles
// connections play. Before a plugin is installed you see what is inside it,
// what it reads, what it may change and where it may go on the network.
const origins: Record<string, string> = { builtin: 'встроенный', installed: 'установлен', catalog: 'из каталога', draft: 'черновик', folder: 'из папки', git: 'из репозитория' }
const kinds = (plugin: PluginInfo) => [...new Set(plugin.contents.map(item => item.kind.toLowerCase()))].join(', ')

function Connection({ connection, reload, notify, highlight }: { connection: ConnectionInfo; reload: () => unknown; notify: (text: string) => void; highlight: boolean }) {
  const [settings, setSettings] = useState(Object.fromEntries(connection.settings.map(item => [item.id, item.value]))), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); try { await api('/connections', { id: connection.id, settings, ...(secret ? { secret } : {}) }); setSecret(''); notify('Подключение «' + connection.title + '» сохранено'); reload() } catch (error) { notify((error as Error).message) } finally { setBusy(false) } }
  return <section className={'pl-connection' + (highlight ? ' highlight' : '')}>
    <h4>{connection.title}<em className={connection.ready ? 'ok' : 'warn'}>{connection.ready ? 'готово' : 'не настроено: ' + connection.missing.join(', ')}</em></h4>
    {connection.description && <p>{connection.description}</p>}
    {(connection.settings.length > 0 || connection.auth) && <form onSubmit={event => { event.preventDefault(); void save() }}>
      {connection.settings.map(item => <label key={item.id}>{item.title}<input value={settings[item.id] || ''} placeholder={item.placeholder} onChange={event => setSettings(old => ({ ...old, [item.id]: event.target.value }))} spellCheck={false} /></label>)}
      {connection.auth && <label>{connection.auth.label}<input type="password" autoComplete="off" value={secret} placeholder={connection.auth.saved ? 'сохранён — введите новый, чтобы заменить' : 'вставьте ключ'} onChange={event => setSecret(event.target.value)} /><small>{connection.auth.help} Ключ хранит Dev Space на этом компьютере; плагин, агенты и Git его не получают.</small></label>}
      <div className="ds-actions"><button className="ds-primary" disabled={busy}>Сохранить</button>{connection.auth?.saved && <button type="button" className="ds-secondary" onClick={() => void api('/connections', { id: connection.id, secret: null }).then(reload).catch(() => {})}>Забыть ключ</button>}</div>
    </form>}
    <ul className="pl-ops">{connection.operations.map(operation => <li key={operation.name}><em>{operation.kind === 'read' ? 'Чтение' : operation.kind === 'action' ? 'Действие' : 'Событие'}</em><code>{connection.id} {operation.name}</code><span>{operation.title}{operation.role && ' · операция роли'}</span></li>)}</ul>
  </section>
}

export default function PluginsPlace({ plugins, flows, focus, notify, openDraft, describe }: { plugins: PluginsState & { reload: () => unknown }; flows: FlowsState; focus: string; notify: (text: string) => void; openDraft: (id: string) => void; describe: () => void }) {
  const [selected, setSelected] = useState<{ type: 'plugin' | 'catalog' | 'role' | 'preview'; id: string }>({ type: 'plugin', id: 'core' })
  const [source, setSource] = useState(''), [inspection, setInspection] = useState<Inspection | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  // «Настроить» from a launch dialog or the board lands on the connection's plugin.
  useEffect(() => { const connection = plugins.connections.find(item => item.id === focus); if (connection) setSelected({ type: 'plugin', id: connection.pluginId }) }, [focus, plugins.connections.length])
  const inspect = async (value: string) => { setBusy(true); setError(''); try { const shown = await api<Inspection>('/plugins/inspect', { source: value }); setInspection(shown); setSelected({ type: 'preview', id: shown.plugin.id }) } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  const install = async () => { if (!inspection) return; setBusy(true); try { await api('/plugins/install', { ticket: inspection.ticket }); notify('Плагин «' + inspection.plugin.name + '» установлен'); setSelected({ type: 'plugin', id: inspection.plugin.id }); setInspection(null); setSource(''); plugins.reload() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  const plugin = selected.type === 'preview' ? inspection?.plugin : selected.type === 'catalog' ? plugins.catalog.find(item => item.id === selected.id) : plugins.plugins.find(item => item.id === selected.id)
  const role = selected.type === 'role' ? plugins.roles.find(item => item.id === selected.id) : null
  const item = (type: 'plugin' | 'catalog', entry: PluginInfo) => <button type="button" key={type + entry.id} className={selected.type === type && selected.id === entry.id ? 'active' : ''} onClick={() => { setSelected({ type, id: entry.id }); setInspection(null) }}><b>{entry.name}</b><small>{entry.error ? 'не читается' : kinds(entry) + ' · ' + origins[type === 'catalog' ? 'catalog' : entry.origin]}</small></button>
  return <div className="ds-place fl-place">
    <aside className="fl-library" aria-label="Плагины">
      <header><h2>Плагины</h2><button type="button" className="ds-secondary" onClick={describe} title="Агент соберёт плагин по описанию"><Icon name="plus" size={13} />Новый</button></header>
      <nav>
        <h3>Установлены</h3>{plugins.plugins.map(entry => item('plugin', entry))}
        {plugins.drafts.length > 0 && <><h3>Черновики от агента</h3>{plugins.drafts.map(draft => <button type="button" key={draft.id} onClick={() => openDraft(draft.id)}><b>{draft.plugin?.name || draft.id}</b><small>{draft.error ? 'не проходит проверку' : 'ждёт вашего решения'}</small></button>)}</>}
        {plugins.catalog.length > 0 && <><h3>Каталог</h3>{plugins.catalog.map(entry => item('catalog', entry))}</>}
        <h3>Роли</h3>{plugins.roles.map(entry => <button type="button" key={entry.id} className={selected.type === 'role' && selected.id === entry.id ? 'active' : ''} onClick={() => setSelected({ type: 'role', id: entry.id })}><b>{entry.title}</b><small>играют: {plugins.connections.filter(connection => connection.role === entry.id).map(connection => connection.pluginName).join(', ') || 'никто'}</small></button>)}
      </nav>
      <span className="fl-fill" />
      <footer><h3>Установить по ссылке или из папки</h3><form className="pl-install" onSubmit={event => { event.preventDefault(); if (source.trim()) void inspect(source.trim()) }}><input value={source} onChange={event => setSource(event.target.value)} placeholder="github.com/…/плагин или путь к папке" aria-label="Ссылка на репозиторий или папка плагина" spellCheck={false} /><button className="ds-icon" aria-label="Посмотреть плагин" disabled={busy || !source.trim()}><Icon name="arrow" size={14} /></button></form>{error && <p className="bd-note warn" role="alert">{error}</p>}</footer>
    </aside>
    {role ? <section className="fl-detail"><header className="fl-head"><div><h1>{role.title}</h1><p>Роль — общий договор, который описывает сам Dev Space. Флоу обращается к роли, а не к сервису; какой плагин её играет, выбирают при запуске. Версия {role.version}.</p></div></header>
      <div className="fl-body pl-body">
        <section><h4>Что есть у задачи</h4><ul className="pl-ops">{role.fields.map(field => <li key={field.id}><em>поле</em><span><b>{field.title}</b> — {field.type}</span></li>)}</ul></section>
        <section><h4>Операции</h4><ul className="pl-ops">{Object.entries(role.operations).map(([name, operation]) => <li key={name}><em>{operation.kind === 'read' ? 'Чтение' : operation.kind === 'action' ? 'Действие' : 'Событие'}</em><span><b>{operation.title}</b> — {operation.note || (operation.required ? 'обязательно' : 'необязательно')}</span></li>)}</ul></section>
        <section><h4>Кто играет роль</h4>{plugins.connections.filter(connection => connection.role === role.id).map(connection => <div className="pl-player" key={connection.id}><b>{connection.title}</b><em className={connection.ready ? 'ok' : 'warn'}>{connection.ready ? 'готово' : 'не настроено'}</em><small>не начато ← {connection.statuses.todo || '—'} · в работе ← {connection.statuses.doing || '—'} · завершено ← {connection.statuses.done || '—'}</small></div>)}</section>
        <section><h4>Флоу, которым нужна эта роль</h4><p className="fl-lead">{flows.flows.filter(entry => Object.values(entry.flow?.needs || {}).some(need => need.role === role.id)).map(entry => entry.name).join(', ') || 'пока нет'}</p></section>
      </div></section>
      : !plugin ? <section className="fl-detail"><div className="ds-empty"><h2>Выберите плагин</h2><p>Плагин — пакет: в нём могут лежать виды, виды доски, подключения, блоки флоу, готовые флоу и инструкции агентам.</p></div></section>
      : <section className="fl-detail">
        <header className="fl-head">
          <div><h1>{plugin.name}</h1><p className="fl-file">{origins[selected.type === 'catalog' ? 'catalog' : selected.type === 'preview' ? inspection!.origin.type : plugin.origin]}{plugin.version && ' · версия ' + plugin.version}{plugin.author && ' · ' + plugin.author}{plugin.commit && <> · <code>{plugin.commit.slice(0, 10)}</code></>}</p></div>
          {selected.type === 'catalog' && <button type="button" className="ds-primary" disabled={busy} onClick={() => void inspect('catalog:' + plugin.id)}>Посмотреть и установить</button>}
          {selected.type === 'preview' && <><button type="button" className="ds-secondary" onClick={() => { setInspection(null); setSelected({ type: 'plugin', id: 'core' }) }}>Отмена</button><button type="button" className="ds-primary" disabled={busy} onClick={() => void install()}>{inspection!.replaces ? 'Обновить' : 'Установить'}</button></>}
          {selected.type === 'plugin' && plugin.origin === 'installed' && <button type="button" className="ds-secondary" onClick={() => void api('/plugins/uninstall', { id: plugin.id }).then(() => { notify('Плагин удалён. Зоны с его видом покажут обычный список.'); setSelected({ type: 'plugin', id: 'core' }); plugins.reload() }).catch(reason => notify((reason as Error).message))}>Удалить</button>}
        </header>
        <div className="fl-body pl-body">
          {plugin.error ? <p className="bd-note warn">{plugin.error}</p> : <>
            <p className="fl-lead">{plugin.description}</p>
            {selected.type === 'preview' && <p className="pl-origin"><Icon name="shield" size={14} />Откуда: <code>{inspection!.origin.value}</code>{inspection!.origin.commit && <> · коммит <code>{inspection!.origin.commit.slice(0, 10)}</code>. Плагин останется на этой версии, пока вы сами его не обновите.</>}</p>}
            <Rights plugin={plugin} />
            {selected.type === 'plugin' && plugins.connections.filter(connection => connection.pluginId === plugin.id).map(connection => <Connection key={connection.id} connection={connection} reload={plugins.reload} notify={notify} highlight={connection.id === focus} />)}
          </>}
        </div>
      </section>}
  </div>
}
