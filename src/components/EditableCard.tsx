import { t, useLocale } from '../i18n/index.ts'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, desktopState, isDesktop, onServiceEvent, uploadCardImage, uploadFile } from '../desktop/client'
import { CARD_MAX_ITEMS, cardStatuses, validateCard, validateCardDraft, type CardDocument, type CardItem } from '../../desktop/service/card-schema.mjs'
import CardContent from './CardContent'
import { statusLabels } from '../lib/card-labels'

interface Snapshot { document: CardDocument; revision: string; warning?: string }
interface EditorState { saved: Snapshot | null; draft: CardDocument | null; latest: Snapshot | null; editing: boolean; saving: boolean; message: string; error: string }
const changed = (state: EditorState) => !!state.saved && JSON.stringify(state.draft) !== JSON.stringify(state.saved.document)
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function EditableCard({ url, entityId, step, documentFolder }: { url: string; entityId: string; step: number; documentFolder?: string }) {
  useLocale()
  const route = `/workspace/cards/${encodeURIComponent(entityId)}/${step}`
  const draftKey = `mrmak.card-draft.${entityId}.${step}`
  const [state, setState] = useState<EditorState>({ saved: null, draft: null, latest: null, editing: false, saving: false, message: '', error: '' })
  const [removed, setRemoved] = useState<{ item: CardItem; index: number } | null>(null)
  const mutation = useRef(0)
  const scroller = useRef<HTMLElement>(null)
  const dragged = useRef<string | null>(null)
  const dirty = changed(state)
  useEffect(() => { scroller.current?.scrollTo(0, 0) }, [state.editing])
  useEffect(() => {
    let current = true, loading = false
    async function load() {
      if (loading || mutation.current % 2 || document.visibilityState === 'hidden') return
      const generation = mutation.current
      loading = true
      try {
        let snapshot: Snapshot
        if (isDesktop) snapshot = await api<Snapshot>(route)
        else {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok) throw new Error(t("This card is unavailable ({0}).", response.status))
          snapshot = { document: validateCard(await response.json()), revision: '' }
        }
        validateCard(snapshot.document)
        if (!current || generation !== mutation.current) return
        setState(previous => {
          if (previous.saving || generation !== mutation.current) return previous
          if (!previous.saved) {
            let recovery: { document: CardDocument; revision: string } | null = null
            if (isDesktop) {
              try { const stored = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); if (stored?.document && typeof stored.revision === 'string') recovery = { document: validateCardDraft(stored.document), revision: stored.revision } } catch { /* A malformed recovery draft never replaces a valid source. */ }
            }
            return { ...previous, saved: recovery && recovery.revision !== snapshot.revision ? { ...snapshot, revision: recovery.revision } : snapshot, draft: recovery?.document || snapshot.document, latest: recovery && recovery.revision !== snapshot.revision ? snapshot : null, editing: !!recovery, message: recovery ? t("Recovered your unsaved draft.") : '', error: '' }
          }
          if (changed(previous)) return { ...previous, latest: snapshot.revision !== previous.saved.revision ? snapshot : null }
          return { ...previous, saved: snapshot, draft: snapshot.document, latest: null, error: '' }
        })
      } catch (error) { if (current && generation === mutation.current) setState(previous => ({ ...previous, error: errorText(error) })) }
      finally { loading = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    const refresh = () => void load()
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    const off = onServiceEvent(event => { if (event.type === 'workspace-changed') void load() })
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); off() }
  }, [route, url, draftKey])
  useEffect(() => {
    if (!isDesktop || !state.saved) return
    try { if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({ document: state.draft, revision: state.saved.revision })); else sessionStorage.removeItem(draftKey) } catch { /* Keep the live draft even if session storage is full. */ }
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, state.draft, state.saved, draftKey])
  function edit(update: (document: CardDocument) => CardDocument) {
    setState(previous => previous.draft && !previous.saving ? { ...previous, draft: update(previous.draft), message: '', error: '' } : previous)
  }
  const itemEdit = (id: string, patch: Partial<CardItem>) => edit(document => ({ ...document, items: document.items.map(item => item.id === id ? { ...item, ...patch } : item) }))
  function add() { edit(document => ({ ...document, items: [...document.items, { id: crypto.randomUUID(), title: t("Untitled entry"), body: '', status: 'idea' }] })); setState(previous => ({ ...previous, editing: true })) }
  function move(id: string, to: number) {
    edit(document => { const items = [...document.items], index = items.findIndex(item => item.id === id); if (index < 0 || to < 0 || to >= items.length) return document; items.splice(to, 0, items.splice(index, 1)[0]); return { ...document, items } })
  }
  function dragStart(event: DragEvent, id: string) {
    dragged.current = id
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }
  function dragOver(event: DragEvent) {
    // WebKit hides custom MIME data during dragover. Accept only a drag that
    // started in this editor, tracked locally; never interpret an external drop.
    if (dragged.current && !state.saving) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }
  }
  function drop(event: DragEvent, index: number) {
    const id = dragged.current
    if (id && !state.saving) { event.preventDefault(); move(id, index) }
    dragged.current = null
  }
  async function save() {
    if (!state.saved || !state.draft || state.saving || mutation.current % 2 || !dirty || state.latest) return
    try { validateCard(state.draft) } catch (error) { setState(previous => ({ ...previous, error: errorText(error) })); return }
    mutation.current++
    setState(previous => ({ ...previous, saving: true, error: '', message: '' }))
    try {
      const saved = await api<Snapshot>(route, { document: state.draft, revision: state.saved.revision }, 'PUT')
      // Clear recovery synchronously: a navigation immediately after Save must not resurrect it.
      try { sessionStorage.removeItem(draftKey) } catch { /* Storage is optional. */ }
      setState(previous => ({ ...previous, saved, draft: saved.document, latest: null, saving: false, message: saved.warning || t("Saved"), error: '' }))
      setRemoved(null); window.dispatchEvent(new Event('mrmak-workspace-changed'))
    } catch (error) {
      setState(previous => ({ ...previous, saving: false, error: errorText(error) }))
      try { const latest = await api<Snapshot>(route); setState(previous => ({ ...previous, latest: latest.revision !== previous.saved?.revision ? latest : null })) } catch { /* The draft remains available while offline. */ }
    } finally { mutation.current++ }
  }
  async function image(id: string, file: File) {
    if (state.saving || mutation.current % 2) return
    mutation.current++
    setState(previous => ({ ...previous, saving: true, error: '' }))
    try {
      const result = await uploadCardImage(entityId, step, file)
      setState(previous => ({ ...previous, saving: false, draft: previous.draft && { ...previous.draft, items: previous.draft.items.map(item => item.id === id ? { ...item, image: result.image } : item) }, message: t("Image added to your draft. Save when ready.") }))
    } catch (error) { setState(previous => ({ ...previous, saving: false, error: errorText(error) })) }
    finally { mutation.current++ }
  }
  async function attach(files: File[]) {
    if (!isDesktop || state.saving || mutation.current % 2 || !files.length || !state.draft) return
    if (files.length > 12 || files.some(f => f.size > 16 * 1024 * 1024) || state.draft.items.length + files.length > CARD_MAX_ITEMS) {
      setState(previous => ({ ...previous, error: t('Up to 12 files, 16 MB each.') })); return
    }
    mutation.current++
    setState(previous => ({ ...previous, saving: true, error: '' }))
    try {
      for (const file of files) {
        const item: CardItem = { id: crypto.randomUUID(), title: file.name.slice(0, 200) }
        if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
          item.image = (await uploadCardImage(entityId, step, file)).image
          item.alt = file.name.slice(0, 500)
        } else if (documentFolder) {
          const result = await uploadFile(file, `${desktopState().repo}/workspace/${documentFolder}`)
          item.body = `[${t('Open attachment')}](./${encodeURIComponent(result.name)})`
        } else throw new Error(t('The attachment folder is unavailable.'))
        setState(previous => ({ ...previous, draft: previous.draft && { ...previous.draft, items: [...previous.draft.items, item] }, message: t('Files added to your draft. Save when ready.') }))
      }
    } catch (e) { setState(previous => ({ ...previous, error: errorText(e) })) }
    finally { mutation.current++; setState(previous => ({ ...previous, saving: false })) }
  }
  const latest = state.latest
  if (!state.draft) return <div className="report-loading" role={state.error ? 'alert' : 'status'}>{state.error && t(state.error) || t("Opening card…")}</div>
  const card = state.draft
  return <section ref={scroller} className="editable-card" aria-label={t("Editable card: {0}", card.title)} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(Array.from(event.clipboardData.files)) } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)) } }} onKeyDown={event => { if (isDesktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }}>
    <div className="card-editor-toolbar">
      {isDesktop ? <div className="card-mode-buttons" aria-label={t("Card mode")}><button aria-pressed={!state.editing} disabled={state.saving} onClick={() => setState(previous => ({ ...previous, editing: false }))}>{t("Preview")}</button><button aria-pressed={state.editing} disabled={state.saving} onClick={() => setState(previous => ({ ...previous, editing: true }))}>{t("Edit")}</button></div> : <span className="card-readonly">{t("Open the desktop app to edit this card.")}</span>}
      <span className="card-save-status" role="status">{state.saving ? t("Saving…") : dirty ? t("Unsaved draft") : state.message || t("Up to date")}</span>
      {isDesktop && <><button disabled={!dirty || state.saving} onClick={() => { mutation.current += 2; setState(previous => ({ ...previous, saved: previous.latest || previous.saved, draft: (previous.latest || previous.saved)!.document, latest: null, message: t("Draft discarded."), error: '' })); setRemoved(null) }}>{t("Discard")}</button><button className="card-primary" disabled={!dirty || state.saving || !!latest} onClick={() => void save()}>{t("Save")}</button></>}
    </div>
    {isDesktop && <div className="card-evidence-bar"><label>{t('Attach files')}<input aria-label={t('Add more files')} type="file" multiple disabled={state.saving} onChange={e => { void attach(Array.from(e.target.files || [])); e.target.value = '' }} /></label><span>{t('Or drop files / paste a screenshot with Ctrl+V. Then save.')}</span></div>}
    {state.error && <p className="card-feedback card-error" role="alert">{t(state.error)}</p>}
    {state.message && dirty && <p className="card-feedback">{state.message}</p>}
    {latest && <div className="card-conflict" role="alert"><strong>{t("This card changed while you were editing.")}</strong><p>{t("Your draft is kept. Compare it with the latest version below before choosing which content to keep.")}</p><details><summary>{t("Review latest version")}</summary><CardContent document={latest.document} baseUrl={url} /></details><button disabled={state.saving} onClick={() => { mutation.current += 2; setState(previous => ({ ...previous, saved: latest, draft: latest.document, latest: null, message: t("Loaded the latest version."), error: '' })); setRemoved(null) }}>{t("Discard my draft and load latest")}</button><button onClick={() => { const link = document.createElement('a'), objectUrl = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' })); link.href = objectUrl; link.download = 'recovered-draft.card.json'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) }}>{t("Download my draft")}</button></div>}
    {state.editing && isDesktop ? <fieldset className="card-editor-form" disabled={state.saving}>
      <legend className="sr-only">{t("Edit card content")}</legend>
      <div className="card-document-fields"><label>{t("Page title")}<input maxLength={200} value={card.title} onChange={event => edit(document => ({ ...document, title: event.target.value }))} /></label><label>{t("View")}<select aria-label={t("View")} value={card.template} onChange={event => edit(document => ({ ...document, template: event.target.value as CardDocument['template'] }))}><option value="gallery">{t("Gallery")}</option><option value="research">{t("Research")}</option></select></label><label className="card-wide-field">{t("Introduction")} <small>{t("Markdown supported")}</small><textarea rows={3} maxLength={20000} value={card.summary || ''} onChange={event => edit(document => ({ ...document, summary: event.target.value }))} /></label></div>
      <div className="card-editor-section-heading"><h2>{t("Entries")} <span>{card.items.length}</span></h2><button onClick={add} disabled={card.items.length >= CARD_MAX_ITEMS}>{t("+ Add entry")}</button></div>
      {card.items.length > 1 && <div className="card-entry-order" aria-label={t("Entry order")}>{card.items.map((item, index) => <button key={item.id} type="button" draggable aria-label={t("Reorder {0}", item.title)} onDragStart={event => dragStart(event, item.id)} onDragEnd={() => { dragged.current = null }} onDragOver={dragOver} onDrop={event => drop(event, index)}>{index + 1}<span>{item.title}</span><span aria-hidden="true">⠿</span></button>)}</div>}
      {removed && <div className="card-undo" role="status">{t("Entry removed from this draft.")} <button onClick={() => { edit(document => { const items = [...document.items]; items.splice(Math.min(removed.index, items.length), 0, removed.item); return { ...document, items } }); setRemoved(null) }}>{t("Undo remove")}</button></div>}
      <div className="card-editor-entries">{card.items.map((item, index) => <fieldset className="card-entry-editor" key={item.id} aria-label={t("Entry {0}", index + 1)} data-entry-id={item.id} onDragOver={dragOver} onDrop={event => drop(event, index)}>
        <legend>{String(index + 1).padStart(2, '0')} · {item.title || t("Entry")}</legend>
        <div className="card-entry-actions"><button type="button" className="card-drag-handle" draggable onDragStart={event => dragStart(event, item.id)} onDragEnd={() => { dragged.current = null }} aria-label={t("Drag {0} to reorder", item.title)}>⠿ <span>{t("Drag to reorder")}</span></button><button type="button" disabled={index === 0} onClick={() => move(item.id, index - 1)} aria-label={t("Move {0} up", item.title)}>↑</button><button type="button" disabled={index === card.items.length - 1} onClick={() => move(item.id, index + 1)} aria-label={t("Move {0} down", item.title)}>↓</button><button type="button" className="card-remove" onClick={() => { setRemoved({ item, index }); edit(document => ({ ...document, items: document.items.filter(entry => entry.id !== item.id) })) }}>{t("Remove")}</button></div>
        <div className="card-entry-fields"><label>{t("Entry title")}<input maxLength={200} value={item.title} onChange={event => itemEdit(item.id, { title: event.target.value })} /></label><label>{t("Status")}<select aria-label={t("Status")} value={item.status || ''} onChange={event => itemEdit(item.id, { status: event.target.value ? event.target.value as CardItem['status'] : undefined })}><option value="">{t("No status")}</option>{cardStatuses.map(status => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select></label><label className="card-wide-field">{t("Notes")} <small>{t("Markdown supported")}</small><textarea rows={4} maxLength={40000} value={item.body || ''} onChange={event => itemEdit(item.id, { body: event.target.value })} /></label><label>{t("Source URL")}<input type="url" placeholder="https://" maxLength={2000} value={item.url || ''} onChange={event => itemEdit(item.id, { url: event.target.value })} /></label><label>{t("Link label")}<input placeholder={t("Source")} maxLength={120} value={item.linkLabel || ''} onChange={event => itemEdit(item.id, { linkLabel: event.target.value })} /></label></div>
        <details className="card-entry-extras" open={!!item.image || card.template === 'gallery'}><summary>{t("Image and prompt")}</summary>{item.image && <div className="card-edit-image"><img src={new URL(item.image, new URL(url, location.href)).href} alt={item.alt || item.title} /><button onClick={() => itemEdit(item.id, { image: '', alt: '' })}>{t("Remove image")}</button></div>}<label className="card-upload">{item.image ? t("Replace image") : t("Add image")}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) void image(item.id, file); event.target.value = '' }} /></label><label>{t("Image description")}<input maxLength={500} value={item.alt || ''} onChange={event => itemEdit(item.id, { alt: event.target.value })} /></label><label>{t("Prompt")}<textarea rows={4} maxLength={40000} value={item.prompt || ''} onChange={event => itemEdit(item.id, { prompt: event.target.value })} /></label></details>
      </fieldset>)}</div>
      {!card.items.length && <div className="card-empty"><p>{t("Add a reference, an idea or a research finding.")}</p><button className="card-primary" onClick={add}>{t("Add first entry")}</button></div>}
    </fieldset> : <><CardContent document={card} baseUrl={url} />{isDesktop && !card.items.length && <div className="card-empty-action"><button className="card-primary" onClick={add}>{t("Add first entry")}</button></div>}</>}
  </section>
}
