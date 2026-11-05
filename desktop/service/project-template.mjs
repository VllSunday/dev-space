import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Only bundled, reviewed templates are accepted. This is not an arbitrary JSON importer.
export async function instantiateTemplate(repo, templateId) {
  if(templateId!=='wind-islands')throw Object.assign(new Error('Учебный шаблон не найден.'),{status:400});
  const source=fileURLToPath(new URL('./templates/wind-islands/',import.meta.url));
  const seed=JSON.parse(await readFile(path.join(source,'template.json'),'utf8'));
  const prefix='example-'+randomUUID().slice(0,12), references=new Map();
  for(const item of [...seed.projects,...seed.projects[0].topics,...seed.pages,...seed.materials,...seed.tasks,...seed.pages.flatMap(page=>page.blocks)])references.set(item.id,prefix+'-'+item.id);
  const files=new Map();
  for(const file of seed.materials.flatMap(material=>material.files))files.set(file.path,path.basename(file.path));
  for(const page of seed.pages)for(const block of page.blocks)if(block.asset)files.set(block.asset,path.basename(block.asset));
  // Read and validate every source before writing any project content.
  const assets=await Promise.all([...files].map(async([old,name])=>{
    if(!/^[a-zA-Z0-9._-]+$/.test(name)||old!==`workspace/devspace/assets/${name}`)throw Error('Некорректное вложение шаблона.');
    const relative=`workspace/devspace/assets/${prefix}-${name}`;
    references.set(old,relative);
    return {relative,bytes:await readFile(path.join(source,'assets',name))};
  }));
  const remap=value=>typeof value==='string'?(references.get(value)||value):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,child])=>[key,remap(child)])):value;
  const result=remap(seed),folder=path.join(repo,'projects',prefix);
  await mkdir(path.join(repo,'projects'),{recursive:true});
  await mkdir(folder);
  result.projects[0].path=folder;
  for(const asset of assets)await writeFile(path.join(repo,asset.relative),asset.bytes,{flag:'wx'});
  await writeFile(path.join(folder,'README.md'),'# Острова ветра\n\nУчебный проект Dev Space. Откройте его Wiki в приложении: темы, галерея, GLB-модели, страницы и задачи доступны для редактирования. Это пример организации работы, не готовая игра.\n\nСтраницы и материалы сохраняются в локальном хранилище Dev Space, отдельно от исходников игры. Для агента можно подготовить контекст через «Собрать страницу с агентом».\n',{flag:'wx'});
  return result;
}
