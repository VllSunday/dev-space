import { t, useLocale, getLocale } from '../i18n/index.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import { api, desktopState, reportError, setPreview, uploadFile, useDesktop, windowAction } from './client'
import type { FileEntry, Folder, Preview } from './types'
import { Icon } from './Icons'
import MarkdownDocument from '../components/MarkdownDocument'
import WorkspaceSettings from './WorkspaceSettings'
import McpPanel from './McpPanel'
import { ZoomImage } from '../components/ImagePreview'
import ReportFrame, { REPORT_SANDBOX } from '../components/ReportFrame'
import { fileManager, isMac, trashName } from './platform'

export function FilePreview({ file }: { file: Preview }) {
  useLocale()
  // A format the webview cannot play (ProRes, HEIC before Safari 17, odd codecs) falls back to the desktop-app card.
  const [failed, setFailed] = useState('')
  const kind = file.url && failed === file.url ? 'unsupported' : file.kind
  const reason = kind === file.kind ? file.reason : t("Open this file in its desktop application.")
  const fail = () => setFailed(file.url || '')
  return <div className="file-preview"><header><span><Icon name="files" size={16} /><strong title={file.name}>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024)).toLocaleString()} {t("KB")}</small></span><div><button className="desk-icon" onClick={() => api('/reveal', { path: file.path }).catch(reportError)} title={t("Show in {0}", t(fileManager))}><Icon name="external" size={17} /></button><button className="desk-icon" onClick={() => setPreview(null)} title={t("Back to Workspace")} aria-label={t("Close file preview")}><Icon name="close" size={18} /></button></div></header><div className={`file-preview-body ${kind}`}>
    {file.kind === 'text' && (/\.md$/i.test(file.name) ? <MarkdownDocument key={`${file.path}:${file.revision}`} file={file} /> : <pre>{file.text}</pre>)}
    {file.kind === 'document' && file.url && <ReportFrame url={file.url} title={file.name} sandbox={REPORT_SANDBOX} />}
    {kind === 'image' && <ZoomImage src={file.url} alt={file.name} onError={fail} />}
    {kind === 'video' && <video src={file.url} controls onError={fail} />}
    {kind === 'audio' && <audio src={file.url} controls onError={fail} />}
    {kind === 'unsupported' && <div className="file-unsupported"><Icon name="files" size={38} /><h2>{file.name}</h2><p>{reason}</p><button className="desk-secondary" onClick={() => api('/reveal', { path: file.path }).catch(reportError)}>{t("Show in")} {t(fileManager)}</button></div>}
  </div></div>
}

// A backslash is a legal file-name character on macOS, not a separator.
const separator = isMac ? /\// : /[\\/]/
const pathKey = (path: string) => (isMac ? path : path.replace(/\\/g, '/')).replace(/\/$/, '').toLowerCase()
const fileName = (path: string) => path.replace(isMac ? /\/$/ : /[\\/]$/, '').split(separator).pop() || path
const parentPath = (path: string) => path.replace(isMac ? /\/[^/]+$/ : /[\\/][^\\/]+$/, '')
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function RevealFolder({ path, name }: { path: string; name: string }) {
  useLocale()
  return <button className="file-reveal" title={t("Show {0} in {1}", name, t(fileManager))} aria-label={t("Show {0} in {1}", name, t(fileManager))} onClick={event => { event.stopPropagation(); api('/reveal', { path }).catch(reportError) }}><Icon name="external" size={14} /></button>
}
type SkillProvider='claude'|'codex'|'knowledge'|'processes'
interface SkillLocation {id:string;provider:SkillProvider;scope:'personal'|'project';label:string;path:string;exists:boolean}

type TreeControls = {
  expanded: Set<string>; selected: string; dropTarget: string; query: string; revision: number
  toggle: (path: string) => void
  preview: (entry: FileEntry) => void
  drag: (event: DragEvent, path: string, directory: boolean) => void
  dropProps: (path: string) => {
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
}

function FolderBranch({ path, mode = 'all', depth = 1, ancestors = [], tree, onLoad }: {
  path: string; mode?: 'main' | 'all'; depth?: number; ancestors?: string[]; tree: TreeControls; onLoad?: (folder: Folder) => void
}) {
  useLocale()
  const [folder, setFolder] = useState<Folder | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    api<Folder>(`/files?path=${encodeURIComponent(path)}&mode=${mode}`).then(value => {
      if (!abort.signal.aborted) { setFolder(value); setError(''); onLoad?.(value) }
    }).catch(error => { if (!abort.signal.aborted) setError(message(error)) })
    return () => abort.abort()
  }, [path, mode, tree.revision, onLoad])
  if (error) return <p className="file-tree-note desk-error-inline">{t(error)}</p>
  if (!folder) return <p className="file-tree-note">{t("Loading folder…")}</p>
  if (ancestors.includes(pathKey(folder.path))) return <p className="file-tree-note">{t("Linked folder already shown above.")}</p>
  if (depth > 20) return <button className="file-tree-note" onClick={() => api('/reveal', { path }).catch(reportError)}>{t("Open this deep folder in")} {t(fileManager)}</button>
  const entries = folder.entries.filter(entry => entry.directory || entry.name.normalize('NFC').toLowerCase().includes(tree.query.normalize('NFC').toLowerCase()))
  return <div role="group" {...tree.dropProps(folder.path)}>{entries.map(entry => {
    const expanded = tree.expanded.has(pathKey(entry.path))
    return <div role="none" key={entry.path}>
      <div role="none" className={`file-entry ${entry.directory ? 'has-reveal' : ''}`} {...(entry.directory ? tree.dropProps(entry.path) : {})}>
      <button role="treeitem" data-path={entry.path} aria-level={depth + 1} aria-expanded={entry.directory ? expanded : undefined} aria-selected={pathKey(tree.selected) === pathKey(entry.path)}
        className={`file-row ${entry.directory ? 'directory' : ''} ${pathKey(tree.selected) === pathKey(entry.path) ? 'selected' : ''} ${tree.dropTarget === pathKey(entry.path) ? 'drop-target' : ''}`}
        style={{ paddingLeft: 8 + Math.min(depth, 10) * 14 }} title={entry.path}
        onClick={() => entry.directory ? tree.toggle(entry.path) : tree.preview(entry)}
        draggable onDragStart={event => tree.drag(event, entry.path, entry.directory)}
        {...tree.dropProps(entry.directory ? entry.path : folder.path)}>
        <Icon name="arrow" size={11} style={{ visibility: entry.directory ? 'visible' : 'hidden', transform: expanded ? 'rotate(90deg)' : undefined }} />
        <Icon name={entry.directory ? 'folder' : 'files'} size={15} /><span>{entry.name}</span>
        {!entry.directory && <small>{entry.size < 1024 * 1024 ? `${Math.max(1, Math.round(entry.size / 1024))}k` : `${(entry.size / (1024 * 1024)).toFixed(1)}m`}</small>}
      </button>
      {entry.directory && <RevealFolder path={entry.path} name={entry.name} />}
      </div>
      {entry.directory && expanded && <FolderBranch path={entry.path} depth={depth + 1} ancestors={[...ancestors, pathKey(folder.path)]} tree={tree} />}
    </div>
  })}{!entries.length && <p className="file-tree-note" style={{ paddingLeft: 22 + depth * 14 }}>{tree.query ? t("No matching files.") : t("Empty folder · drop files here")}</p>}
    {folder.truncated && <p className="file-tree-note">{t("First 1,500 entries shown. Open")} {t(fileManager)} {t("for the complete folder.")}</p>}
  </div>
}

function treeKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
  const current = rows.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0) return
  event.preventDefault()
  const row = rows[current], expanded = row.getAttribute('aria-expanded')
  if (event.key === 'ArrowRight' && expanded === 'false') return row.click()
  if (event.key === 'ArrowLeft' && expanded === 'true' && current > 0) return row.click()
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : current + (event.key === 'ArrowUp' ? -1 : 1)
  if (event.key === 'ArrowLeft') {
    next = current - 1
    while (next > 0 && Number(rows[next].getAttribute('aria-level')) >= Number(row.getAttribute('aria-level'))) next--
  }
  rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus()
}

export default function FilesRail({ embedded = false, onClose, projectId }: { embedded?: boolean; onClose?: () => void; projectId?: string } = {}) {
  useLocale()
  const { repo } = useDesktop()
  const storageKey = `mrmak.files.${pathKey(repo)}`
  const [open, setOpen] = useState(() => embedded || localStorage.getItem(`${storageKey}.open`) === 'true')
  const [panel, setPanel] = useState<'files' | 'skills' | 'mcp' | 'settings'>('files')
  const [skillFolders,setSkillFolders]=useState<SkillLocation[]>([]),[skillProvider,setSkillProvider]=useState<SkillProvider>('claude'),[skillScope,setSkillScope]=useState<'personal'|'project'>('personal')
  const [skillsKey,setSkillsKey]=useState(''),[skillsError,setSkillsError]=useState(''),skillChoice=useRef('')
  const [root, setRoot] = useState(repo)
  const [typedPath, setTypedPath] = useState(repo)
  const [rootFolder, setRootFolder] = useState<Folder | null>(null)
  const [mode, setMode] = useState<'main' | 'all'>('main')
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(`${storageKey}.expanded`) || '[]'); return new Set(Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : []) } catch { return new Set() }
  })
  const [selected, setSelected] = useState(repo)
  const [destination, setDestination] = useState(repo)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [revision, setRevision] = useState(0)
  const [dropTarget, setDropTarget] = useState('')
  const [copying, setCopying] = useState(false)
  const copyLock = useRef(false)
  const internalDrag = useRef<{ path: string; directory: boolean; handled: boolean } | null>(null)
  const recycleLock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const loaded = useCallback((folder: Folder) => setRootFolder(folder), [])
  useEffect(() => { localStorage.setItem(`${storageKey}.open`, String(open)) }, [storageKey, open])
  useEffect(() => { localStorage.setItem(`${storageKey}.expanded`, JSON.stringify([...expanded].slice(-300))) }, [storageKey, expanded])
  useEffect(() => {
    if (!open) return
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 10000)
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer) }
  }, [open, refresh])
  useEffect(() => {
    const complete = (event: Event) => {
      const result = (event as CustomEvent<{ dropped: boolean; error?: string }>).detail
      if (result.error) setError(result.error)
      const gesture = internalDrag.current
      window.setTimeout(() => {
        if (internalDrag.current !== gesture) return
        if (!gesture?.handled) setStatus(result.dropped ? t("Path handed to the destination.") : '')
        internalDrag.current = null
      }, 150)
    }
    const recycled = (event: Event) => {
      const result = (event as CustomEvent<{ path: string; recycled: boolean; error?: string }>).detail
      recycleLock.current = false
      if (result.error) { setError(result.error); setStatus(''); return }
      setStatus(t("{0} moved to {1}.", fileName(result.path), t(trashName)))
      const preview = desktopState().preview
      if (preview && (pathKey(preview.path) === pathKey(result.path) || pathKey(preview.path).startsWith(pathKey(result.path) + '/'))) setPreview(null)
      const parent = parentPath(result.path)
      setSelected(parent); setDestination(parent); refresh()
    }
    window.addEventListener('mrmak-native-drag-result', complete)
    window.addEventListener('mrmak-recycle-result', recycled)
    return () => { window.removeEventListener('mrmak-native-drag-result', complete); window.removeEventListener('mrmak-recycle-result', recycled) }
  }, [refresh])
  const navigate = useCallback((path: string) => { setRoot(path); setTypedPath(path); setSelected(path); setDestination(path); setRootFolder(folder=>folder&&pathKey(folder.path)===pathKey(path)?folder:null); setQuery(''); setError('') },[])
  const showPanel = (next: 'files' | 'skills' | 'mcp' | 'settings') => {
    if (!embedded && open && panel === next) { setOpen(false); return }
    if (next === 'skills') { setSkillsError(''); setMode('all'); if(panel!=='skills')skillChoice.current='' }
    if (next === 'files' && panel !== 'files') { setMode('main'); navigate(repo) }
    setPanel(next); setOpen(true)
  }
  const chooseSkills=(provider:SkillProvider,scope:SkillLocation['scope']=skillScope)=>{
    const effectiveScope=['knowledge','processes'].includes(provider)?'project':scope
    setSkillProvider(provider);setSkillScope(effectiveScope);setSkillsError('');setMode('all')
    const choices=skillFolders.filter(item=>item.provider===provider&&item.scope===effectiveScope),choice=choices.find(item=>item.exists)||choices[0]
    if(choice){skillChoice.current=(projectId||repo)+':'+provider+':'+effectiveScope;navigate(choice.path)}
  }
  useEffect(()=>{
    if(panel!=='skills')return
    let alive=true;const requestKey=(projectId||repo)+':'+skillProvider+':'+skillScope
    void api<SkillLocation[]>('/skill-locations'+(projectId?'?projectId='+encodeURIComponent(projectId):'')).then(folders=>{
      if(!alive)return
      setSkillFolders(folders);setSkillsKey(requestKey);setSkillsError('')
      const key=(projectId||repo)+':'+skillProvider+':'+skillScope,choices=folders.filter(item=>item.provider===skillProvider&&item.scope===skillScope),choice=choices.find(item=>item.exists)||choices[0]
      if(choice&&skillChoice.current!==key){skillChoice.current=key;navigate(choice.path)}
    }).catch(error=>{if(alive){setSkillsError(message(error));setSkillsKey(requestKey)}})
    return()=>{alive=false}
  },[panel,skillProvider,skillScope,revision,repo,projectId,navigate])
  const skillChoices=skillFolders.filter(item=>item.provider===skillProvider&&item.scope===skillScope)
  const selectedSkill=panel==='skills'?skillFolders.find(item=>pathKey(item.path)===pathKey(root)):undefined
  const skillMissing=!!selectedSkill&&!selectedSkill.exists
  const skillLoading=panel==='skills'&&skillsKey!==(projectId||repo)+':'+skillProvider+':'+skillScope
  const collapse = () => { if (embedded) onClose?.(); else setOpen(false) }
  const toggle = (path: string) => {
    setSelected(path); setDestination(path)
    setExpanded(current => { const next = new Set(current), key = pathKey(path); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  const copy = useCallback(async (files: File[], folder: string) => {
    if (copyLock.current || !files.length) return
    if (files.length > 100) { setError(t("Copy up to 100 files at a time.")); return }
    if (files.some(file => file.size > 1024 * 1024 * 1024)) { setError(t("Choose files of 1 GB or less.")); return }
    copyLock.current = true; setCopying(true); setError(''); setDropTarget('')
    let count = 0, renamed = 0
    try {
      for (const file of files) {
        setStatus(t("Copying {0} of {1} to {2}…", count + 1, files.length, fileName(folder)))
        const result = await uploadFile(file, folder)
        count++; if (result.renamed) renamed++
      }
      setStatus(t("Copied {0} {1} to {2}.{3}", count, count === 1 ? 'file' : 'files', fileName(folder), renamed ? t(" Existing files kept; copies renamed.") : ''))
    } catch (error) { setError(message(error)); setStatus(count ? t("Copied {0} of {1} files before the error.", count, files.length) : '') }
    finally {
      copyLock.current = false; setCopying(false); setSelected(folder); setDestination(folder)
      setExpanded(current => new Set([...current, pathKey(folder)])); refresh()
    }
  }, [refresh])
  const dropFiles = useCallback(async (event: DragEvent, folder: string) => {
    event.preventDefault(); event.stopPropagation(); setDropTarget('')
    const gesture = internalDrag.current
    if (gesture) {
      gesture.handled = true
      if (gesture.directory) { setStatus(''); setError(t("Drop folders into Chats to insert their paths. Use {0} to move folders.", t(fileManager))); return }
      if (copyLock.current) return
      copyLock.current = true; setCopying(true); setError('')
      try {
        const result = await api<{ path: string; moved: boolean }>('/files/move', { path: gesture.path, folder })
        setStatus(result.moved ? t("Moved {0} to {1}.", fileName(result.path), fileName(folder)) : '')
        if (result.moved) { setSelected(result.path); setDestination(folder); setExpanded(current => new Set([...current, pathKey(folder)])) }
      } catch (error) { setError(message(error)); setStatus('') }
      finally { copyLock.current = false; setCopying(false); refresh() }
      return
    }
    if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { setError(t("Drop individual files into a folder. Folder transfers are available in {0}.", t(fileManager))); return }
    await copy(Array.from(event.dataTransfer.files), folder)
  }, [copy, refresh])
  const deleteKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Mac keyboards have no forward Delete key; accept Finder's ⌘⌫ as well.
    if (event.key !== 'Delete' && !(isMac && event.metaKey && event.key === 'Backspace')) { treeKeys(event); return }
    event.preventDefault(); event.stopPropagation()
    const path = (event.target as HTMLElement).closest('[role="treeitem"]')?.getAttribute('data-path')
    if (event.repeat || !path || recycleLock.current || copyLock.current) return
    recycleLock.current = true; setError(''); setStatus(t("Moving {0} to {1}…", fileName(path), t(trashName)))
    api('/files/recycle', { path }).catch(error => { recycleLock.current = false; setError(message(error)); setStatus('') })
  }
  const dropProps = (folder: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = copyLock.current ? 'none' : 'copy'; setDropTarget(pathKey(folder))
    },
    onDragLeave: (event: DragEvent) => {
      event.stopPropagation()
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget('')
    },
    onDrop: (event: DragEvent) => {
      // eslint-disable-next-line react-hooks/refs -- This returned event handler runs on a user drop, never during render.
      void dropFiles(event, folder)
    },
  })
  const tree: TreeControls = {
    expanded, selected, dropTarget, query, revision, toggle, dropProps,
    preview: entry => { setSelected(entry.path); setDestination(parentPath(entry.path)); api<Preview>(`/preview?path=${encodeURIComponent(entry.path)}`).then(setPreview).catch(reportError) },
    drag: (event, path, directory) => {
      // Hand the held mouse gesture to the OS (Windows OLE / macOS drag session) with real file paths.
      event.preventDefault(); internalDrag.current = { path, directory, handled: false }; setError(''); setStatus(directory ? t("Drop into Chats to insert this folder path. Esc cancels.") : t("Drop into Chats to insert a path, or into another folder to move. Esc cancels."))
      api('/files/drag', { paths: [path] }).catch(error => { internalDrag.current = null; setError(message(error)); setStatus('') })
    },
  }
  return <aside className={`files-container ${open ? 'expanded' : ''} ${embedded ? 'tools-embedded' : ''}`} aria-label={embedded ? 'Файлы, навыки и MCP' : undefined} onKeyDown={event => { if (embedded && event.code === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); collapse() } }}>
    {embedded && <><header className="tools-heading"><strong>Инструменты</strong><span className="ds-fill"/><button className="ds-icon" title="Дополнительные настройки" aria-label="Дополнительные настройки" onClick={() => showPanel('settings')}><Icon name="settings" size={15}/></button><button className="ds-icon" aria-label="Закрыть инструменты" onClick={collapse}><Icon name="close" size={16}/></button></header><nav className="tools-tabs" role="tablist" aria-label="Раздел инструментов">{(['files','skills','mcp'] as const).map(name => <button key={name} role="tab" aria-selected={panel === name} tabIndex={panel === name ? 0 : -1} onClick={() => showPanel(name)} onKeyDown={event => { if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') { event.preventDefault(); const names=['files','skills','mcp'] as const; const next=(names.indexOf(name)+(event.code==='ArrowRight'?1:2))%3; showPanel(names[next]); (event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus() } }}><Icon name={name==='files'?'folder':name} size={15}/>{name==='files'?'Файлы':name==='skills'?'Навыки':'MCP'}</button>)}</nav></>}

    {open && panel === 'settings' && <WorkspaceSettings onClose={collapse} />}
    {open && panel === 'mcp' && <McpPanel onClose={collapse} />}
    {open && (panel === 'files' || panel === 'skills') && <div className="files-panel"><header><h2>{panel === 'skills' ? t("Skills") : t("Files")}</h2><div>
      <button className="desk-icon" disabled={copying||panel==='skills'&&(skillMissing||skillLoading)} onClick={() => input.current?.click()} title={t("Copy files into {0}", fileName(destination))} aria-label={t("Add files")}><Icon name="plus" size={16} /></button>
      <button className="desk-icon" onClick={refresh} title={t("Refresh files")}><Icon name="refresh" size={15} /></button><button className="desk-icon" onClick={collapse} title={t("Collapse files")}><Icon name="close" size={17} /></button>
    </div></header>
      <input ref={input} type="file" multiple hidden onChange={event => { void copy(Array.from(event.target.files || []), destination); event.target.value = '' }} />
      {panel === 'files' ? <><div className="file-mode"><button className={mode === 'main' ? 'selected' : ''} onClick={() => { setMode('main'); navigate(repo) }}>{t("Main folders")}</button><button className={mode === 'all' ? 'selected' : ''} onClick={() => setMode('all')}>{t("All files")}</button></div>
      <div className="file-shortcuts">{['inbox', 'projects', 'workspace', 'knowledge', 'processes'].map(name => <button key={name} {...dropProps(`${repo}/${name}`)} className={dropTarget === pathKey(`${repo}/${name}`) ? 'drop-target' : ''} onClick={() => { navigate(repo); const path = `${repo}/${name}`; setExpanded(current => new Set([...current, pathKey(path)])); setSelected(path); setDestination(path) }}><Icon name="folder" size={14} />{name}</button>)}</div></> : <div className="skill-locations">
        <div className="skill-provider-tabs">{([['Claude','claude'],['Codex','codex'],[t("Knowledge"),'knowledge'],[t("Processes"),'processes']] as const).map(([label,provider])=><button key={provider} aria-pressed={skillProvider===provider} onClick={()=>chooseSkills(provider)}>{label}</button>)}</div>
        {['claude','codex'].includes(skillProvider)&&<div className="skill-scope-tabs" role="group" aria-label="Область навыков">{(['personal','project'] as const).map(scope=><button key={scope} aria-pressed={skillScope===scope} onClick={()=>chooseSkills(skillProvider,scope)}>{scope==='personal'?'Личные':'Проект'}</button>)}</div>}
        {skillChoices.length>1&&<label className="skill-folder-choice">Папка<select aria-label="Папка навыков" value={selectedSkill?.id||''} onChange={event=>{const choice=skillFolders.find(item=>item.id===event.target.value);if(choice)navigate(choice.path)}}><option value="" disabled>Выберите папку</option>{skillChoices.map(item=><option key={item.id} value={item.id}>{item.label}{item.exists?'':' · не создана'}</option>)}</select></label>}
        <p>{skillProvider==='knowledge'||skillProvider==='processes'?'Материалы рабочей области.':skillScope==='personal'?'Навыки пользователя. Откройте SKILL.md для просмотра или редактирования.':'Навыки проекта. Откройте SKILL.md для просмотра или редактирования.'}</p>
      </div>}
      <form className="file-path" onSubmit={event => { event.preventDefault(); setMode('all'); navigate(typedPath) }}><button type="button" title={t("Parent folder")} onClick={() => { setMode('all'); navigate(rootFolder?.parent || repo) }}><Icon name="up" size={15} /></button><input value={typedPath} onChange={event => setTypedPath(event.target.value)} spellCheck={false} aria-label={t("Folder path")} /><button type="submit" title={t("Open folder")}><Icon name="arrow" size={14} /></button></form>
      <div className="file-filter"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Filter file names…")} aria-label={t("Filter file names in expanded folders")} /></div>
      <div className={`file-list ${dropTarget === pathKey(destination) ? 'drop-area' : ''}`} role="tree" aria-label={t("Folder tree")} onKeyDown={deleteKey} {...(skillMissing||skillLoading?{}:dropProps(destination))}>
        {panel==='skills'&&(skillsError||skillLoading)?<p className="file-tree-note" role="status">{skillsError||'Загружаем папки навыков…'}</p>:skillMissing?<div className="skill-folder-empty" role="status"><Icon name="skills" size={26}/><strong>Папка пока не создана</strong><p>В этом расположении ещё нет навыков. Выберите другую папку или добавьте сюда папку навыка с файлом SKILL.md через проводник.</p><code>{root}</code><button onClick={refresh}>Проверить снова</button></div>:<>
        <div role="none" className="file-entry has-reveal" {...dropProps(root)}><button role="treeitem" aria-level={1} aria-expanded="true" aria-selected={pathKey(selected) === pathKey(root)} className={`file-row file-root-row ${dropTarget === pathKey(root) ? 'drop-target' : ''}`} onClick={() => { setSelected(root); setDestination(root) }} {...dropProps(root)} title={root}><Icon name="arrow" size={11} style={{ transform: 'rotate(90deg)' }} /><Icon name="folder" size={15} /><span>{pathKey(root) === pathKey(repo) ? 'Dev Space' : fileName(root)}</span></button><RevealFolder path={root} name={pathKey(root) === pathKey(repo) ? 'Dev Space' : fileName(root)} /></div>
        <FolderBranch key={`${root}:${mode}`} path={root} mode={mode} tree={tree} onLoad={loaded} />
        </>}

      </div>
      <div className="file-transfer-status" aria-live="polite">{error && <p className="desk-error-inline">{t(error)}</p>}{status && <p>{status}</p>}<small title={destination}>{skillMissing?'Выберите существующую папку для добавления файлов':skillLoading?'Загрузка папок…':copying ? t("Transferring files…") : t("Drag to move · {0} to {1}", isMac ? '⌘⌫' : 'Delete', t(trashName))}</small></div>
      <footer><button onClick={() => navigate(repo)}>{t("Dev Space root")}</button></footer>
    </div>}
    {!embedded&&<div className="files-rail">{(['files', 'skills', 'mcp', 'settings'] as const).map(name => <button key={name} className={`rail-tool ${open && panel === name ? 'active' : ''}`} onClick={() => showPanel(name)} title={name === 'mcp' ? 'MCP' : t(name[0].toUpperCase() + name.slice(1))} aria-label={t(`Toggle ${name}`)} aria-pressed={open && panel === name}><Icon name={name === 'files' ? 'folder' : name} size={18} /><span>{name === 'mcp' ? 'MCP' : t(name[0].toUpperCase() + name.slice(1))}</span></button>)}<button className="rail-tool" title={t("Workspace help")} aria-label={t("Open Workspace help")} onClick={() => api<Preview>(`/preview?path=workspace%2F_shared%2Fhelp${getLocale() === 'ru' ? '.ru' : ''}.md`).then(setPreview).catch(reportError)}><Icon name="help" size={18} /><span>{t("Help")}</span></button><div className="rail-spacer" /><button className="desk-icon" title={t("Show Chats")} onClick={() => windowAction('chats')}><Icon name="chats" size={18} /></button></div>}
  </aside>
}
