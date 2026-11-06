import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { contentUrl } from '../desktop/client'
import { ZoomImage } from '../components/ImagePreview'
import { MarkdownView } from '../components/MarkdownDocument'
import { toMarkdown, type Block } from './model'
import { EditableText } from './PageEditor'
import PageModelViewer from './PageModelViewer'

export function BlockHandle({label,up,down,remove,dragStart}:{label:string;up?:()=>void;down?:()=>void;remove:()=>void;dragStart?:(event:React.DragEvent)=>void}){
 const [rect,setRect]=useState<DOMRect|null>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const close=()=>{setRect(null);trigger.current?.focus({preventScroll:true})}
 useEffect(()=>{if(!rect)return;const dismiss=(event:Event)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setRect(null)},key=(event:KeyboardEvent)=>{if(event.key==='Escape')close()};window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',key);window.addEventListener('resize',close);const frame=requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',key);window.removeEventListener('resize',close)}},[rect])
 const action=(fn:()=>void)=>{setRect(null);fn()}
 return <><button ref={trigger} draggable={!!dragStart} onDragStart={dragStart} className="ds-block-handle" aria-label={'Действия: '+label} title="Перетащить блок или открыть действия" aria-haspopup="menu" aria-expanded={!!rect} onClick={()=>setRect(rect?null:trigger.current!.getBoundingClientRect())}>⠿</button>{rect&&createPortal(<div ref={menu} className="ds-block-menu" role="menu" aria-label="Действия блока" style={{left:Math.max(8,Math.min(rect.left,innerWidth-238)),top:Math.max(8,Math.min(rect.bottom+5,innerHeight-190))}}><button role="menuitem" disabled={!up} onClick={()=>up&&action(up)}>↑ Переместить выше</button><button role="menuitem" disabled={!down} onClick={()=>down&&action(down)}>↓ Переместить ниже</button><button role="menuitem" className="ds-danger" onClick={()=>action(remove)}>Удалить блок</button><button role="menuitem" onClick={close}>Закрыть · Esc</button></div>,document.body)}</>
}
export function ContentBlock({block,editing=false,update,draftPrefix,mutate}:{block:Block;editing?:boolean;update?:(b:Block)=>Promise<unknown>;draftPrefix?:string;mutate:(value:Record<string,unknown>)=>Promise<unknown>}){
 if(block.type==='divider')return <hr className="ds-content-divider"/>
 if(block.type==='model')return <PageModelViewer readOnly modelFiles={[{path:block.asset!,name:block.text||'Модель.glb',image:false,size:0}]} materials={[]} mutate={mutate}/>
 if(block.type==='image')return <figure className="ds-content-image"><ZoomImage src={contentUrl('/'+block.asset)} alt={block.text||'Изображение'}/>{editing?<EditableText value={block.text} label="Подпись изображения" draftKey={draftPrefix+':'+block.id} className="ds-caption" commit={text=>update?.({...block,text})}/>:block.text&&<figcaption>{block.text}</figcaption>}</figure>
 if(!editing)return <div className={'ds-content-prose ds-prose-'+block.type}><MarkdownView text={toMarkdown({blocks:[block]})} baseUrl={contentUrl('/')}/></div>
 return <div className={'ds-block ds-block-'+block.type}>{block.type==='check'&&<input type="checkbox" aria-label="Отметить пункт" checked={!!block.checked} onChange={e=>void update?.({...block,checked:e.target.checked}).catch(()=>{})}/>}<EditableText value={block.text} label="Текст блока" draftKey={draftPrefix+':'+block.id} commit={text=>update?.({...block,text})}/></div>
}
