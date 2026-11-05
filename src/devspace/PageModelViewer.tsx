import { useEffect, useRef, useState } from 'react'
import { contentUrl, uploadSpaceFile } from '../desktop/client'
import { ModelViewer, type ShadingMode } from '../lib/three/viewer'
import type { Material, Page, SpaceFile } from './model'
import './page-model-viewer.css'

export default function PageModelViewer({ page, materials, mutate, modelFiles, readOnly=false }: { page?: Page; materials: Material[]; mutate: (action: Record<string, unknown>) => Promise<unknown>; modelFiles?:SpaceFile[];readOnly?:boolean }) {
  const marker = '3D viewer: ' + page?.id
  const models = modelFiles || materials.filter(m => page && !m.archived && m.projectId === page.projectId && (m.modelPageId === page.id || m.text === marker)).flatMap(m => m.files.filter(f => /\.glb$/i.test(f.name)))
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [status, setStatus] = useState(''), [mode, setMode] = useState<ShadingMode>('pbr')
  const host = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), viewer = useRef<ModelViewer | null>(null)
  const file = models.find(f => f.path === selected) || models[0]
  useEffect(() => {
    if (!host.current || !file) return
    let active = true
    let instance: ModelViewer | undefined
    setStatus('Загрузка модели…')
    try {
      instance = new ModelViewer(host.current)
      viewer.current = instance
      instance.setAutoRotate(false)
      instance.setMode(mode)
      void instance.load(contentUrl('/' + file.path)).then(() => { if (active) setStatus('') }).catch(() => { if (active) setStatus('Не удалось открыть модель. Проверьте GLB и встроенные текстуры.') })
    } catch { setStatus('Не удалось запустить 3D. Проверьте поддержку WebGL в приложении.') }
    return () => { active = false; instance?.dispose(); viewer.current = null }
  // Mode changes are applied without reloading the model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path])
  useEffect(() => { viewer.current?.setMode(mode) }, [mode])
  const upload = async (files: File[]) => {
    if (busy || readOnly || !page) return
    setError('')
    if (!files.length) return
    if (files.some(f => !/\.glb$/i.test(f.name))) { setError('Выберите GLB. В Blender: Экспорт → glTF 2.0 → GLB, с текстурами внутри файла.'); return }
    setBusy(true)
    try {
      for (const f of files) {
        const header = new DataView(await f.slice(0, 12).arrayBuffer())
        if (header.byteLength < 12 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2) throw new Error('Файл «' + f.name + '» не является GLB 2.0.')
        const saved = await uploadSpaceFile(f)
        await mutate({ action: 'create-material', projectId: page.projectId, topicId: page.topicId === 'all' ? 'unfiled' : page.topicId, title: f.name, modelPageId: page.id, text: '3D-модель для страницы «' + page.title + '»', files: [saved] })
        setSelected(saved.path)
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className="ds-model-viewer" aria-label="Просмотр 3D-моделей" onDragOver={e => { if(!readOnly){e.preventDefault(); e.stopPropagation()} }} onDrop={e => { if(!readOnly){e.preventDefault(); e.stopPropagation(); void upload([...e.dataTransfer.files])} }}>
    <div className="ds-model-tools">
      {!readOnly&&<button disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Сохранение…' : 'Загрузить 3D-модель'}</button>}
      <input ref={input} hidden type="file" accept=".glb" multiple onChange={e => { void upload([...e.currentTarget.files || []]); e.currentTarget.value = '' }} />
      {!!models.length && <select aria-label="Модель" value={file?.path} onChange={e => setSelected(e.target.value)}>{models.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}</select>}
      {!!file && <button onClick={() => viewer.current?.frame()}>Сбросить вид</button>}
      {!!file && <select aria-label="Отображение модели" value={mode} onChange={e => setMode(e.target.value as ShadingMode)}><option value="pbr">Текстуры</option><option value="solid">Без текстур</option><option value="wire">Сетка</option><option value="normals">Нормали</option></select>}
    </div>
    <div className="ds-model-canvas" ref={host} aria-label="3D-сцена" />
    {!file && <p>Перетащите сюда GLB или нажмите «Загрузить 3D-модель».</p>}
    <p role="status">{status || (file ? 'Вращение — левая кнопка мыши · приближение — колёсико · сдвиг — правая кнопка' : 'Модели сохраняются в материалах темы и остаются доступны после перезапуска.')}</p>
    {error && <p role="alert">{error}</p>}
  </section>
}
