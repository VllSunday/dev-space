import { t, useLocale } from '../i18n/index.ts'
import { useEffect, useState } from 'react'
import { mobileApi } from './client'
import { readingVoices, readingVoiceChanged, saveReadingVoice, savedReadingVoice } from './readingVoices'
export default function ReadingVoiceSettings() {
  useLocale()
  const [saved, setSaved] = useState(savedReadingVoice), [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => { let active = true; void mobileApi<{ available: boolean }>('/read-aloud').then(info => { if (active) setReady(info.available) }).catch(() => { if (active) setReady(false) }); return () => { active = false } }, [])
  return <fieldset className="mobile-reading-settings"><legend>{t("Read aloud")}</legend><label>{t("English voice")}<select aria-label={t("English reading voice")} value={saved} onChange={event => { const value = event.target.value; setSaved(value); saveReadingVoice(value); window.dispatchEvent(new Event(readingVoiceChanged)) }}>{readingVoices.map(voice => <option key={voice.id} value={voice.id}>{t(voice.label)}</option>)}</select></label>{ready === false && <p>{t("Set up local Read aloud on your computer to enable these voices.")}</p>}</fieldset>
}
