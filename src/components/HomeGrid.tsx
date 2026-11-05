import { t, useLocale, countLabel } from '../i18n/index.ts'
import type { WorkspaceEntity } from '../types'
import { categoryIcon, categoryLabel } from '../lib/categories'
import MakCard from './MakCard'
import MakLogo from './MakLogo'

interface HomeGridProps {
  entities: WorkspaceEntity[]
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  offline: boolean
  searching: boolean
  query: string
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return t("Burning the midnight oil, sir?")
  if (h < 12) return t("Good morning, sir.")
  if (h < 18) return t("Good day, sir.")
  return t("Good evening, sir.")
}

export default function HomeGrid({
  entities,
  pinned,
  grouped,
  offline,
  searching,
  query,
}: HomeGridProps) {
  useLocale()
  const activeCount = entities.filter(e => e.status === 'active').length
  const categoryCount = new Set(entities.map(e => e.category || 'other')).size
  const shown = pinned.length + [...grouped.values()].reduce((n, list) => n + list.length, 0)

  return (
    <div className="home">
      <header className="home-hero">
        <MakLogo size={84} />
        <div>
          <h1 className="home-title">{greeting()}</h1>
          <p className="home-sub">
            {t('Active: {0}', activeCount)} · {countLabel(entities.length, 'card')} · {countLabel(categoryCount, 'category')} {offline && <span className="home-offline"> {t("· workspace.json unreachable")}</span>}
          </p>
        </div>
      </header>

      {searching && (
        <p className="home-filter">
          {t('Matches for “{0}”: {1} · includes archived cards', query.trim(), shown)} </p>
      )}

      {pinned.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <span className="section-title">{'\u{1F4CC}'} {t("pinned")}</span>
            <span className="section-count">{pinned.length}</span>
          </div>
          <div className="card-grid">
            {pinned.map(e => (
              <MakCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      )}

      {[...grouped.entries()].map(([cat, list]) => (
        <section key={cat} className="home-section">
          <div className="section-head">
            <span className="section-title">
              {categoryIcon(cat)} {categoryLabel(cat)}
            </span>
            <span className="section-count">{list.length}</span>
          </div>
          <div className="card-grid">
            {list.map(e => (
              <MakCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      ))}

      {shown === 0 && !searching && (
        <div className="home-empty">
          {offline
            ? t("Could not load workspace.json — is the public/workspace link in place? Run npm run dev again, sir.")
            : t("Nothing here yet. New work will appear as cards, sir.")}
        </div>
      )}
    </div>
  )
}
