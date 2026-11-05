import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, isDesktop } from '../desktop/client'
import { t } from '../i18n'
import { useSpaces } from '../lib/spaces'
import type { WorkspaceSpace } from '../types'

export default function SpaceTabs({ select, reload }: { select: (id: string) => void; reload: () => Promise<void> }) {
  const { spaces, space } = useSpaces()
  const [mode, setMode] = useState<'new' | 'manage' | null>(null)
  return <><nav className="space-tabs" aria-label={t('Spaces')}>
    <span className="spaces-caption">Spaces</span>
    <div className="space-tab-list">{spaces.map(item => <button key={item.id} aria-current={space.id === item.id ? 'page' : undefined} className={space.id === item.id ? 'selected' : ''} onClick={() => select(item.id)}><span className="space-tab-mark" />{item.name}</button>)}</div>
    {isDesktop && <><button className="space-add" aria-label={t('New space')} title={t('New space')} onClick={() => setMode('new')}>+</button><button className="space-manage" onClick={() => setMode('manage')}>{t('Manage space')}</button></>}
  </nav>{mode && <SpaceManager key={`${space.id}:${mode}`} mode={mode} close={() => setMode(null)} select={select} reload={reload} />}</>
}

export function SpaceManager({ mode, close, select, reload, onSection }: { mode: 'new' | 'manage' | 'tabs'; close: () => void; select: (id: string) => void; reload: () => Promise<void>; onSection?: (id: string) => void }) {
  const { space, spaces } = useSpaces()
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(mode === 'new' ? '' : space.name)
  const [template, setTemplate] = useState('testing')
  const [newSection, setNewSection] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close() }, [])
  async function act(data: Record<string, string>) {
    setBusy(true); setError('')
    try {
      const result = await api<WorkspaceSpace>('/workspace/spaces', { spaceId: space.id, ...data })
      await reload()
      if (data.action === 'create-space') { select(result.id); close() }
      if (data.action === 'delete-space') { select(spaces.find(s => s.id !== space.id)!.id); close() }
      if (data.action === 'create-section') setNewSection('')
      if (data.action === 'delete-section') onSection?.('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return createPortal(<dialog ref={ref} className="space-dialog" onCancel={e => { e.preventDefault(); if (!busy) close() }} aria-label={t(mode === 'new' ? 'New space' : mode === 'tabs' ? 'Manage tabs' : 'Manage space')}>
    <header><h2>{t(mode === 'new' ? 'New space' : mode === 'tabs' ? 'Manage tabs' : 'Manage space')}</h2><button disabled={busy} onClick={close} aria-label={t('Close')}>×</button></header>
    {mode !== 'tabs' && <form onSubmit={e => { e.preventDefault(); void act({ action: mode === 'new' ? 'create-space' : 'rename-space', name, template }) }}>
      <label>{t('Space name')}<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      {mode === 'new' && <label>{t('Starting structure')}<select value={template} onChange={e => setTemplate(e.target.value)}><option value="testing">{t('Testing and UX')}</option><option value="blank">{t('Empty space')}</option></select></label>}
      {mode === 'new' && <p>{template === 'testing' ? t('Overview, bugs, wishlist, UX/UI, test runs and decisions.') : t('Start with one section and add your own.')}</p>}
      <button disabled={busy || !name.trim()} className="space-primary">{t(mode === 'new' ? 'Create space' : 'Save name')}</button>
    </form>}
    {mode !== 'new' && <><p>{t('Each tab keeps its own notes, screenshots and tasks. Reorder tabs with the arrows.')}</p><div className="section-manager">{space.sections.map((s, i) => <form key={s.id} onSubmit={e => { e.preventDefault(); void act({ action: 'rename-section', sectionId: s.id, name: names[s.id] ?? s.name }) }}><input aria-label={`${t('Tab name')}: ${s.name}`} value={names[s.id] ?? s.name} maxLength={80} required onChange={e => setNames({ ...names, [s.id]: e.target.value })} /><div className="section-row-actions"><button disabled={busy} aria-label={`${t('Save')}: ${s.name}`}>{t('Save')}</button><button disabled={busy || i === 0} type="button" aria-label={`${t('Move tab left')}: ${s.name}`} onClick={() => void act({ action: 'move-section', sectionId: s.id, direction: 'left' })}>←</button><button disabled={busy || i === space.sections.length - 1} type="button" aria-label={`${t('Move tab right')}: ${s.name}`} onClick={() => void act({ action: 'move-section', sectionId: s.id, direction: 'right' })}>→</button><button disabled={busy} type="button" aria-label={`${t('Delete tab')}: ${s.name}`} onClick={() => void act({ action: 'delete-section', sectionId: s.id })}>×</button></div></form>)}</div>
      <form className="section-add" onSubmit={e => { e.preventDefault(); void act({ action: 'create-section', name: newSection }) }}><input autoFocus={mode === 'tabs'} aria-label={t('New tab name')} placeholder={t('New tab name')} required maxLength={80} value={newSection} onChange={e => setNewSection(e.target.value)} /><button disabled={busy || !newSection.trim()}>{t('Add tab')}</button></form>
      <p>{t('Move all notes and tasks to another tab before deleting it. Archived items also count.')}</p>{mode === 'manage' && <button className="space-danger" disabled={busy} onClick={() => void act({ action: 'delete-space' })}>{t('Delete empty space')}</button>}</>}
    {error && <p role="alert" className="card-error">{t(error)}</p>}
  </dialog>, document.body)
}
