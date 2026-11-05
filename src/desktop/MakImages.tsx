import { t, useLocale } from '../i18n/index.ts'
import { useEffect, useState } from 'react'
import { ZoomImage } from '../components/ImagePreview'
import { api } from './client'
import type { Preview } from './types'

export default function MakImages({ paths }: { paths: string[] }) {
  useLocale()
  const [images, setImages] = useState<Preview[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all(paths.map(path => api<Preview>(`/preview?path=${encodeURIComponent(path)}`).catch(() => null))).then(result => {
      if (!cancelled) setImages(result.filter((item): item is Preview => !!item))
    })
    return () => { cancelled = true }
  }, [paths])
  return <div className="voice-attachments sent" aria-label={t("Sent images")}>{images?.map(image => <div className="voice-attachment" key={image.path}><ZoomImage src={image.url} alt={image.name} /></div>)}{images && images.length < paths.length && <small>{t("Some attached images are unavailable.")}</small>}</div>
}
