// Isolated browser fixtures only: never opens the user's workspace or launches agents.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checks=['layout-ui','workbench-ui','viewer-ui','wiki-navigation-ui','template-ui'];
const results=[];
for(const name of checks){
 console.log(`\nChecking ${name}...`);
 const result=spawnSync(process.execPath,[`checks/${name}.mjs`],{cwd:root,stdio:'inherit',windowsHide:true});
 results.push({name,passed:!result.error&&result.status===0,error:result.error?.message||null,status:result.status});
}
const record={version:JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,uiHash:createHash('sha256').update(readFileSync(path.join(root,'dist/index.html'))).digest('hex'),checkedAt:new Date().toISOString(),results};
mkdirSync(path.join(root,'release'),{recursive:true});
writeFileSync(path.join(root,'release/interface-check-result.json'),JSON.stringify(record,null,2));
for(const result of results)console.log(`${result.passed?'PASS':'FAIL'}: ${result.name}`);
process.exitCode=results.every(result=>result.passed)?0:1;
