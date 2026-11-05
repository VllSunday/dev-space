import { useEffect, useRef, useState } from 'react'
import { api, pickFiles } from '../desktop/client'

interface LocalSettings { python: string; model: string; device: string; available?: boolean; result?: { device: string; computeType: string } }
export default function LocalWhisperSetup({ disabled = false, onBusy }: { disabled?: boolean; onBusy: (value: boolean) => void }) {
  const [value, setValue] = useState<LocalSettings>({ python: '', model: '', device: 'auto' })
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    let active = true
    void api<LocalSettings>('/dictation/local').then(value => { if (active) setValue(value) }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.current?.abort() }
  }, [])
  async function choose(key: 'python' | 'model') {
    setError('')
    try { const selected = await pickFiles(); if (selected[0]) setValue(value => ({ ...value, [key]: selected[0] })) } catch (error) { setError((error as Error).message) }
  }
  async function connect() {
    const request = new AbortController(); controller.current = request
    setBusy(true); onBusy(true); setError(''); setMessage('Проверяем Python и загружаем модель…')
    try {
      const result = await api<LocalSettings>('/dictation/local', value, 'POST', { signal: request.signal })
      setValue(result); setMessage(`Подключено · ${result.result?.device === 'cuda' ? 'NVIDIA CUDA' : 'CPU'}. Следующая запись использует эту модель.`)
    } catch (error) { setMessage(''); if (!request.signal.aborted) setError((error as Error).message) }
    finally { controller.current = null; setBusy(false); onBusy(false) }
  }
  return <details className="ds-whisper-setup"><summary>Подключить или изменить модель Whisper</summary><div>
    <p>Выберите Python с установленным faster-whisper и модель в формате CTranslate2. Модель определяется по файлу <code>model.bin</code>.</p>
    <label>Python<div><input aria-label="Python для Whisper" placeholder="Путь к python.exe" value={value.python} disabled={disabled || loading || busy} onChange={event => setValue({ ...value, python: event.target.value })}/><button type="button" className="ds-secondary" disabled={disabled || loading || busy} onClick={() => void choose('python')}>Выбрать Python</button></div></label>
    <label>Модель<div><input aria-label="Модель Whisper" placeholder="Папка модели или файл model.bin" value={value.model} disabled={disabled || loading || busy} onChange={event => setValue({ ...value, model: event.target.value })}/><button type="button" className="ds-secondary" disabled={disabled || loading || busy} onClick={() => void choose('model')}>Выбрать model.bin</button></div></label>
    <label>Устройство<select aria-label="Устройство Whisper" value={value.device} disabled={disabled || loading || busy} onChange={event => setValue({ ...value, device: event.target.value })}><option value="auto">Авто · GPU при доступности, иначе CPU</option><option value="cpu">CPU · процессор</option><option value="cuda">NVIDIA CUDA · видеокарта</option></select></label>
    <div className="ds-whisper-actions"><button type="button" className="ds-primary" disabled={disabled || loading || busy || !value.python.trim() || !value.model.trim()} onClick={() => void connect()}>{busy ? 'Проверяем подключение…' : 'Проверить и подключить'}</button>{busy && <button type="button" onClick={() => controller.current?.abort()}>Отменить</button>}</div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <p>Подойдут tiny, base, small, medium, large и другие совместимые Whisper-модели. Файлы .pt и GGUF напрямую не подключаются. Аудио остаётся на компьютере.</p>
  </div></details>
}
