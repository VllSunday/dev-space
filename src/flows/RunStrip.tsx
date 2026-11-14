import { Icon } from '../desktop/Icons'
import type { FlowRun } from './types'
import { runStatus } from './types'
import './flows.css'

// The strip of steps above the terminals of a running flow. The terminals below
// stay ordinary terminals: you can type into any of them.
export default function RunStrip({ run, open, focus }: { run: FlowRun; open: () => void; focus: (sessionId: string) => void }) {
  return <div className={'fl-strip ' + run.status} role="status" aria-label={'Флоу ' + run.name}>
    <div className="fl-strip-top">
      <Icon name="history" size={13} /><button type="button" className="fl-strip-name" onClick={open} title="Открыть флоу">{run.name}</button>
      <span className="fl-strip-item" title={run.item?.title}>{run.item ? (run.item.key ? run.item.key + ' ' : '') + run.item.title : ''}</span>
      <button type="button" className={'fl-status ' + run.status} onClick={open} title={run.reason || undefined}>{runStatus[run.status]}</button>
    </div>
    <div className="fl-strip-steps">
      <ol className="fl-steps">{run.steps.map(step => <li key={step.id} className={step.state} aria-current={step.state === 'current' ? 'step' : undefined} title={step.kind === 'agent' ? 'делает агент' : step.kind === 'person' ? 'решаете вы' : 'делает код'}><i>{step.state === 'done' && <Icon name="check" size={10} />}</i><span>{step.title}</span></li>)}</ol>
      <span className="fl-roles">{Object.entries(run.roles).filter(([, role]) => role.sessionId).map(([id, role]) => <button type="button" key={id} className={'fl-role' + (role.active ? ' active' : '')} onClick={() => focus(role.sessionId!)} title={'Перейти к терминалу: ' + role.title}>{role.title}</button>)}</span>
    </div>
  </div>
}
