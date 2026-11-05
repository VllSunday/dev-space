import { ru } from './ru.ts'

export type Locale = 'ru' | 'en'
export const localeKey = 'mrmak.language'
export const isLocale = (value: unknown): value is Locale => value === 'ru' || value === 'en'
const listeners = new Set<() => void>()
const readLocale = (): Locale => {
  try { const saved = localStorage.getItem(localeKey); if (isLocale(saved)) return saved } catch { /* Storage may be disabled. */ }
  return 'ru'
}
let locale = readLocale()
export const getLocale = () => locale
export const intlLocale = () => locale === 'ru' ? 'ru-RU' : 'en-US'
export function setLocale(value: Locale) {
  if (!isLocale(value)) return
  try { localStorage.setItem(localeKey, value) } catch { /* Keep the choice for this visit. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = value
  if (locale === value) return
  locale = value
  listeners.forEach(listener => listener())
}
export function subscribeLocale(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
if (typeof window !== 'undefined') {
  document.documentElement.lang = locale
  window.addEventListener('storage', event => {
    if (event.key === localeKey || event.key === null) setLocale(readLocale())
  })
}

/** English source strings are stable keys and the fallback for unknown external errors.
 * Translate UI labels only: never pass user messages, document content or file names here.
 */
export function t(source: string, ...values: (string | number | null | undefined)[]): string {
  const message = locale === 'ru' ? ru[source] ?? source : source
  return message.replace(/\{(\d+)\}/g, (token, index: string) => values[Number(index)] == null ? token : String(values[Number(index)]))
}

const nouns = {
  chat: ['chat', 'chats', 'чат', 'чата', 'чатов'],
  card: ['card', 'cards', 'карточка', 'карточки', 'карточек'],
  category: ['category', 'categories', 'категория', 'категории', 'категорий'],
  entry: ['entry', 'entries', 'запись', 'записи', 'записей'],
  page: ['page', 'pages', 'страница', 'страницы', 'страниц'],
  file: ['file', 'files', 'файл', 'файла', 'файлов'],
  image: ['image', 'images', 'изображение', 'изображения', 'изображений'],
  finding: ['finding', 'findings', 'замечание', 'замечания', 'замечаний'],
  message: ['message', 'messages', 'сообщение', 'сообщения', 'сообщений'],
  step: ['step', 'steps', 'этап', 'этапа', 'этапов'],
  tool: ['tool', 'tools', 'инструмент', 'инструмента', 'инструментов'],
  tab: ['tab', 'tabs', 'вкладка', 'вкладки', 'вкладок'],
  agent: ['agent', 'agents', 'агент', 'агента', 'агентов'],
  command: ['command', 'commands', 'команда', 'команды', 'команд'],
} as const
export function countLabel(count: number, noun: keyof typeof nouns) {
  const forms = nouns[noun]
  const rule = new Intl.PluralRules(intlLocale()).select(count)
  const word = locale === 'en' ? forms[rule === 'one' ? 0 : 1] : forms[rule === 'one' ? 2 : rule === 'few' ? 3 : 4]
  return `${count.toLocaleString(intlLocale())} ${word}`
}

export function formatDate(value: string) {
  // A calendar date has no timezone; avoid moving it to the previous day.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}
