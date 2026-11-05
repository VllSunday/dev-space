import { t } from '../i18n/core.ts'

export const CATEGORY_ICONS: Record<string, string> = {
  'image-gen': '\u{1F3A8}',
  'analytics': '\u{1F4CA}',
  'research': '\u{1F50D}',
  'lead-magnet': '\u{1F9F2}',
  'game': '\u{1F3AE}',
  'dev': '\u{1F6E0}\u{FE0F}',
}

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '\u{1F4C1}'
}

export function categoryLabel(category: string): string {
  const known = ['image-gen', 'analytics', 'research', 'lead-magnet', 'game', 'dev', 'project', 'tools', 'other', 'by date']
  return known.includes(category) ? t(category === 'tools' ? 'Tools' : category) : category.replace(/-/g, ' ')
}
