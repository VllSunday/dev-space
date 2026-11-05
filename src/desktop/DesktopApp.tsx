import { t, useLocale } from '../i18n/index.ts'
import { useEffect } from 'react'
import { dismissError, startDesktop, useDesktop } from './client'
import { Icon } from './Icons'
import { installDictationShortcut } from './dictationShortcut'
import DevSpace from '../devspace/DevSpace'
import './desktop.css'
export default function DesktopApp() {
  useLocale()
  const state=useDesktop()
  useEffect(()=>{startDesktop()},[])
  useEffect(()=>installDictationShortcut(),[])
  if(!state.ready)return <div className="desktop-boot"><img src="/assets/dev-space.png" width="54" height="54" alt=""/><h1>Dev Space</h1><p>{state.error&&t(state.error)||'Открываем рабочую область…'}</p>{state.error&&<button onClick={()=>startDesktop()}>Повторить</button>}</div>
  return <div className="desktop-root workspace-root"><DevSpace/>{state.error&&<div className="desktop-error" role="alert"><span>{t(state.error)}</span><button onClick={dismissError} aria-label="Закрыть"><Icon name="close" size={16}/></button></div>}</div>
}
