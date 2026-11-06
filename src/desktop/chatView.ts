import type { ChatSession } from './types'

export type ChatView = 'conversation' | 'terminal'

const key = (id: string) => `mrmak.chatView.${id}`
const read = (name: string) => { try { return localStorage.getItem(name) } catch { return null } }
const temporaryViews = new Map<string, ChatView>()

// Only these CLIs write a transcript Dev Space can read as a conversation.
export const hasConversationView = (session: ChatSession) => session.agent === 'claude' || session.agent === 'codex'

export function chatView(session: ChatSession): ChatView {
  if (!hasConversationView(session)) return 'terminal'
  const saved = temporaryViews.get(session.id) || read(key(session.id))
  if (saved === 'conversation' || saved === 'terminal') return saved
  // Unconfigured chats start in the terminal. Ignore the legacy shared default:
  // changing one chat must never change another chat's view.
  return 'terminal'
}

export function saveChatView(id: string, view: ChatView) {
  try { localStorage.setItem(key(id), view); temporaryViews.delete(id) }
  catch { temporaryViews.set(id, view) }
}
