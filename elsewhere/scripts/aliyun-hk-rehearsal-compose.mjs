// Run on the migration host. Secrets remain in private local files, never stdout.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.umask(0o077);
const root='/srv/elsewhere/rehearsals/hk-app-20261018';
const config=JSON.parse(await fs.readFile('/srv/elsewhere/backups/hk-search-full-20261018/source-config.json'));
const lock=JSON.parse(await fs.readFile('/srv/elsewhere/backups/app-image-lock.json'));
await fs.mkdir(root+'/env',{recursive:true});await fs.mkdir(root+'/configs',{recursive:true});
const env={};
for(const [name,s] of Object.entries(config.services)) {
 env[name]=Object.fromEntries(s.variables.filter(v=>!v.readonly&&!v.key.endsWith('_HOST')&&v.key!=='PASSWORD').map(v=>[v.key,v.value]));
 for(const [path,c] of Object.entries(s.configs??{})){
  assert.equal(c.envsubst,false);await fs.writeFile(root+'/configs/'+name+'-'+path.split('/').at(-1),c.content,{flag:'wx',mode:0o600});
 }
}
const dsn=new URL(env.core.PG_DSN);dsn.hostname='postgres';dsn.port='5432';
Object.assign(env.core,{PG_DSN:dsn.toString(),REDIS_ADDR:'redis:6379',ETCD_ADDR:'etcd:2379',ES_URL:'http://search:9200',AGENTNET_GORSE_URL:'http://gorse:8088',AGENTNET_ACTIVITY_SEARCH_URL:'http://activity-search:8080',PUBLIC_BASE_URL:'https://elsewhere.twintalk.cn',CONSOLE_V2_PUBLIC_URL:'https://elsewhere.twintalk.cn',CONSOLE_V2_ALLOWED_ORIGINS:'https://elsewhere.twintalk.cn',AGENTNET_MANAGED_WORKER:'false',AGENTNET_PUBLIC_SOURCE_WORKER:'false',AGENTNET_ACCOUNT_DELETION_WORKER:'false'});
Object.assign(env.web,{CORE_HTTP:'core:8080',CORE_WS:'core:8088'});
Object.assign(env.sync,{AGENTNET_GORSE_URL:'http://gorse:8088',AGENTNET_PUBLIC_URL:'http://core:8080'});
Object.assign(env.search,{'discovery.type':'single-node','xpack.security.enabled':'false',ES_JAVA_OPTS:'-Xms512m -Xmx512m',ES_SETTING_PATH_REPO:'/snapshots','indices.lifecycle.poll_interval':'24h'});
env.redis.REDIS_PASSWORD=env.core.REDIS_PASSWORD;
for(const [name,values] of Object.entries(env)){
 for(const [k,v] of Object.entries(values)){assert(!['\r','\n','\0'].some(c=>(k+v).includes(c)),`Unsupported multiline value: ${name}.${k}`);assert(!v.includes('${'),`Unresolved variable: ${name}.${k}`);}
 await fs.writeFile(root+'/env/'+name+'.env',Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600});
}
const images={core:lock.core.image,web:lock.web.image,postgres:'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea',redis:'redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',etcd:config.services.etcd.image.reference,search:'docker.elastic.co/elasticsearch/elasticsearch:8.11.0@sha256:4cd9ce4ccb04618617114da1df8240473bbd004329c1bc0252cebeec089b629e',gorse:config.services.gorse.image.reference,sync:'node:24-alpine',activitySearch:config.services.activitySearch.image.reference};
const services={};
const bind=(source,target,read_only=false)=>({type:'bind',source:root+'/'+source,target,read_only});
for(const name of Object.keys(config.services)){
 const id=name==='activitySearch'?'activity-search':name;
 services[id]={image:images[name],container_name:'elsewhere-rehearsal-'+id,restart:'no',env_file:[{path:root+'/env/'+name+'.env',format:'raw'}],networks:['isolated'],mem_limit:({core:'4g',postgres:'2g',search:'2g',gorse:'1g',activitySearch:'512m'})[name]??'256m',logging:{driver:'local',options:{'max-size':'10m','max-file':'3'}}};
}
Object.assign(services.postgres,{volumes:[bind('postgres','/var/lib/postgresql/data')],healthcheck:{test:['CMD','pg_isready','-U','agentnet','-d','agentnet'],interval:'5s',retries:30}});
Object.assign(services.redis,{volumes:[bind('redis','/data')],command:['sh','-c','exec redis-server --appendonly yes --requirepass "$$REDIS_PASSWORD"'],healthcheck:{test:['CMD-SHELL','REDISCLI_AUTH="$$REDIS_PASSWORD" redis-cli ping | grep PONG'],interval:'5s',retries:30}});
Object.assign(services.etcd,{volumes:[bind('etcd','/etcd-data')],entrypoint:['/usr/local/bin/etcd'],command:['--name=rehearsal','--data-dir=/etcd-data','--listen-client-urls=http://0.0.0.0:2379','--advertise-client-urls=http://etcd:2379','--listen-peer-urls=http://127.0.0.1:2380','--initial-advertise-peer-urls=http://127.0.0.1:2380','--initial-cluster=rehearsal=http://127.0.0.1:2380'],healthcheck:{test:['CMD','/usr/local/bin/etcdctl','endpoint','health'],interval:'5s',retries:30}});
Object.assign(services.search,{volumes:[bind('search','/usr/share/elasticsearch/data'),bind('search-repository','/snapshots',true)],healthcheck:{test:['CMD-SHELL','curl -fsS http://localhost:9200/_cluster/health >/dev/null'],interval:'10s',retries:30}});
Object.assign(services.gorse,{volumes:[bind('gorse','/var/lib/gorse'),bind('configs/gorse-config.toml','/etc/gorse/config.toml',true)],entrypoint:['/usr/bin/gorse-in-one'],command:['-c','/etc/gorse/config.toml']});
Object.assign(services.sync,{volumes:[bind('configs/sync-sync.mjs','/app/sync.mjs',true)],command:['node','/app/sync.mjs','--watch'],depends_on:{core:{condition:'service_healthy'},gorse:{condition:'service_started'}}});
Object.assign(services['activity-search'],{volumes:[bind('configs/activitySearch-settings.yml','/etc/searxng/settings.yml',true)]});
Object.assign(services.core,{command:['serve'],depends_on:Object.fromEntries(['postgres','redis','etcd','search'].map(n=>[n,{condition:'service_healthy'}])),healthcheck:{test:['CMD-SHELL','curl -fsS http://localhost:8080/api/v1/website/stats >/dev/null'],interval:'15s',start_period:'60s',retries:16}});
Object.assign(services.web,{depends_on:{core:{condition:'service_healthy'}}});
await fs.writeFile(root+'/compose.json',JSON.stringify({name:'elsewhere-rehearsal',services,networks:{isolated:{internal:true}}},null,2),{flag:'wx',mode:0o600});
await fs.writeFile(root+'/rehearsal-warning.txt','INITIAL SNAPSHOTS ONLY. No ports. Internal network. Three activity/deletion workers disabled. Never use this copy as final production data.\n',{flag:'wx'});
console.log('PRIVATE_REHEARSAL_COMPOSE_READY services='+Object.keys(services).length);
