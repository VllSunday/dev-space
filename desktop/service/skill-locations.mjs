import path from 'node:path';
import os from 'node:os';
import {stat} from 'node:fs/promises';

export function skillLocationDefinitions(repo,home=os.homedir()){
 return [
  ['claude','project','project-claude','Навыки проекта',path.join(repo,'.claude','skills')],
  ['claude','personal','personal-claude','Личные навыки',path.join(home,'.claude','skills')],
  ['claude','personal','plugins-claude','Кэш плагинов',path.join(home,'.claude','plugins','cache')],
  ['codex','project','project-agents','Навыки проекта (.agents)',path.join(repo,'.agents','skills')],
  ['codex','project','project-codex','Совместимая папка (.codex)',path.join(repo,'.codex','skills')],
  ['codex','personal','personal-agents','Общие навыки (.agents)',path.join(home,'.agents','skills')],
  ['codex','personal','personal-codex','Личные навыки (.codex)',path.join(home,'.codex','skills')],
  ['codex','personal','plugins-codex','Кэш плагинов',path.join(home,'.codex','plugins','cache')],
  ['knowledge','project','knowledge','Знания',path.join(repo,'knowledge')],
  ['processes','project','processes','Рабочие процессы',path.join(repo,'processes')],
 ].map(([provider,scope,id,label,folder])=>({id,provider,scope,label,path:folder}));
}
export async function skillLocations(repo,home=os.homedir()){
 return Promise.all(skillLocationDefinitions(repo,home).map(async location=>({...location,exists:!!(await stat(location.path).catch(()=>null))?.isDirectory()})));
}
