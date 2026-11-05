import { useRef } from 'react'
import { transcribeDesktopAudio } from './client'
import VoiceInput from '../mobile/VoiceInput'
import { useDictation } from './useDictation'
import { pasteDictation } from './terminalDictation'

export default function DictationComposer({ id, connected, running }: { id: string; connected: boolean; running: boolean }) {
  const voiceIds = useRef(new Set<string>())
  const { info: config } = useDictation()
  return <div className="terminal-dictation"><VoiceInput shortcut id={`desktop-chat-${id}`} connected={connected} disabled={!running} config={config} transcriber={transcribeDesktopAudio} onBusy={() => {}} onText={async (text, recordingId) => {
    if (voiceIds.current.has(recordingId)) return
    await pasteDictation(id, text)
    voiceIds.current.add(recordingId)
  }} /></div>
}
