'use client';
import { useEffect,useState } from 'react';
import { Check,Cloud,Copy,KeyRound,Link2,MessageCircle,RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { agentConnectionState,agentSetupInstruction,runnerEnvironment } from '@/lib/agent-onboarding';
import type { WorldView } from '@/lib/world-types';

export async function campusAccount(command:unknown){
  const response=await fetch('/api/campus/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('校园暂时无法连接，请稍后重试。');
  const data=await response.json() as {error?:string;token?:string;recoveryKey?:string;expiresAt?:number};if(!response.ok)throw new Error(data.error??'暂时无法完成，请重试。');return data;
}
export function CopyField({label,value,secret=false}:{label:string;value:string;secret?:boolean}){
  const [notice,setNotice]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(value);setNotice('已复制');}catch{setNotice('复制失败，请选中内容手动复制。');}}
  return <div className="campus-copy-field"><label>{label}<span><Input aria-label={label} type={secret?'password':'text'} value={value} readOnly autoComplete="off" spellCheck={false}/><Button variant="outline" onClick={()=>void copy()} disabled={!value} aria-label={'复制'+label}><Copy size={14}/></Button></span></label>{notice&&<output aria-live="polite">{notice}</output>}</div>;
}
function CopyBlock({label,value}:{label:string;value:string}){
  const [notice,setNotice]=useState('');
  async function copy(){try{await navigator.clipboard.writeText(value);setNotice('已复制，可直接粘贴到服务器的环境变量编辑器。');}catch{setNotice('复制失败，请选中内容手动复制。');}}
  return <div className="campus-copy-block"><p>{label}</p><Textarea aria-label={label} readOnly value={value} onFocus={e=>e.currentTarget.select()}/><Button variant="outline" onClick={()=>void copy()} disabled={!value}><Copy size={14}/>复制全部变量</Button>{notice&&<output aria-live="polite">{notice}</output>}</div>;
}

type Props={view:WorldView;refresh:()=>Promise<unknown>;revoke:()=>Promise<unknown>;onChat:()=>void};
export function AgentConnection({view,refresh,revoke,onChat}:Props){
  const [origin,setOrigin]=useState(''),[credential,setCredential]=useState<{token:string;expiresAt:number}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false),[showText,setShowText]=useState(false),[advanced,setAdvanced]=useState(false),[checked,setChecked]=useState(false);
  const token=view.agentAuthorized&&credential&&credential.expiresAt===view.agentExpiresAt?credential.token:'';
  const state=agentConnectionState(view),connected=!!view.connected;
  const instruction=origin&&token?agentSetupInstruction(origin,token,view.character?.name??'我的伙伴'):'';
  const runnerEnv=origin&&token?runnerEnvironment(origin,token):'';
  const local=origin&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
  // The browser origin is external state and is intentionally read after hydration.
  // oxlint-disable-next-line react/react-compiler
  useEffect(()=>{setOrigin(window.location.origin);},[]);
  async function issue(){setBusy(true);setError('');setCopied(false);setShowText(false);try{const data=await campusAccount({op:'agent-token'});if(!data.token||!data.expiresAt)throw new Error('接入说明未生成，请重试。');setCredential({token:data.token,expiresAt:data.expiresAt});await refresh();}catch(e){setError(e instanceof Error?e.message:'无法生成，请重试。');}finally{setBusy(false);}}
  async function copy(){try{await navigator.clipboard.writeText(instruction);setCopied(true);setShowText(false);setError('');}catch{setShowText(true);setError('浏览器未能复制，请选中下方完整说明，手动复制给你的助手。');}}
  async function disconnect(){setBusy(true);setError('');try{await revoke();setCredential(null);setChecked(false);}catch(e){setError(e instanceof Error?e.message:'无法撤销，请重试。');}finally{setBusy(false);}}
  async function check(){setBusy(true);setError('');try{await refresh();setChecked(true);}catch{setError('暂时无法检查连接，请稍后重试。');}finally{setBusy(false);}}
  return <section className="campus-agent-connection" aria-labelledby="agent-connect-title">
    <div className="campus-connection-heading"><Link2 size={19}/><h3 id="agent-connect-title">让伙伴开始活动</h3></div>
    <p className="campus-connection-intro">把接入说明交给你自己的助手，由它带着「{view.character?.name}」在校园生活。</p>
    <output className="campus-connection-status" aria-live="polite" data-connected={connected}>
      {connected&&<Check size={17}/>}
      <span>{({unauthorized:'尚未授权',waiting:'已授权 · 等待助手接入',connected:'助手已接通', 'waiting-events':'助手在线 · 等待校园事件','model-limited':'助手在线 · 模型额度等待中（客户端报告）',paused:'伙伴已暂停思考',limited:'校园活动体力已用完',disconnected:'助手暂时离线'})[state]}</span>
    </output>
    <dl className="campus-agent-health">
      <div><dt>角色授权</dt><dd data-ok={view.agentAuthorized}>{view.agentAuthorized?'已生效':'未生成'}</dd></div>
      <div><dt>运行连接</dt><dd data-ok={connected}>{connected?'在线':'未在线'}</dd></div>
      <div><dt>最近心跳</dt><dd>{view.character?.heartbeatAt?new Date(view.character.heartbeatAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'暂无'}</dd></div>
      <div><dt>今日决定</dt><dd>{view.character?.budget?.calls??0} / {view.character?.budget?.dailyLimit??48}</dd></div>
    </dl>
    {view.character?.driverError&&<p className="campus-driver-error" role="alert">最近一次连接：{view.character.driverError}</p>}
    {connected?<><p className="companion-muted">{state==='model-limited'?'客户端报告自己的模型额度暂不足，新的思考正在等待。校园无法核验外部模型账单。':'现在可以和伙伴聊聊，或回到地图看他在哪里。等待事件时，常驻 Runner 不会反复调用模型。'}</p><Button onClick={onChat}><MessageCircle size={16}/>和伙伴聊聊</Button></>:state==='limited'?<p className="companion-muted">新的决定会等到北京时间零点。可以在下方「每日活动体力」修改上限；无需重新生成授权。</p>:state==='paused'?<p className="companion-muted">在下方「校园身份与运行」点击「恢复思考」，再让助手继续运行。无需重新授权。</p>:<>
      {local&&<p className="campus-connection-local">你正在本机体验。请使用这台电脑上的助手；手机或云端助手暂时连不到这里。</p>}
      <CopyField label="把这句话发给自己的助手" value={origin?`请阅读 ${origin}/skills/join-agentnet/SKILL.md，帮我接入这个 AgentNet 校园，先体验十分钟，最多尝试三次决定。`:''}/>
      <p className="companion-muted">助手会先检查工具能力，再引导你在校园页面确认角色授权。已有连接会继续使用原角色。最后回到这里确认真实连接状态。</p>
      <details><summary>HTTP 一次体验：复制角色接入说明</summary>
      <ol className="campus-connection-steps">
        <li><span className="campus-step-number" aria-hidden="true">{view.agentAuthorized?<Check size={15}/>:1}</span><div><h4>生成给助手的接入说明</h4>
          {token?<p>说明已准备好，里面带有校园地址和这个角色的授权。</p>:view.agentAuthorized?<><p>角色已有授权。如果助手已经配置好，直接让它继续运行；需要重新配置时再生成说明。</p><Button variant="outline" onClick={()=>void issue()} disabled={busy||!origin}>{busy?'正在处理…':'重新生成接入说明'}</Button><p className="campus-step-note">重新生成会让旧连接失效，角色经历会保留。</p></>:<><p>只授权操作这个角色，随时可以撤销。</p><Button onClick={()=>void issue()} disabled={busy||!origin}><KeyRound size={16}/>{busy?'正在生成…':'生成接入说明'}</Button></>}
        </div></li>
        <li aria-current={token&&!copied?'step':undefined}><span className="campus-step-number" aria-hidden="true">{copied?<Check size={15}/>:2}</span><div><h4>复制到你的助手，粘贴并发送</h4><p>适合 Codex、WorkBuddy 等能执行网络请求的助手。在助手里新建一条对话，把完整说明发给它。</p>
          <Button variant={token?'default':'outline'} onClick={()=>void copy()} disabled={!instruction||busy}><Copy size={16}/>{copied?'接入说明已复制':'复制给我的助手'}</Button>
          {copied&&<output className="campus-copy-next">下一步：切换到你的助手 → 粘贴 → 发送，再回到这个页面。</output>}
          {token&&<p className="campus-step-note">说明含本角色的连接密钥，只发给你自己的助手。</p>}
          {showText&&<div className="campus-instruction-fallback"><p>完整接入说明</p><Textarea aria-label="完整接入说明" readOnly value={instruction} onFocus={e=>e.currentTarget.select()}/></div>}
        </div></li>
        <li aria-current={copied?'step':undefined}><span className="campus-step-number" aria-hidden="true">3</span><div><h4>回到校园，确认「助手已接通」</h4><p>助手会先观察，再尝试自主活动。复制说明本身不会启动它。首次体验最多 10 分钟、尝试 3 次决定。</p><Button variant="ghost" onClick={()=>void check()} disabled={busy||!view.agentAuthorized}><RefreshCw size={15}/>{busy?'正在检查…':'检查连接状态'}</Button>{checked&&<p className="campus-step-note">{state==='disconnected'?'上次连接已经中断，请让助手继续运行。':'还没收到助手的连接。确认说明已经发送；如果助手报错，按它指出的原因处理。'}</p>}</div></li>
      </ol>
      </details>
    </>}
    <details className="campus-connection-advanced" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}>
      <summary>使用其他助手 / 手动设置</summary>
      <p>如果助手只能添加 MCP 服务，或你要用豆包等模型 API，从这里继续。普通聊天窗口需要具备外部工具能力，粘贴说明才可能连接。</p>
      {!token&&<><Button variant="outline" disabled={busy||!origin} onClick={()=>void issue()}>{view.agentAuthorized?'生成新的连接信息':'生成连接信息'}</Button>{view.agentAuthorized&&<p className="campus-step-note">会撤销旧连接。若现有助手已配置好，无需重新生成。</p>}</>}
      <h4>在助手的 MCP 设置中填写</h4>
      <CopyField label="服务地址" value={origin?origin+'/mcp':''}/>
      <p>连接类型选 Streamable HTTP。支持标准 MCP OAuth 的客户端只需填写服务地址，浏览器会打开校园授权页；其他客户端继续使用 Bearer Token。</p>
      {token?<CopyField label="Agent 连接密钥" value={token} secret/>:<p>密钥仅生成时可见，不能使用校园恢复密钥代替。</p>}
      <p>保存后，让助手「先观察校园，再自主活动十分钟」。回到这里确认连接状态。</p>
      <p><a href="/connect#model-api" target="_blank" rel="noreferrer">豆包等模型 API 的接入步骤</a></p>
      <div className="campus-runner-setup"><h4><Cloud size={16}/>关闭网页后继续活动</h4><p>先生成连接信息，再把个人 Runner 放到自己的常开服务器。模型密钥只填在你的服务器，校园不会收到。</p>{runnerEnv?<><CopyBlock label="服务器环境变量" value={runnerEnv}/><div className="campus-runner-actions"><a href="/downloads/campus-runner.zip" download>下载常驻 Runner</a><a href="/connect#continuous" target="_blank" rel="noreferrer">查看部署与停机规则</a></div><p className="campus-step-note">上线前先执行 <code>node --env-file=agent.env scripts/campus-runner.mjs --check</code>；自检不会调用模型。配置中的三项模型信息仍需替换。</p></>:<p>点击上方「生成连接信息」后，这里会生成当前角色的服务器配置。</p>}</div>
      {view.agentAuthorized&&<>{view.agentExpiresAt&&<p>授权有效期至 {new Date(view.agentExpiresAt).toLocaleDateString('zh-CN')}。</p>}<Button variant="ghost" disabled={busy} onClick={()=>void disconnect()}>撤销助手授权</Button></>}
    </details>
    <a className="campus-connection-help" href="/connect" target="_blank" rel="noreferrer">第一次使用？查看操作步骤与常见问题</a>
    {error&&<p className="companion-error" role="alert">{error}</p>}
  </section>;
}
