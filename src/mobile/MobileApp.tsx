import { intlLocale, t, useLocale } from '../i18n/index.ts'
import LanguagePicker from '../components/LanguagePicker'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AgentLogo, Icon, Nose } from '../desktop/Icons'
import SystemEvent, { type SystemEventData } from './SystemEvent'
import type { ChatSession, RecentProject } from '../desktop/types'
import { chatActivityLabel } from '../desktop/chatActivity'
import { chooseMobileDictation, disconnectMobile, mobileApi, mobileEvent, reconnectMobile, onMobileEvent, selectMobileChat, startMobile, useMobile } from './client'
import { installMobileBack, mobileChatPosition, saveMobileChatPosition, setMobileHistory, setMobileView, useMobileNavigation } from './app-state'
import Terminal from './Terminal'
import Composer from './Composer'
import ConversationImages from './ConversationImages'
import { spokenText, useReadAloud } from './useReadAloud'
import ReadingVoiceSettings from './ReadingVoiceSettings'
import DictationSettings from '../components/DictationSettings'
import Results from './Results'
import ActivityStatus from './ActivityStatus'
import BackgroundWork, { type BackgroundCommand, type WorkingAgent } from './BackgroundWork'
import { useInstall } from './useInstall'
import { visibleUserMessage } from './workspace-context'
import './mobile.css'

interface Pending { id: string; claim: string; code: string }
interface ToolActivity { id: string; name: string; status: 'running' | 'completed' | 'failed'; at: string }
interface Message { id: string; role: 'user' | 'assistant' | 'system'; event?: SystemEventData; text: string; at: string; images?: { url?: string; name: string; unavailable?: boolean; kind?: 'image' | 'video'; type?: string }[] }
function getPairToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (token) { sessionStorage.setItem('mrmak.mobile.pair', token); history.replaceState(null, '', location.pathname) }
  return sessionStorage.getItem('mrmak.mobile.pair') || ''
}
function Connect() {
  useLocale()
  const state = useMobile()
  const [pairToken, setPairToken] = useState(getPairToken)
  const [name, setName] = useState(t("My phone")), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<Pending | null>(() => { try { return JSON.parse(sessionStorage.getItem('mrmak.mobile.pending') || 'null') } catch { return null } })
  useEffect(() => {
    if (!pending) return
    let stopped = false, working = false
    const poll = async () => {
      if (working || document.visibilityState === 'hidden') return
      working = true
      try {
        const result = await mobileApi<{ status: string }>('/pair/finish', pending)
        if (stopped) return
        if (result.status === 'connected') { sessionStorage.removeItem('mrmak.mobile.pending'); sessionStorage.removeItem('mrmak.mobile.pair'); setPairToken(''); setPending(null); void startMobile() }
      } catch (err) { if (!stopped) setError(err instanceof Error ? err.message : String(err)) }
      finally { working = false }
    }
    void poll(); const timer = window.setInterval(poll, 2500)
    return () => { stopped = true; clearInterval(timer) }
  }, [pending])
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const result = await mobileApi<Pending>('/pair', { token: pairToken || code.replace(/\s/g, ''), name }); sessionStorage.setItem('mrmak.mobile.pending', JSON.stringify(result)); setPending(result) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <main className="mobile-connect"><Nose size={64} /><span className="mobile-eyebrow">{t("YOUR AGENTS, CLOSE AT HAND")}</span><h1>Dev Space<br /><span>{t("on your phone.")}</span></h1>
    {pending ? <div className="mobile-connect-card"><Icon name="phone" size={28} /><h2>{t("Confirm on your computer")}</h2><p>{t("Open the phone button in Dev Space Chats. Check this code, then choose Connect phone.")}</p><code className="mobile-pair-code">{pending.code}</code><span className="mobile-waiting">{t("Waiting for confirmation…")}</span><button onClick={() => { sessionStorage.removeItem('mrmak.mobile.pending'); setPending(null); setError(t("Scan a new QR code in Chats to try again.")) }}>{t("Cancel")}</button></div>
    : pairToken ? <form className="mobile-connect-card" onSubmit={connect}><h2>{t("Connect this phone")}</h2><p>{t("Your agents and files stay on your computer.")}</p><label>{t("Device name")}<input autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label><button className="mobile-primary" disabled={busy}>{busy ? t("Connecting…") : t("Request connection")}<Icon name="arrow" size={17} /></button></form>
    : <form className="mobile-connect-card" onSubmit={connect}><h2>{t("Start in Dev Space Chats")}</h2><p>{t("On your computer, press the phone icon. Scan the QR code or enter its connection code below. Keep Tailscale connected on both devices.")}</p><label>{t("Connection code")}<input inputMode="numeric" autoComplete="off" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ''))} placeholder={t("8 digits")} /></label><button className="mobile-primary" disabled={busy || code.length !== 8}>{t("Request connection")}<Icon name="arrow" size={17} /></button><button type="button" onClick={() => void startMobile()}>{t("Check existing connection")}</button></form>}
    {(error || state.error) && <p className="mobile-error" role="alert">{t(error || state.error || '')}</p>}<LanguagePicker /><p className="mobile-connect-foot">{t("Your conversations. Your computer.")}<br />{t("A little more room to move.")}</p>
  </main>
}

function Conversation({ session, active }: { session: ChatSession; active: boolean }) {
  useLocale()
  const speech = useReadAloud(session.id), stopReading = speech.stop
  const [mode, setMode] = useState<'messages' | 'terminal'>(() => mobileChatPosition(session.id).mode || (['codex', 'claude'].includes(session.agent) ? 'messages' : 'terminal'))
  useEffect(() => saveMobileChatPosition(session.id, { mode }), [session.id, mode])
  useEffect(() => { if (mode === 'terminal' || !active) stopReading() }, [mode, active, stopReading])
  const [messages, setMessages] = useState<Message[]>([]), [supported, setSupported] = useState(true), [error, setError] = useState('')
  let readStart = 0
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'user') readStart = index
  const readEnd = messages.length - 1, latestUserId = messages[readStart]?.role === 'user' ? messages[readStart].id : null
  useEffect(() => () => stopReading(), [latestUserId, stopReading])
  const [initialPosition] = useState(() => mobileChatPosition(session.id))
  const scroller = useRef<HTMLDivElement>(null), restored = useRef(false), follow = useRef(initialPosition.follow !== false), state = useMobile()
  const [activity, setActivity] = useState<ToolActivity[]>([]), [background, setBackground] = useState<{ agents?: WorkingAgent[]; commands?: BackgroundCommand[] }>({})
  const reloadConversation = useRef<(() => Promise<void>) | null>(null)
  const [showJump, setShowJump] = useState(false)
  function jumpToLatest() { follow.current = true; setShowJump(false); const box = scroller.current; if (box) box.scrollTop = box.scrollHeight }
  function showConversation() { if (mode !== 'messages') restored.current = false; setMode('messages'); void reloadConversation.current?.() }
  const modeGesture = useRef<{ x: number; y: number; id: number } | null>(null), suppressModeClick = useRef(false)
  const [checkedAt, setCheckedAt] = useState(0), [changedAt, setChangedAt] = useState(() => Date.now()), [readError, setReadError] = useState(''), [now, setNow] = useState(() => Date.now())
  const transcriptFingerprint = useRef('')
  useEffect(() => {
    if (!active) return
    let stopped = false, working = false
    const load = async () => {
      if (working || document.visibilityState === 'hidden') return
      working = true
      try {
        const result = await mobileApi<{ messages: Message[]; supported: boolean; activity?: ToolActivity[]; agents?: WorkingAgent[]; commands?: BackgroundCommand[] }>(`/sessions/${session.id}/messages`)
        if (!stopped) {
          const at = Date.now(), fingerprint = JSON.stringify(result.messages)
          if (fingerprint !== transcriptFingerprint.current) { transcriptFingerprint.current = fingerprint; setChangedAt(at) }
          setMessages(result.messages); setActivity(result.activity || []); setBackground({ agents: result.agents, commands: result.commands }); setSupported(result.supported); setCheckedAt(at); setNow(at); setReadError('')
        }
      } catch { if (!stopped) { setReadError(t("Conversation could not refresh. Your previous messages are still shown.")); setNow(Date.now()) } }
      finally { working = false }
    }
    reloadConversation.current = load
    void load(); const timer = window.setInterval(load, 2200)
    const seen = () => { mobileEvent({ type: 'subscribe', id: session.id }); if (document.visibilityState === 'visible') mobileEvent({ type: 'seen', id: session.id, completionVersion: session.completionVersion }) }
    seen(); const visible = () => { if (document.visibilityState === 'visible') { seen(); void load() } }
    document.addEventListener('visibilitychange', visible)
    const off = onMobileEvent(event => { if (event.type === 'connected') { seen(); void load() } else if (event.type === 'transcript-changed' && event.id === session.id) void load() })
    return () => { stopped = true; reloadConversation.current = null; clearInterval(timer); off(); document.removeEventListener('visibilitychange', visible) }
  }, [session.id, session.completionVersion, active])
  useLayoutEffect(() => {
    const box = scroller.current
    if (!active || mode !== 'messages' || !box || !messages.length) return
    if (!restored.current) {
      const saved = mobileChatPosition(session.id); follow.current = saved.follow !== false
      box.scrollTop = follow.current ? box.scrollHeight : saved.top || 0; restored.current = true
      requestAnimationFrame(() => { if (scroller.current === box) { const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 100; follow.current = nearEnd; setShowJump(!nearEnd) } })
    }
    else if (follow.current) box.scrollTop = box.scrollHeight
  }, [messages, mode, active, session.id])
  const running = session.status === 'running'
  return <>
    <div className="mobile-chat-tools"><div className="mobile-segment" role="group" aria-label={t("Conversation view")}
      onPointerDown={event => { suppressModeClick.current = false; modeGesture.current = event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null }}
      onPointerCancel={() => { modeGesture.current = null }}
      onPointerUp={event => {
        const start = modeGesture.current; modeGesture.current = null
        if (!start || start.id !== event.pointerId) return
        const dx = event.clientX - start.x, dy = event.clientY - start.y
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        suppressModeClick.current = true
        if (dx < 0) setMode('terminal'); else showConversation()
      }}
      onClickCapture={event => { if (suppressModeClick.current) { event.preventDefault(); event.stopPropagation(); suppressModeClick.current = false } }}
    ><button className={mode === 'messages' ? 'active' : ''} onClick={showConversation}>{t("Conversation")}</button><button className={mode === 'terminal' ? 'active' : ''} onClick={() => { speech.stop(); setMode('terminal') }}>{t("Terminal")}</button></div><ActivityStatus session={session} connected={state.connected} /></div>
    {mode === 'terminal' ? <Terminal id={session.id} /> : <div className="mobile-message-pane"><div className="mobile-messages" ref={scroller} onScroll={() => { const box = scroller.current; if (box) { const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 100; if (!restored.current) return; follow.current = nearEnd; saveMobileChatPosition(session.id, { top: box.scrollTop, follow: nearEnd }); setShowJump(!nearEnd) } }}>
      <div className="mobile-history-note">{checkedAt ? t("Transcript checked {0}", new Date(checkedAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })) : t("Loading conversation…")}{messages[messages.length - 1]?.at && ` · Last message ${new Date(messages[messages.length - 1].at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}`}</div>
      {(readError || (session.activity === 'working' && now - changedAt >= 45000)) && <div className="mobile-transcript-status" role="status"><p>{readError || t("Conversation has not updated recently. The terminal may have newer output.")}</p><button onClick={() => { speech.stop(); setMode('terminal') }}>{t("Open terminal")}<Icon name="arrow" size={15} /></button></div>}
      {messages.map((message, index) => message.role === 'system' ? message.event && <SystemEvent key={message.id} event={message.event} time={message.at ? new Date(message.at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : undefined} /> : <article className={`mobile-message ${message.role}`} key={message.id}><header>{message.role === 'user' ? t("You") : <><AgentLogo agent={session.agent} size={15} />{session.agent === 'claude' ? 'Claude' : 'Codex'}</>}{message.at && <time>{new Date(message.at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}</time>}</header><div className="mobile-message-copy"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{message.role === 'user' ? visibleUserMessage(message.text) : message.text}</ReactMarkdown></div><ConversationImages images={message.images} />{index === readEnd && message.role === 'assistant' && messages.slice(readStart).some(item => item.text.trim()) && <div className="mobile-read-aloud"><button type="button" disabled={!speech.supported} aria-label={speech.activeId ? speech.paused ? t("Resume reading") : t("Pause reading") : t("Read aloud")} title={!speech.supported ? t("Read aloud is unavailable in this browser") : speech.activeId ? speech.paused ? t("Resume reading") : t("Pause reading") : t("Read from your last message to this reply")} onClick={() => { if (speech.activeId) speech.togglePause(); else speech.read(message.id, Array.from(scroller.current?.querySelectorAll<HTMLElement>('.mobile-message-copy') || []).slice(readStart, readEnd + 1).map(spokenText).filter(Boolean).join('\n\n')) }}><Icon name={speech.activeId ? speech.paused ? 'play' : 'pause' : 'speaker'} size={19} /></button>{speech.activeId && <button type="button" aria-label={t("Stop reading")} title={t("Stop reading")} onClick={speech.stop}><Icon name="stop" size={17} /></button>}{speech.loading && <span role="status">{t("Preparing audio…")}</span>}</div>}</article>)}
      {!messages.length && <div className="mobile-chat-empty"><Icon name="chats" size={30} /><h2>{supported ? t("Ready for your next thought") : t("This chat is in the terminal")}</h2><p>{supported ? t("Messages will appear here as your agent writes its conversation history.") : t("Open the live terminal to read the conversation or respond to a CLI prompt.")}</p><button onClick={() => { speech.stop(); setMode('terminal') }}>{t("Open terminal")}<Icon name="arrow" size={15} /></button></div>}
      {!!activity.length && <details className="mobile-tool-activity" aria-label={t("Recent tool activity")}><summary>{t("Recent activity")}</summary>{activity.map(item => <div key={item.id}><Icon name={item.status === 'running' ? 'terminal' : item.status === 'failed' ? 'bell' : 'history'} size={14} /><span>{item.name}</span><small>{item.status === 'running' && !running ? t("Interrupted") : t(item.status)}{item.at && ` · ${new Date(item.at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}`}</small></div>)}</details>}
      {session.activity === 'working' && <p className="mobile-agent-working"><i />{t("Agent is working on your computer…")}</p>}
    </div>{showJump && <button className="mobile-jump-latest" onClick={jumpToLatest}><Icon name="down" size={16} />{t("Jump to latest")}</button>}</div>}
    {mode === 'messages' && <BackgroundWork agents={background.agents} commands={background.commands} now={now} />}
    {!running && <div className="mobile-resume"><span>{t("This conversation is saved.")}</span><button disabled={!state.connected} onClick={async () => { try { await mobileApi(`/sessions/${session.id}/resume`, {}); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }}>{t("Resume chat")}</button></div>}
    {speech.error && <p className="mobile-error" role="alert">{t(speech.error)}</p>}
    {error && <p className="mobile-error" role="alert">{t(error)}</p>}
    <Composer key={session.id} id={session.id} connected={state.connected} running={running} active={active} />
  </>
}

function NewChat({ close, opened }: { close: () => void; opened: (id: string) => void }) {
  useLocale()
  const state = useMobile(), available = state.agents.filter(item => item.available)
  const [agent, setAgent] = useState(available.some(item => item.id === state.defaultAgent) ? state.defaultAgent! : available[0]?.id || '')
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<RecentProject[]>([]), [cwd, setCwd] = useState('')
  useEffect(() => { let alive = true; mobileApi<RecentProject[]>('/projects').then(value => { if (alive) { setProjects(value); setCwd(current => current || value[0]?.path || '') } }).catch(() => {}); return () => { alive = false } }, [])
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { const session = await mobileApi<ChatSession>('/sessions', { agent, name, ...(cwd ? { cwd } : {}) }); await startMobile(); opened(session.id); close() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <div className="mobile-modal-backdrop"><form className="mobile-modal" onSubmit={create}><header><h2>{t("New chat")}</h2><button type="button" className="mobile-icon" aria-label={t("Close new chat")} onClick={close}><Icon name="close" /></button></header><label>{t("Agent")}<select value={agent} onChange={event => setAgent(event.target.value)}>{available.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>{t("Chat name")}<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required placeholder={t("e.g. Video ideas")} /></label>{projects.length > 1 && <label>{t("Project")}<select value={cwd} onChange={event => setCwd(event.target.value)}>{projects.map(item => <option key={item.path} value={item.path}>{item.name} · {item.path}</option>)}</select></label>}<p>{projects.length > 1 ? t("Projects you opened in Claude Code or Dev Space on your computer.") : t("Starts in this Workspace folder on your computer.")} {state.defaultBypass ? t("Your desktop default allows permission bypass.") : t("Uses your desktop default permissions.")}</p>{error && <p className="mobile-error" role="alert">{t(error)}</p>}<button className="mobile-primary" disabled={busy || !agent || !state.connected}>{busy ? t("Opening…") : t("Open chat")}<Icon name="plus" size={17} /></button></form></div>
}

export default function MobileApp() {
  const locale = useLocale()
  useEffect(() => { document.title = t('Dev Space Mobile') }, [locale])
  const installation = useInstall()
  const [resultsHeader, setResultsHeader] = useState<HTMLDivElement | null>(null)
  const { view, history } = useMobileNavigation()
  const state = useMobile(), [query, setQuery] = useState(''), [creating, setCreating] = useState(false), [settings, setSettings] = useState(false)
  const [closing, setClosing] = useState(false), [closeError, setCloseError] = useState('')
  const [refreshing, setRefreshing] = useState(false), refreshTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(refreshTimer.current), [])
  function refreshPage() {
    if (refreshTimer.current !== undefined) return
    setRefreshing(true)
    void reconnectMobile()
    refreshTimer.current = window.setTimeout(() => { setRefreshing(false); refreshTimer.current = undefined }, 500)
  }
  useEffect(() => {
    document.documentElement.dataset.makTheme = 'dark'
    const manifest = document.createElement('link'); manifest.rel = 'manifest'; manifest.href = '/mobile/manifest.webmanifest'; document.head.append(manifest)
    const icon = document.createElement('link'); icon.rel = 'apple-touch-icon'; icon.href = '/assets/mak-mobile-192.png'; document.head.append(icon)
    const theme = document.createElement('meta'); theme.name = 'theme-color'; theme.content = '#0d0e12'; document.head.append(theme)
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]'), previousViewport = viewport?.content
    if (viewport) viewport.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'
    // Keep the composer above iOS/Android keyboards without changing desktop geometry.
    const resize = () => document.documentElement.style.setProperty('--mobile-height', `${window.visualViewport?.height || innerHeight}px`)
    resize(); window.visualViewport?.addEventListener('resize', resize); window.addEventListener('resize', resize)
    void startMobile()
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/mobile/sw.js', { scope: '/mobile/' }).catch(() => {})
    return () => { manifest.remove(); icon.remove(); theme.remove(); if (viewport && previousViewport) viewport.content = previousViewport; window.visualViewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--mobile-height') }
  }, [])
  const session = state.sessions.find(item => item.id === state.selectedId)
  useEffect(() => { if (state.ready && state.authenticated && view === 'chat' && !session) setMobileView('list') }, [state.ready, state.authenticated, view, session])
  useEffect(() => state.authenticated ? installMobileBack() : undefined, [state.authenticated])
  function open(id: string) { selectMobileChat(id); setCloseError(''); setMobileView('chat') }
  async function closeChat() {
    if (!session || closing || !state.connected) return
    if (!window.confirm(t("Close \"{0}\"? This closes the desktop tab and stops its CLI. The conversation stays in History.", session.name))) return
    setClosing(true); setCloseError('')
    try { await mobileApi(`/sessions/${session.id}/close`, {}); setMobileView('list') }
    catch (err) { setCloseError(err instanceof Error ? err.message : String(err)) }
    finally { setClosing(false) }
  }
  if (!state.ready) return <div className="mobile-app mobile-loading"><Nose size={52} /><p>{t("Connecting to Dev Space…")}</p></div>
  if (!state.authenticated) return <div className="mobile-app"><Connect /></div>
  const items = [...state.sessions].filter(item => (history || item.open) && `${item.name} ${item.agent}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (history ? b.updatedAt.localeCompare(a.updatedAt) : a.tabOrder - b.tabOrder))
  const title = view === 'chat' && session ? session.name : view === 'results' ? t("Workspace") : history ? t("History") : t("Chats")
  return <div className="mobile-app"><header className={`mobile-header ${view === 'chat' ? 'mobile-header-chat' : ''}`}>
    {view === 'chat' && <button className="mobile-icon" aria-label={t("Back to chats")} onClick={() => setMobileView('list')}><Icon name="back" /></button>}
    <button className={`mobile-nose-refresh ${refreshing ? 'refreshing' : ''}`} aria-label={t("Reconnect")} title={t("Reconnect without leaving this page")} onClick={refreshPage} disabled={refreshing}><span className={`mobile-connection-logo ${state.connected ? 'online' : ''}`} role="status" aria-label={state.connected ? t("Connected to your computer") : t("Reconnecting · your agents keep working")} title={state.connected ? t("Connected to your computer") : t("Reconnecting · your agents keep working")}><Nose size={26} /></span></button>
    <div className="mobile-header-title" ref={setResultsHeader} id={view === 'results' ? 'mobile-results-header' : undefined}>{view !== 'results' && <h1>{title}</h1>}{view === 'list' && <span className="mobile-header-count" aria-label={`${items.length} ${items.length === 1 ? 'chat' : 'chats'}`}>· {items.length}</span>}</div>
    {view === 'chat' && session?.open && <button className="mobile-icon" aria-label={t("Close chat")} title={t("Close chat")} disabled={!state.connected || closing} onClick={() => void closeChat()}><Icon name="trash" size={19} /></button>}
    <nav className="mobile-main-nav" aria-label={t("Mobile sections")}>
      {view === 'list' && <><button className="mobile-icon" aria-label={t("New chat")} title={t("New chat")} onClick={() => setCreating(true)} disabled={!state.connected}><Icon name="plus" size={19} /></button><button className={`mobile-icon ${history ? 'active' : ''}`} aria-label={t("History")} title={history ? t("Show active chats") : t("Chat history")} aria-pressed={history} onClick={() => setMobileHistory(!history)}><Icon name="history" size={19} /></button></>}
      <button className={`mobile-icon ${view === 'chat' || (view === 'list' && !history) ? 'active' : ''}`} aria-label={t("Chats")} title={t("Chats")} aria-current={view === 'chat' || (view === 'list' && !history) ? 'page' : undefined} onClick={() => { setMobileHistory(false); setMobileView(session ? 'chat' : 'list') }}><Icon name="chats" size={19} /></button>
      <button className={`mobile-icon ${view === 'results' ? 'active' : ''}`} aria-label={t("Results")} title={t("Workspace")} aria-current={view === 'results' ? 'page' : undefined} onClick={() => setMobileView('results')}><Icon name="workspace" size={19} /></button>
    </nav>
    <button className="mobile-icon" aria-label={t("Phone settings")} title={t("Phone settings")} onClick={() => setSettings(!settings)}><Icon name="phone" size={19} /></button>
  </header>
    {installation.available && !installation.dismissed && <aside className="mobile-install" aria-label={t("Install Dev Space")}><div><strong>{t("Keep Dev Space on your phone")}</strong><p>{t("Add the star to your Home Screen and open it as an app.")}</p></div><button onClick={() => void installation.install()} disabled={installation.busy}>{t("Install")}</button><button className="mobile-icon" aria-label={t("Not now")} title={t("Not now")} onClick={installation.dismiss}><Icon name="close" size={17} /></button></aside>}
    {installation.error && <p className="mobile-error" role="alert">{t(installation.error)}</p>}
    {!state.connected && <div className="mobile-offline" role="status">{state.error && t(state.error) || t("Reconnecting… Keep Tailscale connected and your computer awake.")}</div>}
    {closeError && <div className="mobile-error" role="alert">{t(closeError)}<button className="mobile-icon" aria-label={t("Dismiss close error")} onClick={() => setCloseError('')}><Icon name="close" size={15} /></button></div>}
    {settings && <div className="mobile-device-settings"><strong>{state.device?.name}</strong><p>{t("Chats run on your computer. Switching views here leaves your desktop view alone.")}</p>{installation.installed ? <p>{t("Dev Space is installed on this phone.")}</p> : installation.available ? <button onClick={() => void installation.install()} disabled={installation.busy}>{t("Install Dev Space")}</button> : <p>{t("To add Dev Space to your Home Screen, open your browser’s menu and choose Install app or Add to Home Screen. On iPhone, use Safari’s Share menu.")}</p>}<LanguagePicker /><ReadingVoiceSettings /><DictationSettings info={state.dictation} onChange={chooseMobileDictation} disabled={!state.connected} /><button onClick={() => { if (window.confirm(t("Disconnect this phone from Dev Space?"))) void disconnectMobile() }}>{t("Disconnect this phone")}</button></div>}
    <div className="mobile-view-host"><div className="mobile-persistent-view" aria-hidden={view !== 'results'} inert={view !== 'results'}><Results header={view === 'results' ? resultsHeader : null} active={view === 'results'} /></div>{session && <div className="mobile-persistent-view" aria-hidden={view !== 'chat'} inert={view !== 'chat'}><Conversation key={session.id} session={session} active={view === 'chat'} /></div>}{view === 'list' && <main className="mobile-chat-list"><label className="mobile-search"><Icon name="search" size={17} /><input aria-label={t("Find a chat")} placeholder={t("Find a conversation…")} value={query} onChange={event => setQuery(event.target.value)} /></label><div className="mobile-chat-cards">{items.map(item => <button className={`mobile-chat-card ${item.activity === 'working' ? 'working' : ''}`} key={item.id} onClick={() => open(item.id)} style={{ '--chat-color': item.tabColor || state.agents.find(agent => agent.id === item.agent)?.color || '#d7aabd' } as React.CSSProperties}><span className="mobile-agent-icon"><AgentLogo agent={item.agent} size={24} />{item.unread && <i />}</span><span className="mobile-card-copy"><strong>{item.name}{item.pinned && <Icon name="pin" size={12} />}</strong><small>{state.agents.find(agent => agent.id === item.agent)?.label || item.agent} · {t(chatActivityLabel(item))}</small>{item.preview && <p>{item.preview}</p>}</span><Icon name="arrow" size={15} /></button>)}{!items.length && <p className="mobile-list-empty">{query ? t("No matching chats.") : t("Open a chat to give your next idea a place.")}</p>}</div><p className="mobile-list-foot">{t("A thought on your phone.")}<br />{t("A task on your computer.")}</p></main>}</div>
    {creating && <NewChat close={() => setCreating(false)} opened={open} />}
  </div>
}
