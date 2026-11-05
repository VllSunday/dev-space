import { isMac, modKey } from './platform'

// One window-level listener chooses one existing recorder. Capture prevents the
// shortcut (or Escape while recording) from reaching xterm and the running agent.
export function installDictationShortcut() {
  const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation() }
  const click = (root: HTMLElement, selector: string) => {
    const button = root.querySelector<HTMLButtonElement>(selector)
    if (button && !button.disabled) button.click()
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return
    const roots = [...document.querySelectorAll<HTMLElement>('[data-dictation-shortcut="true"]')]
    const recording = roots.find(root => root.dataset.dictationPhase === 'recording')
    if (event.code === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && recording) {
      consume(event)
      if (!event.repeat) click(recording, '[data-dictation-cancel]')
      return
    }
    if (!modKey(event) || !event.shiftKey || event.altKey || (isMac ? event.ctrlKey : event.metaKey) || event.code !== 'Space') return
    consume(event)
    if (event.repeat) return
    if (recording) { click(recording, '[data-dictation-toggle]'); return }
    // An open settings dialog must not start a recorder behind itself.
    const modal = document.querySelector('dialog:modal')
    const visible = roots.filter(root => root.getClientRects().length && getComputedStyle(root).visibility !== 'hidden' && !root.closest('[inert]') && (!modal || modal.contains(root)))
    const focused = document.activeElement
    const focusedPane = focused instanceof HTMLElement ? focused.closest('[data-agent-pane]') : null
    const target = visible.find(root => root.closest('[data-agent-pane]')?.contains(focused)) || visible.find(root => root.closest('form, .chat-context')?.contains(focused))
    if (focusedPane && !target) return
    // A different editor is not a request to dictate into a chat in the background.
    if (!target && focused instanceof HTMLElement && focused.matches('input, textarea, [contenteditable="true"], [role="textbox"]') && !focused.closest('.xterm')) return
    const root = target || visible.find(root => root.closest('[data-pane-active="true"]')) || visible.find(root => root.closest('.ds-capture')) || visible.find(root => !root.closest('[data-agent-pane]'))
    if (!root) return
    if (root.dataset.dictationPhase === 'idle') click(root, '[data-dictation-toggle]')
    else if (root.dataset.dictationPhase === 'saved') click(root, '[data-dictation-retry]')
    // Permission and transcription are already running; do not restart them.
  }
  window.addEventListener('keydown', keydown, true)
  return () => window.removeEventListener('keydown', keydown, true)
}
