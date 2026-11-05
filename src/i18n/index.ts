import { useSyncExternalStore } from 'react'
import { getLocale, subscribeLocale } from './core.ts'
export { t, countLabel, intlLocale, formatDate, getLocale, setLocale, isLocale } from './core.ts'
export type { Locale } from './core.ts'

/** Subscribing does not remount the component, so drafts, terminals and viewers survive. */
export const useLocale = () => useSyncExternalStore(subscribeLocale, getLocale, getLocale)
