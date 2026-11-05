import { useRef, useState } from 'react'
import { isDesktop } from '../desktop/client'
import { t } from '../i18n'
import { sectionLabel, useSpaces } from '../lib/spaces'
import { SpaceManager } from './SpaceTabs'

export default function SectionTabs({ select, reload }: { select: (id: string) => void; reload: () => Promise<void> }) {
  const { space, sectionId } = useSpaces()
  const [manage, setManage] = useState(false)
  const tabs = useRef<HTMLDivElement>(null)
  const manageButton = useRef<HTMLButtonElement>(null)
  const items = [{ id: '', name: t('Overview') }, ...space.sections.map(s => ({ ...s, name: sectionLabel(s) }))]
  return <div className="section-tabs-bar">
    <div ref={tabs} className="section-tabs" role="tablist" aria-label={t('Space tabs')} onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      const buttons = Array.from(tabs.current!.querySelectorAll<HTMLButtonElement>('[role=tab]'))
      const index = buttons.indexOf(e.target as HTMLButtonElement)
      if (index < 0) return
      e.preventDefault()
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
      select(items[next].id); buttons[next].focus()
    }}>
      {items.map(item => <button key={item.id} id={`space-section-${item.id || 'home'}`} role="tab" aria-selected={sectionId === item.id} aria-controls="space-content" tabIndex={sectionId === item.id ? 0 : -1} onClick={() => select(item.id)}>{item.name}</button>)}
    </div>
    {isDesktop && <button ref={manageButton} className="section-tabs-manage" onClick={() => setManage(true)} aria-label={t('Manage tabs')} title={t('Add, rename and reorder tabs')}>+ <span>{t('Tabs')}</span></button>}
    {manage && <SpaceManager mode="tabs" close={() => { setManage(false); manageButton.current?.focus() }} select={() => {}} onSection={select} reload={reload} />}
  </div>
}
