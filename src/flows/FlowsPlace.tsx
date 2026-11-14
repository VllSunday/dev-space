import { useEffect, useMemo, useState } from 'react'
import { api } from '../desktop/client'
import { Icon } from '../desktop/Icons'
import type { PluginsState } from '../plugins/types'
import type { BlockInfo, BlockParam, Flow, FlowEntry, FlowProblem, FlowsState, FlowStep } from './types'
import { runStatus, terminalNames } from './types'
import type { LaunchRequest } from './LaunchDialog'
import './flows.css'

// The flow library. A flow is one file; blocks, text and words are three ways
// to edit that same file. Code checks it after every change.
const blockIcon: Record<string, string> = { input: 'workspace', work: 'terminal', review: 'check', ask: 'help', person: 'person', parallel: 'skills', facts: 'shield', action: 'mcp' }
const serialize = (flow: Flow) => JSON.stringify({
  flow: 1, id: flow.id, name: flow.name, ...(flow.description ? { description: flow.description } : {}), roles: flow.roles, ...(Object.keys(flow.needs).length ? { needs: flow.needs } : {}), limits: flow.limits, start: flow.start,
  steps: Object.fromEntries(Object.entries(flow.steps).map(([id, step]) => [id, { ...(step.title ? { title: step.title } : {}), block: step.block, ...(Object.keys(step.with).length ? { with: step.with } : {}), next: step.next, ...(Object.keys(step.limit).length ? { limit: step.limit } : {}) }])),
}, null, 2)
// The place is rebuilt when you switch away and back; it reopens where you left it.
let lastFlow = ''
const plural = (count: number, one: string, few: string, many: string) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? few : many}`

function ParamField({ name, param, value, flow, block, change, roleTitles }: { name: string; param: BlockParam; value: unknown; flow: Flow; block: BlockInfo; change: (value: unknown) => void; roleTitles: Record<string, string> }) {
  const label = param.title || name, labels = block.labels[name] || {}
  const options = param.type === 'role' ? Object.entries(flow.roles).map(([id, role]) => [id, role.title]) : param.type === 'need' ? Object.entries(flow.needs).map(([id, need]) => [id, roleTitles[need.role] || id]) : param.type === 'step' ? Object.entries(flow.steps).map(([id, step]) => [id, step.title || id]) : param.type === 'enum' ? (param.values || []).map(item => [item, labels[item] || item]) : null
  return <label className="fl-row"><span>{label}{param.required && <i aria-hidden="true">*</i>}</span>
    {options ? <select value={String(value ?? '')} onChange={event => change(event.target.value || undefined)} aria-label={label}>{(!param.required || value === undefined) && <option value="">—</option>}{options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
      : param.type === 'number' ? <input type="number" min={param.min} max={param.max} value={value === undefined ? '' : Number(value)} onChange={event => change(event.target.value === '' ? undefined : Number(event.target.value))} aria-label={label} />
      : <textarea rows={Math.min(6, Math.max(1, Math.ceil(String(value ?? '').length / 70)))} value={String(value ?? '')} onChange={event => change(event.target.value || undefined)} aria-label={label} />}
  </label>
}

function StepCard({ id, step, flow, blocks, problems, change, remove, roleTitles, order }: { id: string; step: FlowStep; flow: Flow; blocks: BlockInfo[]; problems: FlowProblem[]; change: (step: FlowStep) => void; remove?: () => void; roleTitles: Record<string, string>; order: string[] }) {
  const [more, setMore] = useState(false)
  const block = blocks.find(item => item.id === step.block)
  const targets = [...Object.entries(flow.steps).map(([other, item]) => [other, item.title || blocks.find(entry => entry.id === item.block)?.title || other]), ...Object.entries(terminalNames)]
  if (!block) return <article className="fl-step missing"><header><b>{step.title || id}</b><small>блок «{step.block}» не найден</small></header></article>
  return <article className={'fl-step' + (problems.length ? ' bad' : '')} data-step={id}>
    <header><span className="fl-step-icon"><Icon name={blockIcon[block.base || block.id] || 'mcp'} size={15} /></span><b>{step.title || block.title}</b><small>{block.summary}</small>{block.plugin && <em>{block.plugin}</em>}<span className="fl-fill" />{flow.start === id && <em>начало</em>}{Object.entries(block.params).some(([name, param]) => step.with[name] === undefined && !param.required) && <button type="button" className="fl-more" aria-expanded={more} onClick={() => setMore(value => !value)}>{more ? 'скрыть пустые' : 'ещё параметры'}</button>}{remove && <button type="button" className="ds-icon" aria-label={'Удалить шаг ' + (step.title || block.title)} title="Удалить шаг" onClick={remove}><Icon name="trash" size={13} /></button>}</header>
    {Object.entries(block.params).map(([name, param]) => (step.with[name] !== undefined || param.required || more) && <ParamField key={name} roleTitles={roleTitles} name={name} param={param} value={step.with[name]} flow={flow} block={block} change={value => { const next = { ...step.with }; if (value === undefined) delete next[name]; else next[name] = value; change({ ...step, with: next }) }} />)}
    {block.outputs.map(output => <div className="fl-row fl-out" key={output.id}><span>{output.title}</span>
      <select value={step.next[output.id] || ''} onChange={event => change({ ...step, next: { ...step.next, [output.id]: event.target.value } })} aria-label={'Куда ведёт выход ' + output.title}>{!step.next[output.id] && <option value="">— выберите —</option>}{targets.map(([target, title]) => <option key={target} value={target}>{target.startsWith('@') ? '◦ ' : '→ '}{title}</option>)}</select>
      {flow.steps[step.next[output.id]] && (step.limit[output.id] !== undefined || order.indexOf(step.next[output.id]) <= order.indexOf(id)) && <label className="fl-limit" title="Сколько раз можно пройти этим переходом. Нужен, если переход возвращает назад.">не больше<input type="number" min={0} max={50} placeholder="—" value={step.limit[output.id] ?? ''} onChange={event => { const next = { ...step.limit }; if (event.target.value === '') delete next[output.id]; else next[output.id] = Number(event.target.value); change({ ...step, limit: next }) }} aria-label={'Предел возвратов для выхода ' + output.title} />раз</label>}
    </div>)}
    {problems.map((problem, index) => <p className="fl-problem" key={index} role="alert">{problem.text}</p>)}
  </article>
}

export default function FlowsPlace({ flows, plugins, focus, launch, notify }: { flows: FlowsState & { reload: () => Promise<unknown> }; plugins: PluginsState; focus: string; launch: (flowId: string, input?: LaunchRequest['input']) => void; notify: (text: string) => void }) {
  const [selectedId, setSelectedId] = useState(focus || lastFlow), [mode, setMode] = useState<'blocks' | 'text'>('blocks'), [pane, setPane] = useState<'flow' | 'reference'>('flow')
  const entry: FlowEntry | undefined = flows.flows.find(item => item.id === selectedId) || flows.flows[0]
  const [text, setText] = useState(''), [checked, setChecked] = useState<{ ok: boolean; problems: FlowProblem[]; flow: Flow | null; order: string[] } | null>(null)
  const [words, setWords] = useState(''), [adding, setAdding] = useState(''), [busy, setBusy] = useState(false), [naming, setNaming] = useState<string | null>(null)
  useEffect(() => { if (focus) { setSelectedId(focus); setPane('flow') } }, [focus])
  useEffect(() => { if (selectedId) lastFlow = selectedId }, [selectedId])
  useEffect(() => { setText(entry?.text || ''); setChecked(null) }, [entry?.id, entry?.text])
  const dirty = !!entry && text !== entry.text
  // Every edit is checked by the service: the same code that guards a launch.
  useEffect(() => { if (!dirty) { setChecked(null); return } const timer = setTimeout(() => void api<NonNullable<typeof checked>>('/flows/validate', { text }).then(setChecked).catch(() => {}), 250); return () => clearTimeout(timer) }, [text, dirty])
  const current = dirty ? checked : entry ? { ok: entry.ok, problems: entry.problems, flow: entry.flow, order: entry.order } : null
  const flow = current?.flow || entry?.flow || null, problems = current?.problems || []
  const edit = (change: (draft: Flow) => void) => { if (!flow) return; const draft = structuredClone(flow); change(draft); setText(serialize(draft)) }
  const save = async () => { if (!entry) return; setBusy(true); try { await api('/flows', { id: entry.id, text }, 'PUT'); notify('Флоу сохранён'); await flows.reload() } catch (error) { notify((error as Error).message) } finally { setBusy(false) } }
  const create = async (name: string) => {
    const id = 'flow-' + Date.now().toString(36)
    const fresh: Flow = { flow: 1, id, name, description: '', roles: { author: { title: 'Исполнитель' } }, needs: {}, limits: { handoffs: 6 }, start: 'take', steps: { take: { block: 'input', with: { from: 'words' }, next: { taken: 'work', empty: '@stopped' }, limit: {} }, work: { block: 'work', with: { role: 'author' }, next: { done: 'me', blocked: '@person' }, limit: {} }, me: { block: 'person', with: {}, next: { accept: '@done', return: 'work' }, limit: { return: 3 } } } }
    try { await api('/flows', { id, text: serialize(fresh) }, 'PUT'); await flows.reload(); setSelectedId(id); setPane('flow'); setNaming(null) } catch (error) { notify((error as Error).message) }
  }
  const addStep = (blockId: string) => edit(draft => { const block = flows.blocks.find(item => item.id === blockId)!; let id = blockId.split('/').pop()!, n = 2; while (draft.steps[id]) id = blockId.split('/').pop()! + '-' + n++; draft.steps[id] = { block: blockId, with: {}, next: Object.fromEntries(block.outputs.map(output => [output.id, '@person'])), limit: {} } })
  const stepProblems = (id: string) => problems.filter(problem => problem.step === id)
  const runs = useMemo(() => flows.runs.filter(run => !run.parentId).slice(0, 8), [flows.runs])

  return <div className="ds-place fl-place">
    <aside className="fl-library" aria-label="Библиотека флоу">
      <header><h2>Флоу</h2><button type="button" className="ds-secondary" onClick={() => setNaming('')}><Icon name="plus" size={13} />Новый</button></header>
      {naming !== null && <form className="fl-new" onSubmit={event => { event.preventDefault(); if (naming.trim()) void create(naming.trim()) }}><input autoFocus value={naming} onChange={event => setNaming(event.target.value)} placeholder="Название флоу" aria-label="Название нового флоу" onKeyDown={event => { if (event.key === 'Escape') setNaming(null) }} /></form>}
      <nav>{flows.flows.map(item => <button type="button" key={item.id} className={pane === 'flow' && entry?.id === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setPane('flow') }}>
        <b>{item.name}</b><small>{item.flow ? plural(Object.keys(item.flow.roles).length, 'агент', 'агента', 'агентов') + ' · ' + plural(Object.keys(item.flow.steps).length, 'шаг', 'шага', 'шагов') : 'не читается'}{item.origin === 'plugin' ? ' · из плагина ' + item.plugin : item.origin === 'user' ? item.changed ? ' · изменён' : ' · свой' : ''}{!item.ok && ' · есть проблемы'}</small>
      </button>)}</nav>
      {flows.drafts.length > 0 && <section><h3>Черновики от агента</h3>{flows.drafts.map(item => <div className="fl-draft" key={item.id}><b>{item.name}</b><small>{item.ok ? 'проверен' : item.problems[0]?.text || 'есть проблемы'}</small><span><button type="button" className="ds-primary" disabled={!item.ok} onClick={() => void api('/flows/drafts', { id: item.id, action: 'accept' }).then(() => { notify('Флоу сохранён в библиотеку'); setSelectedId(item.id); return flows.reload() }).catch(error => notify((error as Error).message))}>Принять</button><button type="button" className="ds-secondary" onClick={() => void api('/flows/drafts', { id: item.id, action: 'discard' }).then(() => flows.reload()).catch(() => {})}>Отклонить</button></span></div>)}</section>}
      {runs.length > 0 && <section><h3>Запуски</h3>{runs.map(run => <button type="button" key={run.id} className="fl-run" onClick={() => { setSelectedId(run.flowId); setPane('flow') }} title={run.reason || undefined}><b>{run.name}</b><small>{run.item?.title ? run.item.title + ' · ' : ''}{run.steps.find(step => step.state === 'current')?.title || ''}</small><em className={run.status}>{runStatus[run.status]}</em></button>)}</section>}
      <span className="fl-fill" />
      <footer><h3>Под капотом</h3><button type="button" className={pane === 'reference' ? 'active' : ''} onClick={() => setPane('reference')}><Icon name="book" size={14} /><span><b>Справочник для агентов</b><small>{plural(flows.blocks.length, 'блок', 'блока', 'блоков')} · {plural(flows.commands.length, 'команда', 'команды', 'команд')}</small></span></button></footer>
    </aside>

    {pane === 'reference' ? <section className="fl-detail"><header className="fl-head"><div><h1>Справочник для агентов</h1><p>Его получает каждый агент, которого открывает Dev Space: команда <code>devspace help</code> в терминале. Плагины добавляют сюда свои операции, блоки и инструкции сами.</p></div></header><pre className="fl-reference">{flows.reference}</pre></section>
      : !entry || !flow ? <section className="fl-detail"><div className="ds-empty"><h2>{entry ? 'Файл флоу не читается' : 'Флоу пока нет'}</h2><p>{entry ? entry.problems[0]?.text : 'Создайте первый флоу или опишите процесс словами.'}</p>{entry && <textarea className="fl-text" value={text} onChange={event => setText(event.target.value)} spellCheck={false} aria-label="Текст флоу" />}{entry && dirty && <button className="ds-primary" onClick={() => void save()}>Сохранить</button>}</div></section>
      : <section className="fl-detail">
        <header className="fl-head">
          <div><h1>{flow.name}</h1><p className="fl-file"><code>{entry.id}.flow.json</code>{entry.origin === 'plugin' && ' · из плагина ' + entry.plugin}{entry.origin === 'builtin' && ' · встроенный'}{entry.changed && ' · изменён вами'}</p></div>
          <div className="fl-toggle" role="tablist" aria-label="Как показывать флоу"><button type="button" role="tab" aria-selected={mode === 'blocks'} onClick={() => setMode('blocks')}>Блоки</button><button type="button" role="tab" aria-selected={mode === 'text'} onClick={() => setMode('text')}>Текст</button></div>
          {dirty ? <><button type="button" className="ds-secondary" onClick={() => setText(entry.text)}>Отменить правки</button><button type="button" className="ds-primary" disabled={busy} onClick={() => void save()}>Сохранить</button></>
            : <button type="button" className="ds-primary fl-launch-button" disabled={!entry.ok} title={entry.ok ? undefined : 'Сначала исправьте проблемы'} onClick={() => launch(entry.id)}><Icon name="play" size={12} />Запустить</button>}
        </header>
        <div className="fl-meta">
          <span className={'fl-check ' + (problems.length ? 'bad' : 'ok')}><Icon name={problems.length ? 'bell' : 'check'} size={12} />{problems.length ? plural(problems.length, 'проблема', 'проблемы', 'проблем') + ' — флоу не запустится' : 'проверен: все пути заканчиваются, кругов без предела нет'}</span>
          {Object.values(flow.roles).map(role => <span className="fl-chip" key={role.title}><Icon name="terminal" size={11} />{role.title}</span>)}
          {Object.values(flow.needs).map(need => <span className="fl-chip plug" key={need.role}><Icon name="mcp" size={11} />{plugins.roles.find(role => role.id === need.role)?.title || need.role}</span>)}
          <span className="fl-chip">передач не больше {flow.limits.handoffs ?? '—'}</span>
          {entry.changed && <button type="button" className="ds-link" onClick={() => void api('/flows', { id: entry.id }, 'DELETE').then(() => flows.reload()).then(() => notify('Возвращён исходный флоу')).catch(() => {})}>Вернуть исходный</button>}
          {entry.origin === 'user' && !entry.changed && <button type="button" className="ds-link" onClick={() => void api('/flows', { id: entry.id }, 'DELETE').then(() => flows.reload()).then(() => notify('Флоу удалён')).catch(() => {})}>Удалить флоу</button>}
        </div>
        {flow.description && <p className="fl-lead">{flow.description}</p>}
        {problems.filter(problem => !problem.step).map((problem, index) => <p className="fl-problem" key={index} role="alert">{problem.text}</p>)}
        <div className="fl-body">
          {mode === 'text' ? <textarea className="fl-text" value={text} onChange={event => setText(event.target.value)} spellCheck={false} aria-label="Текст флоу" />
            : <div className="fl-chain">
              {(current?.order.length ? current.order : Object.keys(flow.steps)).map(id => flow.steps[id] && <StepCard key={id} order={current?.order.length ? current.order : Object.keys(flow.steps)} roleTitles={Object.fromEntries(plugins.roles.map(role => [role.id, role.title]))} id={id} step={flow.steps[id]} flow={flow} blocks={flows.blocks} problems={stepProblems(id)} change={step => edit(draft => { draft.steps[id] = step })} remove={flow.start === id ? undefined : () => edit(draft => { delete draft.steps[id] })} />)}
              <div className="fl-add"><select value={adding} onChange={event => { if (event.target.value) addStep(event.target.value); setAdding('') }} aria-label="Добавить шаг"><option value="">＋ Добавить шаг…</option>{flows.blocks.map(block => <option key={block.id} value={block.id}>{block.title} — {block.summary}{block.plugin ? ' · ' + block.plugin : ''}</option>)}</select></div>
            </div>}
        </div>
        <form className="fl-words" onSubmit={event => { event.preventDefault(); if (!words.trim()) return; launch('flow-by-words', { text: `${words.trim()}\n\nЭто правка флоу «${flow.name}». Сохрани его ID «${flow.id}». Текущий файл:\n${text}` }); setWords('') }}>
          <Icon name="mic" size={15} /><input value={words} onChange={event => setWords(event.target.value)} placeholder="Скажите или напишите агенту, что изменить в этом флоу…" aria-label="Изменить флоу словами" /><button className="ds-icon" aria-label="Отдать агенту" disabled={!words.trim()}><Icon name="send" size={14} /></button>
        </form>
      </section>}
  </div>
}
