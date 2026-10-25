// Reuse the tested application definition; final data is restored separately.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.umask(0o077);
const batch=process.argv[2];
assert.match(batch??'',/^hk-cutover-\d{14}$/);
const old='/srv/elsewhere/rehearsals/hk-app-20261018';
const root='/srv/elsewhere/releases/'+batch;
await fs.mkdir('/srv/elsewhere/releases',{recursive:true});
await fs.mkdir(root,{recursive:false});
await fs.cp(old+'/env',root+'/env',{recursive:true});
await fs.cp(old+'/configs',root+'/configs',{recursive:true});
await fs.mkdir(root+'/evidence');
const config=JSON.parse(await fs.readFile('/srv/elsewhere/backups/hk-search-full-20261018/source-config.json'));
const coreValues=Object.fromEntries(config.services.core.variables.map(v=>[v.key,v.value]));
let env=await fs.readFile(root+'/env/core.env','utf8');
for(const key of ['AGENTNET_MANAGED_WORKER','AGENTNET_PUBLIC_SOURCE_WORKER','AGENTNET_ACCOUNT_DELETION_WORKER']){
 assert(['true','false'].includes(coreValues[key]));
 env=env.replace(new RegExp('^'+key+'=.*$','m'),key+'='+coreValues[key]);
}
await fs.writeFile(root+'/env/core.env',env);
let esEnv=await fs.readFile(root+'/env/search.env','utf8');
esEnv=esEnv.replace(/^indices\.lifecycle\.poll_interval=.*$/m,'indices.lifecycle.poll_interval=10m');
await fs.writeFile(root+'/env/search.env',esEnv);
const compose=JSON.parse((await fs.readFile(old+'/compose.json','utf8')).split(old).join(root));
compose.name='elsewhere';
compose.networks={backend:{internal:true},outbound:{},edge:{name:'elsewhere-edge-app',internal:true}};
for(const [name,s] of Object.entries(compose.services)){
 s.container_name='elsewhere-'+name;s.restart='unless-stopped';s.networks=['backend'];
 assert(!s.ports);
 if(name==='core'||name==='activity-search')s.networks.push('outbound');
 if(name==='web'||name==='core')s.networks.push('edge');
 if(name==='etcd')s.command=s.command.map(x=>x.replaceAll('rehearsal','agentnet'));
 if(name==='search')s.volumes.find(v=>v.target==='/snapshots').read_only=false;
}
await fs.writeFile(root+'/compose.json',JSON.stringify(compose,null,2));
await fs.writeFile(root+'/NOT_LIVE','Final backup restore and fingerprint reconciliation required before application start.\n');
console.log('PRODUCTION_DEFINITION_PREPARED '+root);
