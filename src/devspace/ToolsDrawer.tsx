import { useEffect, useRef, useState, type ReactNode } from 'react'

export default function ToolsDrawer({ width, resize, children }: { width: number; resize: (value: number) => void; children: ReactNode }) {
  const [viewport, setViewport] = useState(() => innerWidth)
  const drag = useRef<{ x: number; width: number } | null>(null)
  useEffect(() => { const update = () => setViewport(innerWidth); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }, [])
  const maximum = Math.max(1, viewport - 64), minimum = Math.min(320, maximum)
  const visibleWidth = Math.max(minimum, Math.min(maximum, width))
  const change = (value: number) => resize(Math.round(Math.max(minimum, Math.min(maximum, value))))
  return <aside className="ds-tools-overlay" aria-label="Файлы, навыки и MCP" style={{ width: visibleWidth }}>
    <div className="ds-tools-resizer" role="separator" tabIndex={0} aria-label="Ширина панели инструментов" aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={visibleWidth} title="Потяните для изменения ширины · двойной щелчок — сброс"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width: visibleWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (drag.current) change(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }} onDoubleClick={() => change(520)}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); change(event.key === 'Home' ? 520 : visibleWidth + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 64 : 16)) }}/>
    {children}
  </aside>
}
