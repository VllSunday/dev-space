import { useState } from 'react'
import { api, isDesktop } from '../desktop/client'
import { isLocale, setLocale, t, useLocale } from '../i18n/index.ts'
import './language-picker.css'

export default function LanguagePicker() {
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function change(value: string) {
    if (!isLocale(value)) return
    setBusy(true); setError('')
    try {
      if (isDesktop) await api('/settings', { language: value })
      setLocale(value)
    } catch { setError('Could not save the language. Try again.') }
    finally { setBusy(false) }
  }
  return <div className="language-picker">
    <label>{t('Interface language')}<select aria-label={t('Interface language')} value={locale} disabled={busy} onChange={event => void change(event.target.value)}>
      <option value="ru" lang="ru">Русский</option>
      <option value="en" lang="en">English</option>
    </select></label>
    <p>{t('Changes immediately. Your chats and documents keep their original language.')}</p>
    {error && <p role="alert">{t(error)}</p>}
  </div>
}
