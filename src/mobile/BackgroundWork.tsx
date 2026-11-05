import { t, useLocale, countLabel } from '../i18n/index.ts'
import './backgroundWork.css'

export interface WorkingAgent { id: string; name: string; type: string; step: string; startedAt: string; updatedAt: string }
export interface BackgroundCommand { id: string; name: string; title: string; startedAt: string; agent?: string }

function elapsed(from: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000))
  if (seconds < 60) return t("{0} s", seconds)
  if (seconds < 3600) return t("{0} min", Math.floor(seconds / 60))
  return t("{0} h {1} min", Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60))
}


// Subagents and background commands the chat started that are still working. Shown
// above the composer, since they keep going while the chat itself is idle.
export default function BackgroundWork({ agents = [], commands = [], now }: { agents?: WorkingAgent[]; commands?: BackgroundCommand[]; now: number }) {
  useLocale()
  if (!agents.length && !commands.length) return null
  const title = [agents.length && countLabel(agents.length, 'agent'), commands.length && countLabel(commands.length, 'command')].filter(Boolean).join(t(' and '))
  return <details className="background-work">
    <summary><i aria-hidden="true" /><strong>{t('In progress: {0}', title)}</strong><span>{[...agents.map(agent => agent.name), ...commands.map(command => command.title)].join(' · ')}</span></summary>
    <ul>
      {agents.map(agent => <li key={agent.id}>
        <strong>{agent.name}</strong>
        <span>{agent.step}</span>
        <small>{[agent.type, t('running {0}', elapsed(agent.startedAt, now))].filter(Boolean).join(' · ')}</small>
      </li>)}
      {commands.map(command => <li key={command.id} className="command">
        <strong>{command.title}</strong>
        <span>{command.agent ? t("{0} · started by {1}", command.name, command.agent) : command.name}</span>
        <small>{t("running {0}", elapsed(command.startedAt, now))}</small>
      </li>)}
    </ul>
  </details>
}
