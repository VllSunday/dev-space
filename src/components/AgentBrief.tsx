import { useState } from 'react'
import { t } from '../i18n'
import { desktopState } from '../desktop/client'
import type { WorkspaceEntity } from '../types'

export default function AgentBrief({ entity, sectionId }: { entity?: WorkspaceEntity | null; sectionId?: string }) {
  const [message, setMessage] = useState('')
  const [fallback, setFallback] = useState('')
  async function copy() {
    const repo = desktopState().repo
    const text = entity
      ? `Read ${repo}/processes/project-qa.md. Review card "${entity.title}" (${entity.id}) in ${repo}/workspace/workspace.json. Read its files in ${repo}/workspace/${entity.folder}, including attached screenshots and notes. Preserve the original user text. Separate confirmed facts, hypotheses and missing information. Record your analysis and proposed next steps in the same card. Rough UX ideas are for discussion, not automatic implementation. Ask for the application repository if it is not set in projects/app-qa/README.md.`
      : `Read ${repo}/processes/project-qa.md and ${repo}/projects/app-qa/README.md. Inspect active cards in space app-qa${sectionId ? `, category ${JSON.stringify(sectionId)} only` : ''} in ${repo}/workspace/workspace.json. Read reference notes (purpose: reference) for context, then work on tasks ordered by priority. Read their screenshots, attachments and original notes. Classify and analyze them, identify missing context and propose next steps in the same cards. Preserve original notes and put your findings in a separate Agent analysis entry. Do not mark fixes verified without recording the actual checks. Ask for the application repository when needed; do not assume it is Dev Space.`
    try { await navigator.clipboard.writeText(text); setMessage(t('Copied. Paste into your agent chat.')); setFallback('') }
    catch { setFallback(text); setMessage(t('Select and copy the brief below.')) }
  }
  return <div className="agent-brief"><button type="button" onClick={() => void copy()}>{t(entity ? 'Copy agent brief' : sectionId ? 'Copy tab brief' : 'Copy triage brief')}</button>{message && <span role="status">{message}</span>}{fallback && <textarea aria-label={t('Agent brief')} readOnly value={fallback} onFocus={e => e.target.select()} />}</div>
}
