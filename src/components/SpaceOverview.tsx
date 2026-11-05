import { useState } from 'react'
import { t } from '../i18n'
import { useSpaces, sectionLabel, workflowLabels, priorityLabels, qaTabDescriptions } from '../lib/spaces'
import { priorities, workflowOf, workflowStates } from '../../desktop/service/space-model.mjs'
import { updateWorkspaceEntity, type EntityPatch } from '../lib/workspace'
import { entityHash } from '../lib/route'
import { isDesktop } from '../desktop/client'
import { categoryLabel } from '../lib/categories'
import type { WorkspaceEntity } from '../types'
import NewCard from './NewCard'
import TaskIntake from './TaskIntake'
import { isQaSpace } from '../lib/spaces'
import AgentBrief from './AgentBrief'

export default function SpaceOverview({ entities, reload, archived }: { entities: WorkspaceEntity[]; reload: () => Promise<void>; archived: boolean }) {
  const { space, sectionId } = useSpaces()
  const [filter, setFilter] = useState('all'), [priority, setPriority] = useState('all')
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [intake, setIntake] = useState<'note' | 'bug' | 'ux' | 'idea' | 'test' | null>(null)
  const live = entities.filter(e => e.status !== 'archived' && e.purpose !== 'reference' && (!sectionId || e.category === sectionId))
  const shown = entities.filter(e => e.purpose !== 'reference' && (!sectionId || e.category === sectionId) && (filter === 'all' || workflowOf(e) === filter) && (priority === 'all' || (e.priority || 'normal') === priority))
  const notes = entities.filter(e => e.purpose === 'reference' && e.status !== 'archived' && (sectionId ? e.category === sectionId : e.category === 'context'))
  const sectionName = (category: string) => sectionLabel(space.sections.find(s => s.id === category) || { id: category, name: categoryLabel(category) })
  async function update(entity: WorkspaceEntity, patch: EntityPatch) {
    setBusy(entity.id); setError('')
    try { await updateWorkspaceEntity(entity.id, patch); await reload() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy('') }
  }
  return <section className="space-overview">
    <header className="overview-heading"><div><p>{space.name}</p><h1>{sectionId ? sectionName(sectionId) : t('Overview')}</h1></div>{isDesktop && <NewCard label="+ Add task" />}</header>
    {isQaSpace(space.id) && <p className="tab-description">{t(qaTabDescriptions[sectionId] || 'Capture observations in the tabs above. Track progress here and hand a task or a whole tab to your agent.')}</p>}
    {notes.length > 0 && <div className="tab-notes"><span>{t('Working notes')}</span>{notes.map(note => <a key={note.id} href={entityHash(note.id)}>{note.title} <span aria-hidden="true">↗</span></a>)}</div>}
    {isDesktop && isQaSpace(space.id) && <>{!sectionId && <div className="qa-shortcuts">{(['bug', 'ux', 'idea', 'note', 'test'] as const).map(kind => <button key={kind} onClick={() => setIntake(kind)}>{t({ bug: 'Bug', ux: 'UI / UX', idea: 'Feature idea', note: 'Quick note', test: 'Test run' }[kind])}</button>)}</div>}<AgentBrief sectionId={sectionId} />{intake && <TaskIntake initialKind={intake} close={() => setIntake(null)} />}</>}
    <div className="overview-counts" aria-label={t('Task summary')}>
      {['all', 'in-progress', 'review', 'blocked', 'done'].map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}><strong>{key === 'all' ? live.length : live.filter(e => workflowOf(e) === key).length}</strong><span>{t(key === 'all' ? 'All tasks' : workflowLabels[key])}</span></button>)}
    </div>
    <div className="overview-toolbar"><h2>{archived ? t('Including archive') : t('Tasks')}</h2><label>{t('Status')}<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t('All statuses')}</option>{workflowStates.map(s => <option key={s} value={s}>{t(workflowLabels[s])}</option>)}</select></label><label>{t('Priority')}<select value={priority} onChange={e => setPriority(e.target.value)}><option value="all">{t('All priorities')}</option>{priorities.map(p => <option key={p} value={p}>{t(priorityLabels[p])}</option>)}</select></label></div>
    {error && <p role="alert" className="card-error">{t(error)}</p>}
    <div className="task-list">{shown.map(entity => <div key={entity.id} className="task-row" data-card={entity.id}>
      <span className={`task-state state-${workflowOf(entity)}`} aria-hidden="true" />
      <a href={entityHash(entity.id)}><strong>{entity.title}</strong><span>{sectionName(entity.category)}{entity.status === 'archived' ? ` / ${t('Archived')}` : ''}</span></a>
      <select aria-label={`${t('Status')}: ${entity.title}`} disabled={!isDesktop || !!busy} value={workflowOf(entity)} onChange={e => void update(entity, { workflow: e.target.value as WorkspaceEntity['workflow'] })}>{workflowStates.map(s => <option key={s} value={s}>{t(workflowLabels[s])}</option>)}</select>
      <select className={`priority-${entity.priority || 'normal'}`} aria-label={`${t('Priority')}: ${entity.title}`} disabled={!isDesktop || !!busy} value={entity.priority || 'normal'} onChange={e => void update(entity, { priority: e.target.value as WorkspaceEntity['priority'] })}>{priorities.map(p => <option key={p} value={p}>{t(priorityLabels[p])}</option>)}</select>
      {isDesktop && <button className="task-archive" disabled={!!busy} aria-label={`${t(entity.status === 'archived' ? 'Restore' : 'Archive')}: ${entity.title}`} onClick={() => void update(entity, { status: entity.status === 'archived' ? 'active' : 'archived' })}>{t(entity.status === 'archived' ? 'Restore' : 'Archive')}</button>}
    </div>)}</div>
    {!shown.length && <div className="space-empty"><h2>{t('A clear place to start')}</h2><p>{t('Add a bug, an idea or a test. Keep the details and screenshots inside its card.')}</p></div>}
  </section>
}
