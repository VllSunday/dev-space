import { intlLocale, t, useLocale, countLabel } from '../i18n/index.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, reportError, selectChat, sendEvent, useDesktop, windowAction, onServiceEvent } from './client'
import type { AgentId, ChatSession } from './types'
import { AgentLogo, Icon, Nose } from './Icons'
import TerminalPane from './TerminalPane'
import BrowserSettings from '../components/BrowserSettings'
import SessionLogo from './SessionLogo'
import { chatActivityLabel } from './chatActivity'
import ChatTabs, { type PaneTabActions } from './ChatTabs'
import { terminalFontStack } from './display'
import { groupCounts, groupNames, orderedChats, projectKey, projectName, tabColors } from './chatOrder'
import HandoffOffer from './HandoffOffer'
import MobileAccess from './MobileAccess'
import DictationComposer from './DictationComposer'
import ProjectPicker from './ProjectPicker'
import Conversation from './Conversation'
import { modelLabel, useChatModel } from './chatModel'
import { chatView, hasConversationView, saveChatView, type ChatView } from './chatView'
import { isMac, isWindows, modKey, modLabel, shortcutLabel } from './platform'

function GroupPicker({ value, groups, onChange }: { value: string | null; groups: string[]; onChange: (group: string | null) => void }) {
  useLocale()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const options = value && !groups.includes(value) ? [value, ...groups] : groups
  const commit = () => { const name = draft.trim(); if (!name) return; onChange(name); setCreating(false); setDraft('') }
  return <div className="group-picker">
    <select aria-label={t("Group")} value={creating ? '__new' : value || ''} onChange={event => { if (event.target.value === '__new') { setCreating(true); setDraft('') } else { setCreating(false); onChange(event.target.value || null) } }}>
      <option value="">{t("No group")}</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
      <option value="__new">{t("New group…")}</option>
    </select>
    {creating && <div className="group-new"><input autoFocus placeholder={t("Group name")} aria-label={t("New group name")} value={draft} maxLength={60} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit() } if (event.key === 'Escape') { event.stopPropagation(); setCreating(false) } }} /><button type="button" onClick={commit} disabled={!draft.trim()}>{t("Add")}</button></div>}
  </div>
}

export function NewChat({ close, initialCwd, projectId }: { close: () => void; initialCwd?: string; projectId?: string }) {
  useLocale()
  const state = useDesktop()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close() }, [])
  const [agent, setAgent] = useState<AgentId>(state.settings.defaultAgent)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(initialCwd || state.repo)
  const [bypass, setBypass] = useState(state.settings.defaultBypass)
  const [resumeId, setResumeId] = useState('')
  const [group, setGroup] = useState<string | null>(() => state.sessions.find(item => item.id === state.selectedId)?.group || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function launch(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const session = await api<ChatSession>('/sessions', { agent, projectId, name: name.trim() || undefined, cwd, bypass, resumeId: resumeId.trim() || undefined, group: group || undefined })
      await api('/settings', { defaultAgent: agent, defaultBypass: bypass })
      selectChat(session.id); close()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false) }
  }
  return createPortal(<dialog ref={dialog} className="ds-chat-dialog" aria-label={t("New chat")} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}><form className="desk-dialog" onClick={event => event.stopPropagation()} onSubmit={launch}>
    <div className="desk-dialog-heading"><div><span className="desk-eyebrow">{t("A PLACE FOR THE NEXT THING")}</span><h2>{t("New chat")}</h2></div><button type="button" className="desk-icon" onClick={close} aria-label={t("Close")}><Icon name="close" /></button></div>
    <div className="agent-picker">{state.agents.map(item => <button type="button" key={item.id} className={`agent-choice ${agent === item.id ? 'selected' : ''}`} onClick={() => setAgent(item.id)} disabled={!item.available} style={{ '--agent-color': item.color } as React.CSSProperties}><span className="agent-mark"><AgentLogo agent={item.id} size={23} /></span><span>{item.label}<small>{item.available ? item.id === 'shell' ? t("Local terminal") : item.id === 'opencode' ? t("Your providers") : t("Your CLI account") : t("Not installed")}</small></span>{agent === item.id && <span className="choice-check">✓</span>}</button>)}</div>
    {agent === 'antigravity' && <p className="desk-muted">{t("Sign in to Google in the terminal, then use /model to choose an available model. Access and usage limits come from your Google account or API billing.")}</p>}
    <label className="desk-field">{t("Chat name")}<input autoFocus placeholder={t("e.g. Dream Game · animations")} value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>
    <ProjectPicker cwd={cwd} choose={setCwd} />
    <label className="desk-field">{t("Working folder")}<input value={cwd} onChange={event => setCwd(event.target.value)} required spellCheck={false} /></label>
    <div className="desk-field group-field"><span>{t("Group")} <small>{t("Tabs of a group sit together")}</small></span><GroupPicker value={group} groups={groupNames(state.sessions)} onChange={setGroup} /></div>
    {agent !== 'shell' && <><label className="desk-check"><input type="checkbox" checked={bypass} onChange={event => setBypass(event.target.checked)} /><span>{agent === 'opencode' ? t("Auto-approve permission prompts") : t("Bypass agent permission prompts")}<small>{agent === 'opencode' ? t("Explicit deny rules in OpenCode still apply.") : t("Same {0} account and file access as your usual terminal.", isMac ? 'macOS' : isWindows ? 'Windows' : 'user')}</small></span></label><details className="desk-details"><summary>{t("Resume an existing CLI conversation")}</summary><p>{t("For a conversation started outside Dev Space, copy its ID from your CLI's session details or resume picker. Chats created here return automatically.")}</p><label className="desk-field">{t("Native session ID")}<input value={resumeId} onChange={event => setResumeId(event.target.value)} placeholder={t("Optional session ID")} /></label></details></>}
    {error && <p className="desk-error-inline" role="alert">{t(error)}</p>}
    <button className="desk-primary" disabled={busy || !state.connected}>{busy ? t("Opening…") : t("Open chat")}<Icon name="arrow" size={16} /></button>
  </form></dialog>, document.body)
}

function History({ close, choose, scopeIds }: { close: () => void; choose: (id: string) => void; scopeIds?: string[] }) {
  useLocale()
  const state = useDesktop()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [project, setProject] = useState('')
  const projects = [...new Map(state.sessions.map(item => [projectKey(item.cwd), item.cwd])).entries()].map(([key, folder]) => ({ key, folder, name: projectName(folder) })).sort((a, b) => a.name.localeCompare(b.name))
  // Group filters list every group, including one that only History chats still carry, so an old group can be found and deleted here.
  const group = filter.startsWith('group:') ? filter.slice(6) : null
  const counts = group ? groupCounts(state.sessions)[group] || { open: 0, history: 0 } : null
  const items = [...state.sessions].filter(item => (!scopeIds || scopeIds.includes(item.id)) && (filter === 'all' || (filter === 'pinned' ? item.pinned : group ? item.group === group : item.agent === filter)) && (!project || projectKey(item.cwd) === project) && `${item.name} ${item.agent} ${item.cwd} ${item.group || ''} ${item.preview || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const deleteGroup = (name: string) => api('/groups/delete', { name }).then(() => { setFilter('all'); setConfirmDelete(false) }).catch(reportError)
  async function open(item: ChatSession) {
    if (opening) return
    setOpening(item.id)
    try { if (!item.open || item.status !== 'running') await api(`/sessions/${item.id}/resume`, {}); choose(item.id); close() }
    catch (error) { reportError(error) } finally { setOpening(null) }
  }
  return <section className="chat-history" aria-label={t("Chat history")}>
    <header><span><Icon name="history" /><strong>{t("History")}</strong><small>{countLabel(state.sessions.length, 'chat')}</small></span><button className="desk-icon" aria-label={t("Close history")} onClick={close}><Icon name="close" /></button></header>
    <div className="history-search"><Icon name="search" size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Find a conversation…")} aria-label={t("Search chat history")} /></div>
    <div className="history-filters">{[['all', t("All")], ['pinned', t("Pinned")], ...state.agents.filter(item => item.id !== 'shell').map(item => [item.id, item.label]), ...groupNames(state.sessions).map(name => [`group:${name}`, name])].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => { setFilter(value); setConfirmDelete(false) }}>{label}</button>)}{projects.length > 1 && <select className={`history-project ${project ? 'selected' : ''}`} value={project} onChange={event => setProject(event.target.value)} aria-label={t("Filter by project")}><option value="">{t("All projects")}</option>{projects.map(item => <option key={item.key} value={item.key} title={item.folder}>{item.name}</option>)}</select>}</div>
    {group && counts && <div className="history-group-bar" role="group" aria-label={t("{0} group", group)}><span>{group} · {t('Open: {0} · in History: {1}', counts.open, counts.history)}</span>{confirmDelete ? <><span>{t("Remove group from {0} chats? The chats stay in place.", counts.open + counts.history)}</span><button className="danger" onClick={() => deleteGroup(group)}>{t("Delete group")}</button><button onClick={() => setConfirmDelete(false)}>{t("Cancel")}</button></> : <button onClick={() => setConfirmDelete(true)}>{t("Delete group…")}</button>}</div>}
    <div className="history-list">{items.map(item => <article key={item.id} className="history-item">
      <button className="history-open" onClick={() => open(item)} disabled={!!opening} title={t("Open {0} · {1}", item.name, t(chatActivityLabel(item)))}><span className="history-agent" style={{ color: state.agents.find(agent => agent.id === item.agent)?.color }}><SessionLogo session={item} size={24} /></span><span><strong>{item.name}</strong><small>{item.group ? `${item.group} · ` : ''}{state.agents.find(agent => agent.id === item.agent)?.label} · {item.open ? t("Open") : new Date(item.updatedAt || item.createdAt).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' })} · {item.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</small>{item.preview && <p>{item.preview}</p>}</span><Icon name={opening === item.id ? 'refresh' : 'arrow'} size={16} /></button>
      <button className={`desk-icon history-pin ${item.pinned ? 'active' : ''}`} aria-label={`${item.pinned ? t("Unpin") : t("Pin")} ${item.name}`} onClick={() => api(`/sessions/${item.id}`, { pinned: !item.pinned }, 'PATCH').catch(reportError)}><Icon name="pin" size={15} /></button>
    </article>)}{!items.length && <p className="desk-muted">{query ? t("No matching conversations.") : filter === 'pinned' ? t("Pin a conversation to keep it close at hand.") : t("Closed chats will be here when you need them.")}</p>}</div>
    <footer>{t("Close a tab to put it away. Its conversation stays here.")}</footer>
  </section>
}

export interface ChatPaneControl extends PaneTabActions { id: string; ids: string[]; selectedId: string | null; focused: boolean; close: (id: string) => void; choose: (id: string) => void }
export default function Chats({ embedded = false, initialCwd, projectId, pane, scopeIds }: { embedded?: boolean; initialCwd?: string; projectId?: string; pane?: ChatPaneControl; scopeIds?: string[] } = {}) {
  const locale = useLocale()
  useEffect(() => { if (embedded) return; document.title = t('Dev Space — Chats'); document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', '/assets/dev-space.png') }, [locale, embedded])
  const state = useDesktop()
  const [newChat, setNewChat] = useState(false)
  const [switcher, setSwitcher] = useState(false)
  const [history, setHistory] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [pinned, setPinned] = useState(false)
  const fontSize = state.settings.terminalFontSize || 13
  const [attachmentNotice, setAttachmentNotice] = useState({ id: '', text: '' })
  const attachmentStatus = useCallback((id: string, text: string) => setAttachmentNotice(current => text || current.id === id ? { id, text } : current), [])
  const active = orderedChats(state.sessions).filter(item => !pane || pane.ids.includes(item.id))
  const session = active.find(item => item.id === (pane ? pane.selectedId : state.selectedId)) || active[0]
  const model = useChatModel(session)
  const agent = state.agents.find(item => item.id === session?.agent)
  const running = session?.status === 'running' || session?.status === 'starting'
  const [, setViewVersion] = useState(0)
  const view: ChatView = session ? chatView(session) : 'terminal'
  const showView = (value: ChatView, preferred = true) => { if (!session) return; saveChatView(session.id, value, preferred); setViewVersion(version => version + 1) }
  const filtered = active.filter(item => `${item.name} ${item.agent} ${item.cwd} ${item.group || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase()))
  const choose = (id: string) => { if (pane) pane.choose(id); else selectChat(id); setSwitcher(false); setMenu(false); setHistory(false); setRenaming(false) }
  const closeChat = (id: string) => { if (pane) pane.close(id); else void api(`/sessions/${id}`, {}, 'DELETE').catch(reportError) }
  const groups = groupNames(state.sessions)
  const historyCounts = Object.fromEntries(Object.entries(groupCounts(state.sessions)).map(([name, counts]) => [name, counts.history]))
  const collapsed = state.settings.collapsedGroups || []
  const setCollapsed = (names: string[]) => api('/settings', { collapsedGroups: names }).catch(reportError)
  const toggleGroup = (name: string) => setCollapsed(collapsed.includes(name) ? collapsed.filter(item => item !== name) : [...collapsed, name])
  const collapseOthers = (name: string) => setCollapsed(groupNames(active).filter(item => item !== name))
  const groupColors = state.settings.groupColors || {}
  const setGroupColor = (name: string, value: string | null) => { const next = { ...groupColors }; if (value) next[name] = value; else delete next[name]; api('/settings', { groupColors: next }).catch(reportError) }
  useEffect(() => {
    if (!state.connected || !session?.unread || pane && !pane.focused || history || switcher || newChat) return
    let timer = 0
    const viewed = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) sendEvent({ type: 'seen', id: session.id, completionVersion: session.completionVersion })
      }, 600)
    }
    viewed()
    window.addEventListener('focus', viewed)
    window.addEventListener('blur', viewed)
    document.addEventListener('visibilitychange', viewed)
    return () => { clearTimeout(timer); window.removeEventListener('focus', viewed); window.removeEventListener('blur', viewed); document.removeEventListener('visibilitychange', viewed) }
  }, [state.connected, session?.id, session?.unread, session?.completionVersion, history, switcher, newChat, pane?.focused])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (pane && !pane.focused || event.defaultPrevented || document.querySelector('dialog:modal')) return
      if (modKey(event) && event.shiftKey && event.code === 'KeyT') { event.preventDefault(); setNewChat(true) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setSwitcher(value => !value) }
      if (event.key === 'Escape') { setSwitcher(false); setMenu(false); setNewChat(false); setHistory(false) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyH') { event.preventDefault(); setHistory(value => !value) }
      if (modKey(event) && event.shiftKey && event.code === 'KeyW' && session?.id) { event.preventDefault(); closeChat(session.id) }
      const openChats = active
      if (event.ctrlKey && event.code === 'Tab' && openChats.length) {
        event.preventDefault()
        const index = openChats.findIndex(item => item.id === session?.id)
        choose(openChats[(index + (event.shiftKey ? -1 : 1) + openChats.length) % openChats.length].id)
      }
      if ((isMac ? event.metaKey : event.altKey) && /^Digit[1-9]$/.test(event.code)) {
        const target = openChats[Number(event.code.slice(5)) - 1]
        if (target) { event.preventDefault(); choose(target.id) }
      }
    }
    // macOS: Cmd+1…9 arrive from the native Chats menu (the web view never sees them).
    const menuSelect = (event: Event) => {
      if (pane && !pane.focused) return
      const target = orderedChats(state.sessions)[((event as CustomEvent<{ index: number }>).detail?.index || 0) - 1]
      if (target) choose(target.id)
    }
    window.addEventListener('keydown', shortcut)
    window.addEventListener('mrmak-select-chat', menuSelect)
    return () => { window.removeEventListener('keydown', shortcut); window.removeEventListener('mrmak-select-chat', menuSelect) }
  }, [state.sessions, session?.id, pane?.focused])
  useEffect(() => {
    if (!session || view !== 'conversation') return
    const subscribe = () => sendEvent({ type: 'subscribe', id: session.id })
    subscribe(); const off = onServiceEvent(event => { if (event.type === 'connected') subscribe() })
    return () => { off(); sendEvent({ type: 'unsubscribe', id: session.id }) }
  }, [session?.id, view])
  const changeFont = (delta: number) => { const value = Math.max(10, Math.min(24, fontSize + delta)); api('/settings', { terminalFontSize: value }).catch(reportError) }
  async function rename(event: React.FormEvent) { event.preventDefault(); if (!session) return; try { await api(`/sessions/${session.id}`, { name: title }, 'PATCH'); setRenaming(false) } catch (error) { reportError(error) } }

  return <div className="chats-surface">
    <header className="chats-header"><div className="chats-brand"><Nose size={25} tone="black" /><span>Dev Space <b>{t("Chats")}</b></span></div><div className="chats-header-actions"><BrowserSettings target="chat" /><MobileAccess /><button className={`desk-icon ${pinned ? 'active' : ''}`} title={t("Keep Chats above other windows")} onClick={() => { setPinned(!pinned); windowAction('chats', 'pin', !pinned) }}><Icon name="pin" size={16} /></button><button className="desk-icon" title={t("Show Workspace")} onClick={() => windowAction('workspace')}><Icon name="workspace" size={18} /></button></div></header>
    <div className="chat-tabs-row"><ChatTabs items={active} selectedId={session?.id} agents={state.agents} groups={groups} collapsed={collapsed} groupColors={groupColors} historyCounts={historyCounts} choose={choose} close={closeChat} toggleGroup={toggleGroup} collapseOthers={collapseOthers} setGroupColor={setGroupColor} pane={pane} /><div className="chat-tab-actions"><button className="desk-icon new-chat-button" onClick={() => setNewChat(true)} title={t("New chat · {0}", shortcutLabel('Shift+T'))} aria-label={t("New chat")}><Icon name="plus" /></button><button className={`desk-icon ${switcher ? 'active' : ''}`} onClick={() => { setSwitcher(value => !value); setHistory(false) }} title={t("Find a chat · {0}", shortcutLabel('Shift+P'))} aria-label={t("Find a chat")}><Icon name="search" size={16} /></button><button className={`history-button ${history ? 'active' : ''}`} onClick={() => { setHistory(value => !value); setSwitcher(false); setMenu(false) }} title={t("History · {0}", shortcutLabel('Shift+H'))}><Icon name="history" size={15} /><span>{t("History")}</span></button></div></div>
    <div className="chat-body">
    {history && <History close={() => setHistory(false)} choose={choose} scopeIds={scopeIds} />}
    {switcher && <div className="chat-switcher"><div className="switcher-search"><Icon name="search" size={16} /><input autoFocus placeholder={t("Find any chat…")} value={query} onChange={event => setQuery(event.target.value)} /></div><div className="switcher-list">{filtered.map(item => <button key={item.id} onClick={() => choose(item.id)} className={session?.id === item.id ? 'selected' : ''}><span className="agent-letter" style={{ color: state.agents.find(a => a.id === item.agent)?.color }}><SessionLogo session={item} size={19} /></span><span><strong>{item.name}</strong><small>{item.group ? `${item.group} · ` : ''}{item.cwd}</small></span><span className="switcher-state">{t(chatActivityLabel(item))}</span></button>)}{!filtered.length && <p className="desk-muted">{t("No matching chats.")}</p>}</div></div>}
    {session ? <>
      <div className="chat-context"><span className="agent-label" style={{ color: agent?.color }}>{agent?.label}</span><span className="chat-folder" title={session.cwd}>{session.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0]}</span>{hasConversationView(session) && <div className="chat-view-toggle" role="group" aria-label={t("Chat view")}>{([['conversation', 'chats', t("Conversation")], ['terminal', 'terminal', t("Terminal")]] as const).map(([value, icon, label]) => <button key={value} aria-pressed={view === value} onClick={() => showView(value)}><Icon name={icon} size={12} />{label}</button>)}</div>}{view === 'terminal' && <><button className="desk-icon" title={t("Attach file paths · drop files or folders · {0}V for screenshots", modLabel)} aria-label={t("Attach files")} onClick={() => window.dispatchEvent(new CustomEvent('mrmak-attach-file', { detail: { id: session.id } }))}><Icon name="attach" size={16} /></button><DictationComposer key={`dictation-${session.id}`} id={session.id} connected={state.connected} running={session.status === 'running'} /></>}<button className="desk-icon" title={t("Chat options")} onClick={() => setMenu(!menu)}><Icon name="more" size={18} /></button></div>
      {menu && <div className="chat-options">{renaming ? <form className="inline-rename" onSubmit={rename}><input autoFocus value={title} onChange={event => setTitle(event.target.value)} aria-label={t("Chat name")} /><button type="submit">{t("Save")}</button></form> : <button onClick={() => { setTitle(session.name); setRenaming(true) }}>{t("Rename chat")}</button>}<button onClick={() => api(`/sessions/${session.id}`, { pinned: !session.pinned }, 'PATCH').catch(reportError)}>{session.pinned ? t("Unpin from History") : t("Pin in History")}</button><button onClick={() => api('/reveal', { path: session.cwd }).catch(reportError)}>{t("Show working folder")}</button><button onClick={() => api(`/sessions/${session.id}/clear`, {}).then(() => setMenu(false)).catch(reportError)} title={t("Clear visible scrollback; keep the agent conversation")}>{t("Clear terminal scrollback")}</button><div className="group-setting"><span>{t("Group")}</span><GroupPicker value={session.group} groups={groups} onChange={value => api(`/sessions/${session.id}`, { group: value }, 'PATCH').catch(reportError)} /></div><div className="chat-color-setting"><span>{t("Tab color")}</span><div role="group" aria-label={t("Tab color")}><button className={`tab-color-swatch no-color ${!session.tabColor ? 'selected' : ''}`} aria-label={t("No tab color")} aria-pressed={!session.tabColor} onClick={() => api(`/sessions/${session.id}`, { tabColor: null }, 'PATCH').catch(reportError)} title={t("No color")} />{tabColors.map(color => <button key={color.value} className={`tab-color-swatch ${session.tabColor === color.value ? 'selected' : ''}`} style={{ '--swatch': color.value } as React.CSSProperties} aria-label={t("{0} tab color", t(color.name))} aria-pressed={session.tabColor === color.value} title={t(color.name)} onClick={() => api(`/sessions/${session.id}`, { tabColor: color.value }, 'PATCH').catch(reportError)} />)}</div></div><div className="terminal-appearance-setting"><span>{t("Terminal appearance")} <small>{t("All chats")}</small></span><div role="group" aria-label={t("Terminal appearance")}>{[['original', t("Original CLI colors")], ['focus', t("Dev Space Focus")]].map(([value, label]) => <button key={value} aria-pressed={(state.settings.terminalAppearance || 'original') === value} onClick={() => api('/settings', { terminalAppearance: value }).catch(reportError)}>{label}</button>)}</div><p><i className="legend-user" />{t("You")} <i className="legend-agent" />{t("Agent")} <i className="legend-detail" />{t("Details")}</p></div><div className="option-select-setting"><span>{t("Suggest a fresh chat")} <small>{t("All chats · saves tokens")}</small></span><select aria-label={t("Suggest a fresh chat after")} value={state.settings.handoffAfter ?? 40} onChange={event => api('/settings', { handoffAfter: Number(event.target.value) }).catch(reportError)}>{[[0, t("Off")], [20, t("After 20 messages")], [40, t("After 40 messages")], [60, t("After 60 messages")], [100, t("After 100 messages")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="option-select-setting"><span>{t("CLI events in Conversation")} <small>{t("Agents, commands, notices")}</small></span><select aria-label={t("CLI events in Conversation")} value={state.settings.systemEvents || 'compact'} onChange={event => api('/settings', { systemEvents: event.target.value }).catch(reportError)}>{[['compact', t("Compact · open on click")], ['full', t("Expanded")], ['hidden', t("Hidden")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="font-control"><span>{t("Terminal text")}</span><button onClick={() => changeFont(-1)}>−</button><span>{fontSize}</span><button onClick={() => changeFont(1)}>+</button></div><button onClick={() => { closeChat(session.id); setMenu(false) }}>{t("Close tab · keep in History")}</button></div>}
      {hasConversationView(session) && <HandoffOffer key={`handoff-${session.id}`} session={session} threshold={state.settings.handoffAfter ?? 40} agentLabel={agent?.label || session.agent} />}
      {view === 'conversation' ? <Conversation key={session.id} session={session} connected={state.connected} agentLabel={agent?.label || session.agent} openTerminal={() => showView('terminal', false)} systemEvents={state.settings.systemEvents} focused={pane?.focused ?? true} /> : <TerminalPane key={session.id} id={session.id} agent={session.agent} fontSize={fontSize} appearance={state.settings.terminalAppearance || 'original'} optionMeta={!!state.settings.terminalOptionMeta} onAttachmentStatus={attachmentStatus} focused={pane?.focused ?? true} fontFamily={terminalFontStack(state.settings.display?.terminalFont)} />}
      {!running && <div className="terminal-reconnect"><span>{session.restoreError && t(session.restoreError) || t("Reconnecting to your conversation…")}</span><button onClick={() => api(`/sessions/${session.id}/resume`, {}).catch(reportError)}>{t("Reconnect")}</button></div>}
      <footer className="chat-status">{attachmentNotice.id === session.id && attachmentNotice.text ? <span className="attachment-status" role="status"><Icon name="attach" size={12} /><span>{attachmentNotice.text}</span></span> : <><span><i className={state.connected ? 'connected-dot' : 'disconnected-dot'} />{state.connected ? running ? t("Connected · autosaved") : t("Reconnecting…") : t("Reconnecting…")}</span><span title={[model && t('Model: {0}', model), session.effort && t('Reasoning effort'), t('Terminal permissions')].filter(Boolean).join(' · ')}>{model && <span className="chat-status-model">{modelLabel(model)} · </span>}{session.effort && `${t(session.effort)} · `}{session.agent === 'shell' ? (isMac ? 'macOS' : isWindows ? 'Windows' : t("Local")) : session.bypass ? t("Bypass") : t("CLI permissions")}</span><span className="status-shortcut">{modLabel}{t("V · image")}</span></>}</footer>
    </> : pane ? <div className="agent-pane-empty"><h2>Свободная панель</h2><p>Перетащите сюда вкладку агента.</p><select value="" aria-label="Переместить открытого агента в эту панель" onChange={event => { if (event.target.value) choose(event.target.value) }}><option value="">Выбрать открытого агента…</option>{orderedChats(state.sessions).filter(item => !scopeIds || scopeIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="ds-secondary" onClick={() => setNewChat(true)}><Icon name="plus" size={15}/>Новый агент</button></div> : <div className="chats-empty"><div className="empty-orbit"><Nose size={64} tone="black" /></div><span className="desk-eyebrow">{t("ROOM TO THINK")}</span><h1>{t("Your agents,")}<br />{t("close at hand.")}</h1><p>{t("A chat for each task.")}<br />{t("Keep this window beside whatever")}<br />{t("you are working on.")}</p><button className="desk-primary" onClick={() => setNewChat(true)}><Icon name="plus" size={17} />{t("Open your first chat")}</button><div className="empty-agent-names"><span>Claude</span><span>Codex</span><span>OpenCode</span><span>Kimi</span></div><small>{t("Your CLI accounts. Your local files.")}</small></div>}
    </div>
    {newChat && <NewChat initialCwd={initialCwd} projectId={projectId} close={() => setNewChat(false)} />}
  </div>
}
