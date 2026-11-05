import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { emptyRoute, parseRoute, routeHash, type SpaceRoute } from './spaceRoute'
type Entry={route:SpaceRoute;scroll:number;index:number}
export function useSpaceNavigation(initial:Partial<SpaceRoute>,canvas:RefObject<HTMLElement|null>) {
 const [route,setRoute]=useState<SpaceRoute>(()=>parseRoute(location.hash)||{...emptyRoute,...initial})
 const current=useRef(route);current.current=route
 const saved=history.state?.space as Entry|undefined
 const index=useRef(saved&&parseRoute(location.hash)?saved.index:0), pendingScroll=useRef<number|null>(null)
 const scroller=()=>canvas.current?.querySelector<HTMLElement>('.ds-editor-scroll,.ds-material-scroll,.ds-task-list')
 const navigate=(patch:Partial<SpaceRoute>,replace=false)=>{
  const next={...current.current,...patch}
  if(patch.view&&patch.view!=='page')next.pageId=''
  if(next.view!=='materials')next.gallery=false
  if(!next.projectId||JSON.stringify(next)===JSON.stringify(current.current)&&!replace)return
  const previous=history.state?.space as Entry|undefined
  const restored=replace&&previous?.route&&routeHash(previous.route)===routeHash(next)?previous:null
  const old={route:current.current,scroll:scroller()?.scrollTop||0,index:index.current}
  if(!replace&&current.current.projectId)history.replaceState({...history.state,space:old},'',routeHash(current.current))
  if(!replace)index.current++
  if(restored)index.current=restored.index
  const entry:Entry={route:next,scroll:restored?.scroll||0,index:index.current}
  history[replace?'replaceState':'pushState']({...history.state,space:entry},'',routeHash(next))
  pendingScroll.current=restored?restored.scroll:next.materialId?null:0;current.current=next;setRoute(next)
 }
 useEffect(()=>{
  const restore=()=>{const entry=history.state?.space as Entry|undefined,next=parseRoute(location.hash);if(!next)return;index.current=entry?.index||0;pendingScroll.current=entry?entry.scroll:next.materialId?null:0;current.current=next;setRoute(next)}
  window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore)
  return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore)}
 },[])
 useEffect(()=>{let frame=0;const remember=(event:Event)=>{if(event.target!==scroller())return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const route=current.current;if(!route.projectId)return;history.replaceState({...history.state,space:{route,scroll:scroller()?.scrollTop||0,index:index.current}},'',routeHash(route))})};window.addEventListener('scroll',remember,true);return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',remember,true)}},[])
 useLayoutEffect(()=>{if(pendingScroll.current!==null){const element=scroller();if(element){element.scrollTop=pendingScroll.current;pendingScroll.current=null}}},[route])
 return {route,navigate,canGoBack:index.current>0,back:()=>history.back()}
}
