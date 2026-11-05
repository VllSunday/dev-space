import { t, useLocale } from '../i18n/index.ts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../desktop/client'
import { useSpaces, sectionLabel } from '../lib/spaces'
import { entityHash } from '../lib/route'
import type { WorkspaceEntity } from '../types'
import type { CardTemplate } from '../../desktop/service/card-schema.mjs'
import '../styles/editable-cards.css'
import TaskIntake from './TaskIntake'
import { isQaSpace } from '../lib/spaces'

function NewCardDialog({ onClose }: { onClose: () => void }) {
  useLocale()
  const { space, sectionId } = useSpaces()
  const [category, setCategory] = useState(sectionId || space.sections[0]?.id || '')
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(''), [template, setTemplate] = useState<CardTemplate>(space.id === 'default' ? 'gallery' : 'research')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function create() {
    if (busy || !title.trim()) return
    setBusy(true); setError('')
    try {
      const { entity } = await api<{ entity: WorkspaceEntity }>('/workspace/cards', { title, template, ...(space.sections.length ? { spaceId: space.id, category } : {}) })
      window.dispatchEvent(new Event('mrmak-workspace-changed')); location.hash = entityHash(entity.id)
      onClose()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="new-card-dialog" aria-label={t("New Workspace card")} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}><form onSubmit={event => { event.preventDefault(); void create() }}>
    <div className="new-card-heading"><div><span>{t("Create in Workspace")}</span><h2>{t("A place for your next idea.")}</h2></div><button type="button" aria-label={t("Close new card")} disabled={busy} onClick={onClose}>×</button></div>
    <label>{t("Card title")}<input autoFocus required maxLength={200} placeholder={t("Character references, tool research…")} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    {space.sections.length > 0 && <label>{t("Section")}<select value={category} onChange={e => setCategory(e.target.value)}>{space.sections.map(s => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></label>}
    <fieldset disabled={busy} className="new-card-templates"><legend>{t("Choose a starting view")}</legend>{(['gallery', 'research'] as const).map(value => <label key={value} className={template === value ? 'selected' : ''}><input type="radio" name="template" value={value} checked={template === value} onChange={() => setTemplate(value)} /><strong>{value === 'gallery' ? t("Gallery") : t("Research")}</strong><span>{value === 'gallery' ? t("Images, reference notes and saved prompts.") : t("Findings, source links and decisions.")}</span></label>)}</fieldset>
    <p className="new-card-hint">{t("Edit it yourself or ask your agent to update it. You can switch views later.")}</p>
    {error && <p className="card-error" role="alert">{t(error)}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>{t("Cancel")}</button><button type="submit" className="card-primary" disabled={busy || !title.trim()}>{busy ? t("Creating…") : t("Create card")}</button></footer>
  </form></dialog>, document.body)
}

export default function NewCard({ label = '+ New card' }: { label?: string }) {
  useLocale()
  const { space } = useSpaces()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); button.current?.focus() }
  return <><button ref={button} className="new-card-button" disabled={!space.sections.length} title={!space.sections.length ? t('Add a section in Manage space first.') : undefined} onClick={() => setOpen(true)}>{t(label)}</button>{open && (isQaSpace(space.id) ? <TaskIntake close={close} /> : <NewCardDialog onClose={close} />)}</>
}
