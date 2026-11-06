// Composition references existing page blocks and live project collections.
// Old pages stay readable without a migration or a write on first render.
export function pageFlow(page, project) {
  if (page.flow) return page.flow;
  const collections = page.collections ?? (page.layout === 'wiki' ? project.topics.map(t => ({topicId:t.id,view:'list'})) : []);
  const cover = page.layout === 'wiki' ? page.blocks.find(b => b.type === 'image') : null;
  return [...(cover ? [{id:'flow-'+cover.id,type:'block',blockId:cover.id}] : []),
    {id:'flow-title',type:'title'},
    ...page.blocks.filter(b=>b!==cover).map(b=>({id:'flow-'+b.id,type:'block',blockId:b.id})),
    ...collections.map(c=>({id:'flow-'+c.topicId+'-'+c.view,type:'collection',...c}))];
}
export function reconcileFlow(flow, previous, next) {
  if (!flow) return undefined;
  const ids = new Set(next.map(b=>b.id)), used = new Set();
  const result = flow.flatMap(node=>{
    if (node.type !== 'block') return [node];
    let block = next.find(b=>b.id===node.blockId);
    if (!block) {
      const old = previous.find(b=>b.id===node.blockId);
      block = next.find(b=>!used.has(b.id)&&!previous.some(p=>p.id===b.id)&&b.type===old?.type);
    }
    if (!block || used.has(block.id)) return [];
    used.add(block.id);return [{...node,blockId:block.id}];
  });
  for (const block of next) if (ids.has(block.id)&&!used.has(block.id)) result.push({id:'flow-'+block.id,type:'block',blockId:block.id});
  return result;
}
export function validateFlow(value, page, project) {
  if (!Array.isArray(value)||value.length>3500) throw Error('Некорректная композиция страницы.');
  const ids=new Set(),refs=new Set();let title=false;
  return value.map(node=>{
    if(!node||typeof node.id!=='string'||!/^[\w-]{1,120}$/.test(node.id)||ids.has(node.id))throw Error('Некорректный ID в композиции.');
    ids.add(node.id);
    if(node.type==='title'&&!title){title=true;return {id:node.id,type:'title'}}
    if(node.type==='block'&&page.blocks.some(b=>b.id===node.blockId)&&!refs.has(node.blockId)){refs.add(node.blockId);return {id:node.id,type:'block',blockId:node.blockId}}
    if(node.type==='collection'&&['list','tiles','gallery'].includes(node.view)&&(['all','unfiled'].includes(node.topicId)||project.topics.some(t=>t.id===node.topicId))){return {id:node.id,type:'collection',topicId:node.topicId,view:node.view,pinnedIds:(node.pinnedIds||[]).filter(id=>typeof id==='string').slice(0,8)}}
    throw Error('Блок или тема композиции не найдены.');
  });
}
