import { t, useLocale } from './i18n/index.ts'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntity } from './types'
import { useWorkspace } from './lib/workspace'
import { parseHash, entityHash, spaceHash, resolveStep, type Route } from './lib/route'
import MakLogo from './components/MakLogo'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import SpaceOverview from './components/SpaceOverview'
import SpaceTabs from './components/SpaceTabs'
import SectionTabs from './components/SectionTabs'
import { SpaceContext } from './lib/spaces'
import { spacesOf, spaceOf } from '../desktop/service/space-model.mjs'
import './styles/spaces.css'
import EntityControls from './components/EntityControls'
import ReportBoundary from './components/ReportBoundary'
import { contentUrl, desktopState } from './desktop/client'

const Compare3D = lazy(() => import('./components/Compare3D'))
const ReportViewer = lazy(() => import('./components/ReportViewer'))
const EditableCard = lazy(() => import('./components/EditableCard'))

// Freshly-touched work always burns at the top: sort by `updated` (falls back
// to `created`), regardless of status — a report Mak just edited must not sink
// under long-lived "active" entities. Status only breaks ties.
const lastTouched = (e: WorkspaceEntity) => e.updated ?? e.created
const statusRank = (e: WorkspaceEntity) => (e.status === 'active' ? 0 : 1)
const byFreshness = (a: WorkspaceEntity, b: WorkspaceEntity) =>
  lastTouched(b).localeCompare(lastTouched(a)) || statusRank(a) - statusRank(b)

export default function App() {
  const locale = useLocale()
  const { workspace, offline, lastSync, reload } = useWorkspace()
  const [route, setRoute] = useState<Route>(parseHash)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 720)
  const storageKey = `mak.space:${desktopState().repo || location.pathname}`
  const [selectedSpace, setSelectedSpace] = useState(() => localStorage.getItem(storageKey) || 'app-qa')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('mak.sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 719px)')
    const resize = () => setCollapsed(narrow.matches)
    narrow.addEventListener('change', resize)
    return () => narrow.removeEventListener('change', resize)
  }, [])

  const allEntities = workspace?.entities ?? []
  const spaces = spacesOf(workspace || { entities: [] })
  const entity = allEntities.find(e => e.id === route.id) ?? null
  const space = spaces.find(s => s.id === (entity ? spaceOf(entity) : route.spaceId || selectedSpace)) || spaces[0]
  const requestedSection = entity?.category || route.sectionId || ''
  const sectionId = space.sections.some(s => s.id === requestedSection) ? requestedSection : ''
  const entities = allEntities.filter(e => spaceOf(e) === space.id)
  useEffect(() => { if (workspace) localStorage.setItem(storageKey, space.id) }, [storageKey, space.id, workspace])

  const stepIndex = entity
    ? resolveStep(entity.steps.length, route.step, entity.defaultStep)
    : -1
  const step = entity?.steps[stepIndex]
  const reportUrl = entity && step ? contentUrl(`/workspace/${entity.folder}/${step.path}`) : null

  // Hash → state: entity links navigate natively; this also covers back/forward.
  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); if (window.innerWidth < 720) setCollapsed(true) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // "/" focuses search; "[" toggles the sidebar (handy for a clean screen recording).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return
      if (ev.key === '/') {
        ev.preventDefault()
        searchRef.current?.focus()
      } else if (ev.key === '[') {
        ev.preventDefault()
        setCollapsed(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = entity ? `Dev Space — ${entity.title}` : t("Dev Space — Workspace")
  }, [entity, locale])

  const goHome = () => {
    location.hash = spaceHash(space.id)
    setRoute({ id: null, step: -1, spaceId: space.id })
  }

  const selectSpace = (id: string) => {
    setSelectedSpace(id); setQuery(''); setShowArchived(false)
    location.hash = spaceHash(id)
    setRoute({ id: null, step: -1, spaceId: id })
  }
  const selectSection = (id: string) => {
    setSelectedSpace(space.id); location.hash = spaceHash(space.id, id)
    setRoute({ id: null, step: -1, spaceId: space.id, sectionId: id })
    if (window.innerWidth < 720) setCollapsed(true)
  }

  const selectStep = useCallback((id: string, index: number) => {
    history.replaceState(null, '', entityHash(id, index))
    setRoute({ id, step: index })
  }, [])

  if (!workspace) {
    return (
      <div className="boot">
        <MakLogo size={76} />
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const isArchived = (e: WorkspaceEntity) => e.status === 'archived'
  const matchesQuery = (e: WorkspaceEntity) =>
    !searching ||
    [e.title, e.description, e.category, e.id].some(s => s && s.toLowerCase().includes(q))

  // Search digs through everything, archive included; otherwise the
  // archive stays hidden behind the toggle.
  const visible = entities.filter(
    e => matchesQuery(e) && (searching || showArchived || !isArchived(e)),
  )
  const archivedCount = entities.filter(isArchived).length

  const pinned = visible.filter(e => e.pinned).sort(byFreshness)
  const rest = visible.filter(e => !e.pinned).sort(byFreshness)
  // Category grouping is for the short working set only. With the archive open or a
  // search running the list is long and the useful order is purely "what did I touch
  // last", so buckets are dropped and everything stays in one date-sorted run.
  const grouped = new Map<string, WorkspaceEntity[]>()
  for (const e of rest) {
    const cat = e.category || 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(e)
  }

  return (
    <SpaceContext.Provider value={{ spaces, space, sectionId }}>
    <div className="spaces-shell">
    <SpaceTabs select={selectSpace} reload={reload} />
    <EntityControls entities={entities} onChanged={reload}>
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`} data-entity={route.id}>
      <Sidebar
        onSection={selectSection}
        pinned={pinned}
        grouped={grouped}
        activeId={route.id}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(v => !v)}
        total={entities.length}
        offline={offline}
        lastSync={lastSync}
        onCollapse={() => setCollapsed(true)}
      />

      <button
        className="sidebar-reopen"
        onClick={() => setCollapsed(false)}
        title={t("Show menu — press the star ( [ )")}
        aria-label={t("Show menu")}
      >
        <MakLogo size={38} animated={route.id !== 'my-dream-game'} />
      </button>

      <main className="main">
        <Topbar
          entity={entity}
          stepIndex={stepIndex}
          onStep={selectStep}
          onHome={() => selectSection('')}
          // A compare3d step's "report" is a JSON manifest — opening it raw in a
          // tab helps nobody, so the external link is hidden for those.
          reportUrl={step?.viewer === 'compare3d' || step?.viewer === 'card' ? null : reportUrl}
        />

        <SectionTabs select={selectSection} reload={reload} />
        <div className="content" id="space-content" role="tabpanel" aria-labelledby={`space-section-${sectionId || 'home'}`}>
          <ReportBoundary key={reportUrl || 'home'} onHome={goHome}>
          {entity && reportUrl && step?.viewer === 'card' ? (
            <Suspense fallback={<div className="report-loading">{t("Opening card…")}</div>}><EditableCard key={`${entity.id}:${stepIndex}`} url={reportUrl} entityId={entity.id} step={stepIndex} documentFolder={`${entity.folder}/${step.path.slice(0, step.path.lastIndexOf('/') + 1)}`} /></Suspense>
          ) : entity && reportUrl && step?.viewer === 'compare3d' ? (
            <Suspense fallback={<div className="boot"><MakLogo size={56} animated={false} /></div>}><Compare3D
              key={reportUrl}
              manifestUrl={reportUrl}
              baseUrl={reportUrl.slice(0, reportUrl.lastIndexOf('/'))}
            /></Suspense>
          ) : entity && reportUrl ? (
            <Suspense fallback={<div className="boot"><MakLogo size={56} animated={false} /></div>}><ReportViewer key={reportUrl} url={reportUrl} title={step?.name ?? entity.title} relativePath={`workspace/${entity.folder}/${step?.path}`} /></Suspense>
          ) : (
            <SpaceOverview key={`${space.id}:${sectionId}`} entities={visible} reload={reload} archived={showArchived} />
          )}
          </ReportBoundary>
        </div>
      </main>
    </div>
    </EntityControls>
    </div>
    </SpaceContext.Provider>
  )
}
