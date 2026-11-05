import { useEffect, useState } from 'react'
import { api, fontBytes, onServiceEvent, reportError } from './client'
import type { CustomFont, DesktopState } from './types'

export const displayDefaults = { interfaceFont: 'Segoe UI', terminalFont: 'Cascadia Code', zoom: 100 }
export const terminalFontStack = (name = displayDefaults.terminalFont) => `${JSON.stringify(name)}, Consolas, "SF Mono", monospace`
export function useDisplay(state: DesktopState) {
  const display = state.settings.display || displayDefaults
  const [fontVersion, setFontVersion] = useState(0)
  useEffect(() => onServiceEvent(event => { if (event.type === 'appearance-fonts') setFontVersion(version => version + 1) }), [])
  useEffect(() => {
    if (!state.ready) return
    let cancelled = false
    const faces: FontFace[] = []
    document.documentElement.style.setProperty('--font-body', `${JSON.stringify(display.interfaceFont)}, system-ui, sans-serif`)
    document.documentElement.style.setProperty('--font-display', `${JSON.stringify(display.interfaceFont)}, system-ui, sans-serif`)
    document.documentElement.style.setProperty('--font-mono', terminalFontStack(display.terminalFont))
    void (async () => {
      const fonts = await api<CustomFont[]>('/appearance/fonts')
      for (const family of new Set([display.interfaceFont, display.terminalFont])) {
        const font = fonts.find(item => item.family === family)
        if (!font) continue
        const face = await new FontFace(JSON.stringify(font.family), await fontBytes(font.id)).load()
        if (cancelled) return
        document.fonts.add(face); faces.push(face)
      }
      if (!cancelled) window.dispatchEvent(new Event('devspace-fonts-ready'))
    })().catch(error => { if (!cancelled) reportError(error) })
    return () => { cancelled = true; for (const face of faces) document.fonts.delete(face) }
  }, [state.ready, display.interfaceFont, display.terminalFont, fontVersion])
  useEffect(() => {
    if (state.ready && state.connected) void api('/window', { window: 'workspace', action: 'zoom', value: display.zoom / 100 }).catch(reportError)
  }, [state.ready, state.connected, display.zoom])
}
