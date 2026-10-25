// Adapt only endpoint strings and cache URLs in a copy of the deployed web image.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
process.umask(0o077);const root=process.argv[2];assert.match(root??'',/^\/srv\/elsewhere\/releases\/hk-cutover-\d{14}$/);
const web=root+'/web',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(e.isFile())out.push(p);}return out;}
const files=await walk(web),renames=new Map(),textFiles=new Map(),changed=[];
for(const f of files){if(!/\.(md|js|mjs|json|html|txt|sh|ps1|bat|ts|yml|yaml)$/.test(f))continue;const b=await fs.readFile(f);const text=b.toString('utf8');assert.equal(Buffer.from(text).compare(b),0,'Invalid UTF-8: '+f);textFiles.set(f,{before:sha(b),text:text.replaceAll('agentnet-next.zeabur.app','elsewhere.twintalk.cn').replaceAll('agentnet.zeabur.app','elsewhere.twintalk.cn')});if(f.includes('/assets/')&&f.endsWith('.js'))renames.set(path.basename(f),path.basename(f,'.js')+'.hk20261018.js');}
for(const [f,o] of textFiles){let text=o.text;for(const [before,after] of renames)text=text.replaceAll(before,after);const after=sha(Buffer.from(text));if(after!==o.before){await fs.writeFile(f,text);changed.push({path:path.relative(web,f),before:o.before,after});}}
for(const f of files){const replacement=renames.get(path.basename(f));if(replacement&&f.includes('/assets/'))await fs.rename(f,path.join(path.dirname(f),replacement));}
const releasePath=web+'/release.json',release=JSON.parse(await fs.readFile(releasePath));release.migration_host='elsewhere.twintalk.cn';release.migration_batch=path.basename(root);release.release+='-hk';await fs.writeFile(releasePath,JSON.stringify(release,null,2)+'\n');
const composePath=root+'/compose.json',compose=JSON.parse(await fs.readFile(composePath));assert(!compose.services.web.volumes?.some(v=>v.target==='/srv'));compose.services.web.volumes=[...(compose.services.web.volumes??[]),{type:'bind',source:web,target:'/srv',read_only:true}];await fs.writeFile(composePath,JSON.stringify(compose,null,2));
await fs.writeFile(root+'/evidence/static-endpoint-changes.json',JSON.stringify({at:new Date().toISOString(),changed,renamedScripts:renames.size,cssImagesFontsAndOtherBinaryFilesUnchanged:true},null,2));
console.log(JSON.stringify({changedTextFiles:changed.length,renamedScripts:renames.size}));
