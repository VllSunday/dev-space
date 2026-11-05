import { useEffect, useRef, useState } from 'react'
import { api, fontBytes, onServiceEvent, uploadFont, useDesktop } from '../desktop/client'
import { displayDefaults, terminalFontStack } from '../desktop/display'
import type { CustomFont } from '../desktop/types'

export default function AppearanceSettings() {
  const { settings } = useDesktop(), display = settings.display || displayDefaults
  const [fonts, setFonts] = useState<CustomFont[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    const refresh = () => void api<CustomFont[]>('/appearance/fonts').then(value => { if (active) setFonts(value) }).catch(error => { if (active) setError(error.message) })
    refresh(); const off = onServiceEvent(event => { if (event.type === 'appearance-fonts') refresh() })
    return () => { active = false; off() }
  }, [])
  async function save(patch: object) {
    setError(''); setBusy(true)
    try { await api('/settings', patch) } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function upload(fontFile?: File) {
    if (!fontFile) return
    setBusy(true); setError('')
    try {
      const font = await uploadFont(fontFile)
      await new FontFace(JSON.stringify(font.family), await fontBytes(font.id)).load()
      await api('/settings', { display: { interfaceFont: font.family } })
    } catch (error) { setError('Не удалось применить шрифт: ' + (error as Error).message) } finally { setBusy(false) }
  }
  return <section className="ds-appearance" aria-label="Оформление">
    <h3>Оформление</h3>
    <p>Шрифты и масштаб сохраняются на этом компьютере.</p>
    <datalist id="ds-font-names">{[...new Set(['Segoe UI', 'Arial', 'Inter', 'Geist', 'Cascadia Code', 'Consolas', 'JetBrains Mono', ...fonts.map(font => font.family)])].map(name => <option key={name} value={name}/>)}</datalist>
    <label className="ds-appearance-row"><span>Шрифт интерфейса</span><input key={'ui-'+display.interfaceFont} list="ds-font-names" defaultValue={display.interfaceFont} aria-label="Шрифт интерфейса" disabled={busy} maxLength={100} onBlur={event => { if (event.target.value.trim() !== display.interfaceFont) void save({ display: { interfaceFont: event.target.value } }) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/></label>
    <label className="ds-appearance-row"><span>Шрифт терминала</span><input key={'term-'+display.terminalFont} list="ds-font-names" defaultValue={display.terminalFont} aria-label="Шрифт терминала" disabled={busy} maxLength={100} onBlur={event => { if (event.target.value.trim() !== display.terminalFont) void save({ display: { terminalFont: event.target.value } }) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}/></label>
    <div className="ds-appearance-row"><span>Размер текста терминала</span><div className="ds-stepper"><button disabled={busy || (settings.terminalFontSize || 13) <= 10} aria-label="Уменьшить шрифт терминала" onClick={() => void save({ terminalFontSize: (settings.terminalFontSize || 13) - 1 })}>−</button><output>{settings.terminalFontSize || 13}</output><button disabled={busy || (settings.terminalFontSize || 13) >= 24} aria-label="Увеличить шрифт терминала" onClick={() => void save({ terminalFontSize: (settings.terminalFontSize || 13) + 1 })}>+</button></div></div>
    <div className="ds-appearance-row"><span>Масштаб всего приложения<small>Панели, текст и терминалы</small></span><div className="ds-stepper"><button disabled={busy || display.zoom <= 75} aria-label="Уменьшить масштаб" onClick={() => void save({ display: { zoom: display.zoom - 5 } })}>−</button><output>{display.zoom}%</output><button disabled={busy || display.zoom >= 175} aria-label="Увеличить масштаб" onClick={() => void save({ display: { zoom: display.zoom + 5 } })}>+</button></div></div>
    <div className="ds-font-preview"><span>Проект · Материалы · Агент работает</span><code style={{ fontFamily: terminalFontStack(display.terminalFont) }}>const workspace = 0123456789;</code></div>
    <div className="ds-font-actions"><button className="ds-secondary" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Применяем…' : 'Загрузить свой шрифт'}</button><button disabled={busy} onClick={() => void save({ display: displayDefaults, terminalFontSize: 13 })}>Сбросить оформление</button></div>
    <input ref={file} hidden type="file" accept=".ttf,.otf,.woff,.woff2" onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }}/>
    <p>Выберите установленный шрифт по имени или загрузите TTF, OTF, WOFF, WOFF2 до 12 МБ.</p>
    {fonts.map(font => <div key={font.id} className="ds-uploaded-font"><span>{font.name}</span><button disabled={busy} aria-label={'Удалить шрифт '+font.name} onClick={async () => { setBusy(true); try { await api(`/appearance/fonts/${font.id}`, {}, 'DELETE') } catch (error) { setError((error as Error).message) } finally { setBusy(false) } }}>Удалить</button></div>)}
    {error && <p role="alert" className="ds-appearance-error">{error}</p>}
  </section>
}
