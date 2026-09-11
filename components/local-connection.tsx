'use client';
import { useEffect,useRef,useState } from 'react';
import { Copy,Download,Link2,Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Connection={port:number;secret:string};
type Job={id:string;token:string;command:{op:string}};

export function useLocalConnection(onInvite:()=>void){
  const [connection,setConnection]=useState<Connection|null>(null),[active,setActive]=useState(false),[status,setStatus]=useState('');
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>{
    function invite(){const match=window.location.hash.match(/^#campus-connect=(\d{1,5})\.([a-f0-9]{64})$/);if(match&&Number(match[1])>1023&&Number(match[1])<65536){setConnection({port:Number(match[1]),secret:match[2]});onInvite();}}
    invite();window.addEventListener('hashchange',invite);
    return()=>{window.removeEventListener('hashchange',invite);abort.current?.abort();};
  },[onInvite]);
  function stop(){abort.current?.abort();setActive(false);setStatus('已停止页面连接。已开始的行程会完成，新判断等待重新连接。');}
  async function start(){
    if(!connection||active)return;
    const controller=new AbortController();abort.current=controller;setActive(true);setStatus('正在连接这台电脑…');
    // Remove the ephemeral loopback capability from the visible address after opt-in.
    window.history.replaceState(null,'',window.location.pathname+window.location.search);
    const local=`http://127.0.0.1:${connection.port}`,headers={'Content-Type':'application/json',Authorization:`Bearer ${connection.secret}`};
    const completed=new Map<string,{status:number;body:unknown}>();
    try{
      while(!controller.signal.aborted){
        const poll=await fetch(local+'/poll',{method:'POST',headers,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),credentials:'omit',redirect:'error'});
        if(!poll.ok)throw new Error('本机连接码已失效，请重新启动连接程序。');
        const job=await poll.json() as Job|null;
        if(!job){setStatus('页面连接已就绪，等待自己的 Codex。');continue;}
        if(!/^[a-f0-9]{64}$/.test(job.token)||typeof job.id!=='string')throw new Error('本机连接返回了无效内容。');
        let result=completed.get(job.id);
        if(!result){
          const response=await fetch('/api/world/relay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:job.token,command:job.command}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),redirect:'error'});
          if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('校园登录已过期，请重新登录再连接。');
          result={status:response.status,body:await response.json()};completed.set(job.id,result);
          if(completed.size>30)completed.delete(completed.keys().next().value!);
        }
        const receipt=await fetch(local+'/result',{method:'POST',headers,body:JSON.stringify({id:job.id,...result}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),credentials:'omit',redirect:'error'});
        if(!receipt.ok)throw new Error('本机连接暂时中断，请重新连接。');
        if(result.status>=400){const error=result.body as {error?:string};throw new Error(error.error??'校园未接受本机连接。');}
        setStatus('已连接自己的 Codex。请保留校园标签页与本机程序。');
      }
    }catch(error){if(!controller.signal.aborted)setStatus(error instanceof TypeError?'无法连接本机。请确认连接程序仍在运行，并允许浏览器访问本地网络。':error instanceof Error?error.message:'连接失败，请重试。');}
    finally{if(abort.current===controller)setActive(false);}
  }
  return {available:!!connection,active,status,start,stop};
}

export function LocalConnection({bridge,hasCharacter}:{bridge:ReturnType<typeof useLocalConnection>;hasCharacter:boolean}){
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  async function copy(){
    const instruction=`请帮我用自己的 Codex 接入这个校园：${window.location.origin}。先在我已登录的校园页面下载「个人连接程序」ZIP，解压到独立文件夹，阅读 README.md。使用 Node 24+ 安装其中声明的依赖，找到本机已登录 ChatGPT 的 Codex CLI 可执行文件，然后运行 npm start -- --codex=可执行文件完整路径。不要上传或复制我的 ChatGPT 密码、API Key、auth.json，也不要使用站点所有者的通行凭据。打开程序给出的校园链接，让我点击「连接这台电脑」。每次最多运行 4 小时或思考 48 次，消耗我自己的 Codex 用量；保留校园标签页。不要设置自动续期或开机启动。`;
    try{await navigator.clipboard.writeText(instruction);setCopied(true);setCopyError(false);}catch{setCopyError(true);}
  }
  return <div className="campus-local-connection">
    <h3>用自己的 Codex 接入</h3>
    <p>每个人的角色由本机 Codex 思考，用量归各自账号。首次接入，将说明交给自己的 Codex 完成配置。</p>
    <div className="companion-management"><Button variant="outline" onClick={()=>void copy()}><Copy size={14}/>{copied?'说明已复制':'复制接入说明'}</Button><a className="campus-download" href="/downloads/campus-connector.zip" download><Download size={14}/>个人连接程序</a></div>
    {copyError&&<p role="alert">未能复制。请下载连接程序，按其中的 README 说明连接。</p>}
    {bridge.available&&<div className="campus-connect-invite"><p>已收到这台电脑的连接请求。连接后，本机程序可以为当前角色读取观察并提交决定。</p><Button disabled={!hasCharacter} onClick={()=>bridge.active?bridge.stop():void bridge.start()}>{bridge.active?<Unplug size={15}/>:<Link2 size={15}/>} {bridge.active?'停止页面连接':'连接这台电脑'}</Button>{!hasCharacter&&<p>先创建下方的校园角色，再连接。</p>}</div>}
    {bridge.status&&<output className="companion-notice">{bridge.status}</output>}
    <p className="companion-muted">此连接方式需要保持校园标签页和电脑运行。关闭页面后停止新判断，消息与经历继续保存。每次运行最多 4 小时。</p>
  </div>;
}
