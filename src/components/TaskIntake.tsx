import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, desktopState, uploadCardImage, uploadFile } from '../desktop/client'
import { t } from '../i18n'
import { useSpaces, sectionLabel } from '../lib/spaces'
import { entityHash } from '../lib/route'
import type { WorkspaceEntity } from '../types'
import type { CardDocument } from '../../desktop/service/card-schema.mjs'
import '../styles/task-intake.css'

const kinds = { note: ['Quick note', 'inbox'], bug: ['Bug', 'bugs'], ux: ['UI / UX', 'ux-ui'], idea: ['Feature idea', 'wishlist'], test: ['Test run', 'test-runs'] } as const
type Kind = keyof typeof kinds
type Snapshot = { document: CardDocument; revision: string }

export default function TaskIntake({ close, initialKind }: { close: () => void; initialKind?: Kind }) {
  const { space, sectionId } = useSpaces()
  const dialog = useRef<HTMLDialogElement>(null)
  const [kind, setKind] = useState<Kind>(initialKind || (Object.keys(kinds) as Kind[]).find(k => kinds[k][1] === sectionId) || 'note')
  const [category, setCategory] = useState(initialKind ? kinds[initialKind][1] : sectionId || 'inbox')
  const [title, setTitle] = useState(''), [description, setDescription] = useState('')
  const [expected, setExpected] = useState(''), [steps, setSteps] = useState('')
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [created, setCreated] = useState<WorkspaceEntity | null>(null)
  const working = useRef(false)
  const savedUploads = useRef(new Set<number>())
  const draftId = useRef(crypto.randomUUID())
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close() }, [])
  function addFiles(incoming: File[]) {
    if (busy || created) return
    if (files.length + incoming.length > 12 || incoming.some(f => f.size > 16 * 1024 * 1024)) { setError(t('Up to 12 files, 16 MB each.')); return }
    setFiles(old => [...old, ...incoming]); setError('')
  }
  async function save() {
    if (working.current || !title.trim()) return
    working.current = true; setBusy(true); setError('')
    let entity = created
    try {
      const targetCategory = space.sections.find(s => s.id === category)?.id || space.sections[0]?.id
      if (!targetCategory) throw new Error(t('Add a tab before creating a task.'))
      if (!entity) {
        const result = await api<{ entity: WorkspaceEntity }>('/workspace/cards', { title: title.trim(), template: 'research', spaceId: space.id, category: targetCategory })
        entity = result.entity; setCreated(entity)
      }
      const route = `/workspace/cards/${encodeURIComponent(entity.id)}/0`
      const detailsId = `details-${draftId.current}`
      let snapshot = await api<Snapshot>(route)
      if (!snapshot.document.items.some(item => item.id === detailsId)) {
        const body = [description.trim(), steps.trim() && `### ${t('Steps or context')}\n${steps.trim()}`, expected.trim() && `### ${t('Desired result')}\n${expected.trim()}`].filter(Boolean).join('\n\n')
        snapshot = await api<Snapshot>(route, { revision: snapshot.revision, document: { ...snapshot.document, summary: t(kinds[kind][0]), items: [{ id: detailsId, title: t('Your description'), body, prompt: kind === 'bug' ? t('Reproduce the issue, identify the cause and propose a fix. Record evidence and missing information in this card.') : kind === 'test' ? t('Run the described checks and record pass, fail or blocked with evidence. Link failures to their bug reports.') : t('Clarify the user need, compare options and propose a solution. Preserve the original notes. Do not treat a rough idea as an approved implementation.') }] } }, 'PUT')
      }
      for (let i = 0; i < files.length; i++) {
        if (savedUploads.current.has(i)) continue
        const id = `attachment-${draftId.current}-${i}`
        // A retry reads the latest revision, including a save whose response was lost.
        snapshot = await api<Snapshot>(route)
        if (snapshot.document.items.some(item => item.id === id)) { savedUploads.current.add(i); continue }
        const file = files[i]
        let attachment
        if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
          const uploaded = await uploadCardImage(entity.id, 0, file)
          attachment = { id, title: file.name.slice(0, 200), image: uploaded.image, alt: file.name.slice(0, 500) }
        } else {
          const uploaded = await uploadFile(file, `${desktopState().repo}/workspace/${entity.folder}`)
          attachment = { id, title: uploaded.name.slice(0, 200), body: `[${t('Open attachment')}](./${encodeURIComponent(uploaded.name)})\n\n\`${uploaded.name.replace(/`/g, '')}\`` }
        }
        await api<Snapshot>(route, { revision: snapshot.revision, document: { ...snapshot.document, items: [...snapshot.document.items, attachment] } }, 'PUT')
        savedUploads.current.add(i)
      }
      window.dispatchEvent(new Event('mrmak-workspace-changed')); location.hash = entityHash(entity.id); close()
    } catch (e) { setError(`${entity ? t('The card is saved. Retry to finish adding the remaining files.') + ' ' : ''}${e instanceof Error ? e.message : String(e)}`) }
    finally { working.current = false; setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="new-card-dialog task-intake" aria-label={t('New task')} onCancel={e => { e.preventDefault(); if (!busy) close() }} onPaste={e => { const images = Array.from(e.clipboardData.files); if (images.length) { e.preventDefault(); addFiles(images) } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)) } }}>
    <form onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="new-card-heading"><div><h2>{t('Capture what needs attention')}</h2><p>{t('A screenshot and a few words are enough to start.')}</p></div><button type="button" disabled={busy} aria-label={t('Close')} onClick={close}>×</button></div>
      <fieldset disabled={busy || !!created} className="intake-fields">
        <div className="intake-kinds" role="group" aria-label={t('Task type')}>{(Object.keys(kinds) as Kind[]).map(key => <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); if (space.sections.some(s => s.id === kinds[key][1])) setCategory(kinds[key][1]) }}>{t(kinds[key][0])}</button>)}</div>
        <label>{t('Tab')}<select aria-label={t('Tab')} value={space.sections.some(s => s.id === category) ? category : space.sections[0]?.id || ''} onChange={e => setCategory(e.target.value)}>{space.sections.map(s => <option key={s.id} value={s.id}>{sectionLabel(s)}</option>)}</select></label>
        <label>{t('Short title')}<input autoFocus maxLength={200} required value={title} onChange={e => setTitle(e.target.value)} placeholder={t('What happened or what would you change?')} /></label>
        <label>{t('Description and thoughts')}<textarea rows={5} maxLength={20000} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('Describe it in your own words. Add links, questions and rough ideas.')} /></label>
        <details><summary>{t('Add context (optional)')}</summary><label>{t('Steps or context')}<textarea rows={3} maxLength={6000} value={steps} onChange={e => setSteps(e.target.value)} placeholder={t('Where, on which screen, what actions or app version?')} /></label><label>{t('Desired result')}<textarea rows={3} maxLength={6000} value={expected} onChange={e => setExpected(e.target.value)} /></label></details>
        <label className="intake-drop">{t('Screenshots and files')}<span>{t('Drop files here, paste a screenshot with Ctrl+V, or choose files.')}</span><input type="file" multiple aria-label={t('Attach files')} onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }} /></label>
        <ul className="intake-attachments">{files.map((file, i) => <li key={i}><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small><button type="button" aria-label={`${t('Remove')}: ${file.name}`} onClick={() => setFiles(old => old.filter((_, n) => n !== i))}>×</button></li>)}</ul>
      </fieldset>
      <p className="new-card-hint">{t('Saved in this space. Nothing is sent to an agent automatically.')}</p>
      {error && <p className="card-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>{created && !busy && <button type="button" onClick={() => { location.hash = entityHash(created!.id); close() }}>{t('Open saved card')}</button>}<button className="card-primary" type="submit" disabled={busy || !title.trim()}>{t(busy ? 'Saving…' : created ? 'Retry remaining files' : 'Save task')}</button></footer>
    </form>
  </dialog>, document.body)
}
