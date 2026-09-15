'use client';
import { useEffect,useState } from 'react';
import { Copy,KeyRound,Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WorldView } from '@/lib/world-types';

export async function campusAccount(command:unknown){
  const response=await fetch('/api/campus/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('校园暂时无法连接，请稍后重试。');
  const data=await response.json() as {error?:string;token?:string;recoveryKey?:string;expiresAt?:number};if(!response.ok)throw new Error(data.error??'暂时无法完成，请重试。');return data;
}
export function CopyField({label,value,secret=false}:{label:string;value:string;secret?:boolean}){
  const [notice,setNotice]=useState('');
  useEffect(()=>setNotice(''),[value]);
  async function copy(){try{await navigator.clipboard.writeText(value);setNotice('已复制');}catch{setNotice('复制失败，请选中内容手动复制。');}}
  return <div className="campus-copy-field"><label>{label}<span><Input aria-label={label} type={secret?'password':'text'} value={value} readOnly autoComplete="off" spellCheck={false}/><Button variant="outline" onClick={()=>void copy()} disabled={!value} aria-label={'复制'+label}><Copy size={14}/></Button></span></label>{notice&&<output aria-live="polite">{notice}</output>}</div>;
}
export function AgentConnection({view,refresh,revoke}:{view:WorldView;refresh:()=>Promise<unknown>;revoke:()=>Promise<unknown>}){
  const [origin,setOrigin]=useState(''),[credential,setCredential]=useState<{token:string;expiresAt:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const token=view.agentAuthorized&&credential&&credential.expiresAt===view.agentExpiresAt?credential.token:'';
  useEffect(()=>{setOrigin(window.location.origin);},[]);
  async function issue(){setBusy(true);setError('');try{const data=await campusAccount({op:'agent-token'});setCredential({token:data.token!,expiresAt:data.expiresAt!});await refresh();}catch(e){setError(e instanceof Error?e.message:'无法生成，请重试。');}finally{setBusy(false);}}
  async function disconnect(){setBusy(true);setError('');try{await revoke();setCredential(null);}catch(e){setError(e instanceof Error?e.message:'无法撤销，请重试。');}finally{setBusy(false);}}
  return <details className="companion-connection campus-agent-connection" open={!!token||!view.agentAuthorized}>
    <summary><Link2 size={16}/>连接你的 Agent</summary>
    <p className="companion-muted">支持远程 MCP，或通过 HTTP API 接入。使用哪个模型、如何计费，由你自己的客户端决定。</p>
    <CopyField label="MCP 服务地址" value={origin?origin+'/mcp':''}/>
    <p className="companion-muted">在助手中添加 Streamable HTTP 服务，并使用下方密钥进行 Bearer Token 认证。</p>
    {token?<><CopyField key={token} label="Agent 连接密钥" value={token} secret/><p className="companion-muted">密钥仅本次显示，请存入你自己的客户端。只允许它读取和操作这个角色。</p></>:<p>{view.agentAuthorized?'已有有效的角色授权。密钥未保存在网页中，遗失后可以重新生成。':'生成密钥后，将它交给你要连接的助手。'}</p>}
    <div className="companion-management"><Button variant="outline" onClick={()=>void issue()} disabled={busy}><KeyRound size={15}/>{busy?'正在处理…':view.agentAuthorized?'更换连接密钥':'生成连接密钥'}</Button>{view.agentAuthorized&&<Button variant="ghost" onClick={()=>void disconnect()} disabled={busy}>撤销 Agent 授权</Button>}</div>
    {view.agentAuthorized&&<p className="companion-muted">更换后旧密钥立即失效。{view.agentExpiresAt?`授权有效期至 ${new Date(view.agentExpiresAt).toLocaleDateString('zh-CN')}。`:''}</p>}
    <p><a href="/connect" target="_blank" rel="noreferrer">查看接入指南与 API 文档</a></p>
    <p className="companion-muted">豆包模型等支持工具调用的服务可通过通用连接程序接入；普通聊天 App 是否能添加外部服务，以客户端能力为准。</p>
    {error&&<p className="companion-error" role="alert">{error}</p>}
  </details>;
}
