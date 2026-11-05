import { t } from '../i18n/index'

export const dictationPasteEvent = 'mrmak-dictation-paste'
export type DictationPasteRequest = { id: string; text: string; delivery?: Promise<void> }

export async function pasteDictation(id: string, text: string) {
  const detail: DictationPasteRequest = { id, text }
  window.dispatchEvent(new CustomEvent(dictationPasteEvent, { detail }))
  if (!detail.delivery) throw new Error(t('Open the terminal and try inserting the recording again.'))
  await detail.delivery
}

export function dictationInput(text: string, bracketed: boolean) {
  // Treat recognized speech as text, never terminal control keys or Enter.
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
  return bracketed ? `\x1b[200~${clean}\x1b[201~` : clean.replace(/\n/g, ' ')
}
