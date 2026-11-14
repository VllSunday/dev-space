import { useMemo, useState } from 'react'
import { api } from '../desktop/client'
import { Sheet } from '../board/BoardChrome'
import type { AgentInfo, AgentSpace, ChatSession, Settings } from '../desktop/types'
import type { Project } from '../devspace/model'
import type { PluginsState, Thing } from '../plugins/types'
import type { FlowRun, FlowsState } from './types'

export interface LaunchRequest { flowId: string; input?: { things?: string[]; text?: string; boardId?: string; zoneId?: string; sessionId?: string; itemId?: string } }
const examples: Record<string, string> = {
  'plugin-by-words': 'Покажи задачи зоны доской: слева «надо», посередине «в работе», справа «готово», а сверху — сколько готово',
  'flow-by-words': 'Один агент пишет код, второй проверяет, после двух возвратов зови меня',
}
// Launch: where the flow is deployed, which agent plays each role and which
// plugin plays each connection role. The flow file itself names none of them.
export default function LaunchDialog({ request, flows, plugins, project, spaces, activeSpaceId, sessions, agents, settings, picked, close, configure, launched }: {
  request: LaunchRequest; flows: FlowsState; plugins: PluginsState; project: Project; spaces: AgentSpace[]; activeSpaceId: string; sessions: ChatSession[]; agents: AgentInfo[]; settings: Settings; picked: Thing[]
  close: () => void; configure: (connectionId: string) => void; launched: (run: FlowRun) => void
}) {
  const entry = flows.flows.find(item => item.id === request.flowId), flow = entry?.flow
  const usable = agents.filter(agent => agent.available && agent.id !== 'shell')
  const from = flow ? String(flow.steps[flow.start]?.with.from || '') : ''
  const things = request.input?.things?.length ? request.input.things : picked.map(thing => thing.ref)
  const defaults = useMemo(() => {
    const roles: Record<string, string> = {}, order = [settings.defaultAgent, ...usable.map(agent => agent.id)].filter((id, index, list) => usable.some(agent => agent.id === id) && list.indexOf(id) === index)
    // Different agents for different roles when possible: the one who checks should not be the one who wrote.
    Object.keys(flow?.roles || {}).forEach((id, index) => { roles[id] = from === 'chat' && request.input?.sessionId ? 'session:' + request.input.sessionId : order.length ? 'agent:' + order[index % order.length] : '' })
    const needs: Record<string, string> = {}
    for (const [id, need] of Object.entries(flow?.needs || {})) { const players = plugins.connections.filter(item => item.role === need.role); needs[id] = (players.find(item => item.ready && item.pluginId !== 'tasks') || players.find(item => item.ready) || players[0])?.id || '' }
    return { roles, needs }
  }, [flow?.id])
  const [roles, setRoles] = useState(defaults.roles), [needs, setNeeds] = useState(defaults.needs)
  const [text, setText] = useState(request.input?.text || ''), [where, setWhere] = useState<'current' | 'new'>('current'), [spaceName, setSpaceName] = useState(flow?.name || '')
  const [chat, setChat] = useState(request.input?.sessionId || sessions[0]?.id || ''), [allow, setAllow] = useState(settings.allowDevspaceCommand === true)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!entry || !flow) return <Sheet title="Запуск флоу" close={close}><div className="ds-form"><p>Флоу не найден в библиотеке.</p></div></Sheet>
  const here = sessions.filter(session => (settings.agentSessionSpaces?.[session.id] || 'local') === activeSpaceId && session.agent !== 'shell')
  const missing = [
    ...(!entry.ok ? ['во флоу есть проблемы'] : []),
    ...Object.entries(flow.roles).filter(([id]) => !roles[id]).map(([, role]) => 'нет агента для роли «' + role.title + '»'),
    ...Object.keys(flow.needs).filter(id => !plugins.connections.find(item => item.id === needs[id])?.ready).map(() => 'подключение не настроено'),
    ...(from === 'words' && !text.trim() ? ['опишите задачу'] : []), ...(from === 'selection' && !things.length ? ['на доске ничего не выбрано'] : []), ...(from === 'chat' && !chat ? ['нет открытого чата'] : []),
  ]
  const usesClaude = Object.values(roles).some(value => value === 'agent:claude')
  const start = async () => {
    setBusy(true); setError('')
    try {
      if (allow !== (settings.allowDevspaceCommand === true)) await api('/settings', { allowDevspaceCommand: allow })
      const run = await api<FlowRun>('/flows/launch', {
        flowId: flow.id, projectId: project.id, needs,
        roles: Object.fromEntries(Object.entries(roles).map(([id, value]) => [id, value.startsWith('session:') ? { sessionId: value.slice(8) } : { agent: value.slice(6) }])),
        space: where === 'new' ? { name: spaceName.trim() || flow.name } : { id: activeSpaceId },
        input: { ...request.input, things, text: text.trim(), ...(from === 'chat' ? { sessionId: chat, title: sessions.find(session => session.id === chat)?.name } : {}) },
      })
      launched(run)
    } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) }
  }
  return <Sheet title={'Запуск: ' + flow.name} close={close}><form className="ds-form fl-launch" onSubmit={event => { event.preventDefault(); if (!missing.length && !busy) void start() }}>
    {flow.description && <p className="fl-lead">{flow.description}</p>}
    {!entry.ok && <ul className="fl-problems">{entry.problems.map((problem, index) => <li key={index}>{problem.step ? '«' + (flow.steps[problem.step]?.title || problem.step) + '»: ' : ''}{problem.text}</li>)}</ul>}

    {from === 'words' && <label>Что нужно<textarea autoFocus rows={4} value={text} onChange={event => setText(event.target.value)} placeholder={examples[flow.id] || 'Опишите задачу своими словами'} /></label>}
    {from === 'selection' && <><p className="fl-line"><b>С доски:</b> {things.length ? `${things.length} ${things.length === 1 ? 'карточка' : things.length < 5 ? 'карточки' : 'карточек'}` : 'ничего не выбрано — отметьте карточки на доске'}{picked.length > 0 && <span> · {picked.slice(0, 4).map(thing => thing.title).join(', ')}{picked.length > 4 ? '…' : ''}</span>}</p><label>Что учесть <small>необязательно</small><textarea rows={2} value={text} onChange={event => setText(event.target.value)} placeholder="Например: коротко, с разделом «Следующий шаг»" /></label></>}
    {from === 'tracker' && <p className="fl-line"><b>Задача:</b> следующая в трекере, которую никто не начал. Статус в трекере меняет код, а не агент.</p>}
    {from === 'chat' && <label>Чат<select value={chat} onChange={event => { setChat(event.target.value); setRoles(Object.fromEntries(Object.keys(flow.roles).map(id => [id, 'session:' + event.target.value]))) }}>{sessions.map(session => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>}

    <fieldset><legend>Кто играет роли</legend>
      {Object.entries(flow.roles).map(([id, role]) => <label key={id} className="fl-pair"><span>{role.title}</span><select value={roles[id] || ''} onChange={event => setRoles(old => ({ ...old, [id]: event.target.value }))} aria-label={'Агент для роли ' + role.title}>
        {!usable.length && !here.length && <option value="">нет установленных агентов</option>}
        {usable.length > 0 && <optgroup label="Открыть нового">{usable.map(agent => <option key={agent.id} value={'agent:' + agent.id}>{agent.label}</option>)}</optgroup>}
        {here.length > 0 && <optgroup label="Уже открыт в этом спейсе">{here.map(session => <option key={session.id} value={'session:' + session.id}>{session.name}</option>)}</optgroup>}
      </select></label>)}
      {Object.entries(flow.needs).map(([id, need]) => { const players = plugins.connections.filter(item => item.role === need.role), chosen = players.find(item => item.id === needs[id]); return <label key={id} className="fl-pair"><span>{plugins.roles.find(role => role.id === need.role)?.title || need.role}</span><select value={needs[id] || ''} onChange={event => setNeeds(old => ({ ...old, [id]: event.target.value }))} aria-label="Плагин для роли подключения">{players.map(item => <option key={item.id} value={item.id}>{item.title}{item.ready ? '' : ' — не настроено'}</option>)}</select>{chosen && !chosen.ready && <button type="button" className="ds-link" onClick={() => configure(chosen.id)}>Настроить</button>}</label> })}
    </fieldset>

    <fieldset><legend>Где развернуть</legend>
      <label className="fl-radio"><input type="radio" name="where" checked={where === 'current'} onChange={() => setWhere('current')} />В спейсе «{spaces.find(space => space.id === activeSpaceId)?.name}»</label>
      <label className="fl-radio"><input type="radio" name="where" checked={where === 'new'} onChange={() => setWhere('new')} />В новом спейсе{where === 'new' && <input value={spaceName} onChange={event => setSpaceName(event.target.value)} aria-label="Название спейса" maxLength={100} />}</label>
    </fieldset>
    {usesClaude && !settings.defaultBypass && <label className="fl-radio fl-allow"><input type="checkbox" checked={allow} onChange={event => setAllow(event.target.checked)} /><span>Не спрашивать разрешение на команду <code>devspace</code><small>Иначе Claude Code спросит разрешение, когда будет читать задание и сдавать шаг. Остальные права агента не меняются.</small></span></label>}
    {error && <p className="bd-note warn" role="alert">{error}</p>}
    <div className="ds-actions"><span className="fl-missing">{missing[0] ? 'Не хватает: ' + missing[0] : 'Шаги пойдут сами; в любой терминал можно писать руками.'}</span><button type="button" className="ds-secondary" onClick={close}>Отмена</button><button className="ds-primary" disabled={!!missing.length || busy}>{busy ? 'Запускаем…' : 'Запустить'}</button></div>
  </form></Sheet>
}
