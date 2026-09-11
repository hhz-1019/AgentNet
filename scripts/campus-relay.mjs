import { createServer } from 'node:http';
import { randomBytes,randomUUID } from 'node:crypto';

// Loopback only. The fragment secret is never sent to Sites or put in a query string.
// This server can relay campus JSON commands; it cannot run commands or read files.
export async function createCampusRelay(site,driverToken,{requestTimeout=20000,pollTimeout=10000}={}){
  const origin=new URL(site).origin,secret=randomBytes(32).toString('hex'),jobs=new Map();
  let closed=false;
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{if(!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
    if(req.headers.origin!==origin||req.headers.host!==`127.0.0.1:${server.address().port}`){send(403,{error:'来源不匹配。'});return;}
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network','true');
    res.setHeader('Access-Control-Max-Age','600');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    if(req.method!=='POST'||req.headers.authorization!==`Bearer ${secret}`){send(401,{error:'连接已失效。'});return;}
    if(req.url==='/poll'){
      const deadline=Date.now()+pollTimeout;
      while(!closed&&!res.destroyed&&Date.now()<deadline){
        const job=jobs.values().next().value;
        if(job){send(200,{id:job.id,token:driverToken,command:job.command});return;}
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      send(200,null);return;
    }
    if(req.url!=='/result'){send(404,{error:'不存在的接口。'});return;}
    if(!req.headers['content-type']?.startsWith('application/json')){send(415,{});return;}
    let input='',size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>256000){send(413,{});return;}input+=chunk.toString();}
      const data=JSON.parse(input),job=jobs.get(data.id);
      if(!job){send(200,{accepted:false});return;}
      if(!Number.isInteger(data.status)||data.status<200||data.status>599||!data.body||typeof data.body!=='object'){send(400,{});return;}
      jobs.delete(data.id);clearTimeout(job.timeout);
      if(data.status<300)job.resolve(data.body);else{const error=new Error(typeof data.body.error==='string'?data.body.error:'校园连接失败。');error.status=data.status;job.reject(error);}
      send(200,{accepted:true});
    }catch{send(400,{error:'无效的响应。'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  return {
    port,secret,url:`${origin}/#campus-connect=${port}.${secret}`,
    request(command){return new Promise((resolve,reject)=>{
      if(closed){reject(new Error('本机连接已停止。'));return;}
      const id=randomUUID(),timeout=setTimeout(()=>{jobs.delete(id);reject(new Error('校园页面未接通，请保留已登录的校园标签页。'));},requestTimeout);
      jobs.set(id,{id,command,resolve,reject,timeout});
    });},
    async close(){closed=true;for(const job of jobs.values()){clearTimeout(job.timeout);job.reject(new Error('本机连接已停止。'));}jobs.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
