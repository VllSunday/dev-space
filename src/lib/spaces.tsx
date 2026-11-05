import { createContext, useContext } from 'react'
import type { WorkspaceSpace } from '../types'
import { t } from '../i18n'
export function sectionLabel(section: { id: string; name: string }) {
  const defaults: Record<string, string> = { overview: 'Overview', inbox: 'Inbox', bugs: 'Bugs', 'ux-ui': 'UX/UI', wishlist: 'Wishlist', 'test-runs': 'Test runs', 'agent-tasks': 'Agent tasks', decisions: 'Decisions', context: 'Project context' }
  return defaults[section.id] === section.name ? t(section.name) : section.name
}
export const SpaceContext = createContext<{ spaces: WorkspaceSpace[]; space: WorkspaceSpace; sectionId: string }>({ spaces: [], space: { id: 'default', name: 'Workspace', sections: [] }, sectionId: '' })
export const useSpaces = () => useContext(SpaceContext)
export const workflowLabels: Record<string, string> = { backlog: 'Backlog', 'in-progress': 'In progress', review: 'To verify', blocked: 'Blocked', done: 'Done' }
export const priorityLabels: Record<string, string> = { normal: 'Normal', low: 'Low', high: 'High', urgent: 'Urgent' }

export const isQaSpace = (id: string) => id === 'app-qa'

export const qaTabDescriptions: Record<string, string> = {
  inbox: 'Drop screenshots and rough thoughts here. Sort them when you are ready.',
  bugs: 'One problem per task: what happened, what you expected, and evidence.',
  'ux-ui': 'Explore screens and flows. Keep your observations, alternatives and decisions together.',
  wishlist: 'Describe the capability you want and why it would help.',
  'test-runs': 'Record the build, checks and actual results. Link failed checks to bugs.',
  decisions: 'Keep agreed decisions and the reasoning behind them.',
  context: 'Keep the app location, environment and working instructions here.',
  'agent-tasks': 'Prepare a clear scope for the agent, then keep its findings and verification in the same task.',
}
