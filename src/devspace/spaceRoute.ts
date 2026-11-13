// «board» is the whole board, «zone» one zone up close, «thing» one thing on the whole screen.
export type SpaceView='board'|'zone'|'thing'|'materials'|'page'|'tasks'|'archive'
export interface SpaceRoute { projectId:string;topicId:string;view:SpaceView;pageId:string;gallery:boolean;materialId:string;filePath:string;editing?:boolean;boardId:string;zoneId:string;thing:string }
export const emptyRoute:SpaceRoute={projectId:'',topicId:'all',view:'board',pageId:'',gallery:false,materialId:'',filePath:'',boardId:'',zoneId:'',thing:''}
const valid=(value:string)=>value.length>0&&value.length<=300&&!/[\x00-\x1f\x7f]/.test(value)
export function routeHash(route:SpaceRoute) {
 const target=route.view==='page'?route.pageId:route.topicId
 const query=new URLSearchParams()
 if(route.gallery&&route.view==='materials')query.set('gallery','1')
 if(route.editing)query.set('edit','1')
 if(route.materialId)query.set('item',route.materialId)
 if(route.filePath)query.set('file',route.filePath)
 if(route.boardId)query.set('board',route.boardId)
 if(route.zoneId)query.set('zone',route.zoneId)
 if(route.thing&&route.view==='thing')query.set('thing',route.thing)
 return '#/space/'+[route.projectId,route.view,target||'all'].map(encodeURIComponent).join('/')+(query.size?'?'+query.toString():'')
}
export function parseRoute(hash:string):SpaceRoute|null {
 try {
  const match=/^#\/space\/([^/]+)\/(board|zone|thing|materials|page|tasks|archive)\/([^?]+)(?:\?(.*))?$/.exec(hash)
  if(!match)return null
  const projectId=decodeURIComponent(match[1]),target=decodeURIComponent(match[3]),query=new URLSearchParams(match[4]||'')
  if(!valid(projectId)||!valid(target))return null
  const materialId=query.get('item')||'',filePath=query.get('file')||''
  if(materialId&&!valid(materialId)||filePath&&!/^workspace\/devspace\/assets\/[\w.-]+$/.test(filePath))return null
  const view=match[2] as SpaceView
  const boardId=query.get('board')||'',zoneId=query.get('zone')||'',thing=query.get('thing')||''
  if([boardId,zoneId,thing].some(value=>value&&!valid(value)))return null
  return {...emptyRoute,boardId,zoneId,thing,projectId,view,topicId:view==='page'||!['materials','archive'].includes(view)?'all':target,pageId:view==='page'?target:'',gallery:view==='materials'&&query.get('gallery')==='1',materialId,filePath,...(query.get('edit')==='1'?{editing:true}:{})}
 }catch{return null}
}
