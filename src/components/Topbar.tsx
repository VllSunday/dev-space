import { t, useLocale } from '../i18n/index.ts'
import type { WorkspaceEntity } from '../types'
import { isDesktop } from '../desktop/client'
import BrowserSettings from './BrowserSettings'
import { EntityStatusButton } from './EntityControls'
import NewCard from './NewCard'
import AgentBrief from './AgentBrief'
import { useSpaces } from '../lib/spaces'

interface TopbarProps {
  entity: WorkspaceEntity | null
  stepIndex: number
  onStep: (id: string, index: number) => void
  onHome: () => void
  reportUrl: string | null
}

export default function Topbar({ entity, stepIndex, onStep, onHome, reportUrl }: TopbarProps) {
  useLocale()
  const { space } = useSpaces()
  return (
    <div className="topbar">
      <nav className="breadcrumb" aria-label={t("Breadcrumb")}>
        <button className="crumb-link" onClick={onHome}> {space.name} </button>
        {entity && (
          <>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{entity.title}</span>
            <EntityStatusButton entity={entity} />
          </>
        )}
        {!isDesktop && <BrowserSettings />}
        {isDesktop && <NewCard />}
      </nav>

      {entity && (
        <div className="topbar-right">
          {isDesktop && space.id === 'app-qa' && <AgentBrief entity={entity} />}
          {entity.steps.length > 1 && (
            <div className="step-tabs" role="tablist">
              {entity.steps.map((s, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === stepIndex}
                  className={`step-tab${i === stepIndex ? ' active' : ''}`}
                  onClick={() => onStep(entity.id, i)}
                  title={s.name}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {reportUrl && (
            <a
              className="open-ext"
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              title={t("Open report in a new tab")}
            >
              ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
