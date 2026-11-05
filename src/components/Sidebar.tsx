import { intlLocale, t, useLocale, countLabel } from '../i18n/index.ts'
import type { RefObject } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { categoryIcon, categoryLabel } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import MakLogo from './MakLogo'
import { useSpaces, sectionLabel } from '../lib/spaces'
import { EntityStatusButton } from './EntityControls'

interface SidebarProps {
  onSection: (id: string) => void
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  activeId: string | null
  query: string
  onQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
  total: number
  offline: boolean
  lastSync: Date | null
  onCollapse: () => void
}

function Item({ entity, active }: { entity: WorkspaceEntity; active: boolean }) {
  useLocale()
  return (
    <div className="sidebar-item-row" data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`sidebar-item${active ? ' active' : ''}${entity.pinned ? ' pinned' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="item-icon" aria-hidden="true">
        {entity.icon ? <img src={contentUrl(`/workspace/${entity.folder}/${entity.icon}`)} width="24" height="24" alt="" decoding="async" /> : categoryIcon(entity.category)}
      </span>
      <span className="item-text">{entity.title}</span>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}

export default function Sidebar({
  onSection,
  pinned,
  grouped,
  activeId,
  query,
  onQuery,
  searchRef,
  archivedCount,
  showArchived,
  onToggleArchived,
  total,
  offline,
  lastSync,
  onCollapse,
}: SidebarProps) {
  useLocale()
  const { space, sectionId } = useSpaces()
  const sections = [...space.sections.map(s => ({ ...s, name: sectionLabel(s) })), ...[...grouped.keys()].filter(id => !space.sections.some(s => s.id === id)).map(id => ({ id, name: categoryLabel(id) }))]
  const empty = pinned.length === 0 && grouped.size === 0

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <MakLogo size={30} animated={activeId !== 'my-dream-game'} />
        <div className="brand-text">
          <strong>{space.name}</strong>
          <span className="brand-sub">{t("Personal space")}</span>
        </div>
        <button
          className="sidebar-collapse"
          onClick={onCollapse}
          title={t("Hide menu ( [ )")}
          aria-label={t("Hide menu")}
        >
          ‹
        </button>
      </div>

      <div className="sidebar-search">
        <span className="search-icon" aria-hidden="true">
          {'⌕'}
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={ev => onQuery(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') {
              onQuery('')
              ev.currentTarget.blur()
            }
          }}
          placeholder={t("Search…  ( / )")}
          aria-label={t("Search entities")}
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label={t("Clear search")}>
            ×
          </button>
        )}
      </div>

      <nav className="sidebar-list">
        <button className={`sidebar-overview${!activeId && !sectionId ? ' selected' : ''}`} onClick={() => onSection('')}>{t("Overview")}</button>
        {pinned.length > 0 && (
          <div>
            <div className="sidebar-section">
              <span className="sidebar-label">{'\u{1F4CC}'} {t("pinned")}</span>
            </div>
            {pinned.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        )}

        {sections.map(({ id: cat, name }) => { const list = grouped.get(cat) || []; return (
          <div key={cat}>
            <button className={`sidebar-section section-link${sectionId === cat && !activeId ? ' selected' : ''}`} onClick={() => onSection(cat)}><span className="sidebar-label">{name}</span><span className="sidebar-count">{list.length}</span></button>
            {list.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        )})}

        {empty && <div className="sidebar-empty">{t("Nothing matches, sir.")}</div>}

        {archivedCount > 0 && !query && (
          <button className="sidebar-archive-toggle" onClick={onToggleArchived}>
            {showArchived
              ? t("▼ Hide archive ({0})", archivedCount)
              : t("▶ Show archive ({0})", archivedCount)}
          </button>
        )}
      </nav>

      <footer className="sidebar-foot">
        <span className={`sync-dot${offline ? ' offline' : ''}`} />
        <span>
          {countLabel(total, 'card')} ·{' '}
          {offline
            ? t("offline")
            : lastSync
              ? t("synced {0}", lastSync.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }))
              : t("syncing…")}
        </span>
      </footer>
    </aside>
  )
}
