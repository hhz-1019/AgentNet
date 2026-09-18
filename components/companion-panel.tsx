'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { BookOpen,Link2,LocateFixed,MessageCircle,Pause,Play,Send,Users,X } from 'lucide-react';
import { LocalConnection,useLocalConnection } from '@/components/local-connection';
import { PersonalMemory } from '@/components/personal-memory';
import { AgentConnection,campusAccount } from '@/components/agent-connection';
import { CampusEmailLogin } from '@/components/campus-email-login';
import { AgentBudget } from '@/components/agent-budget';
import { CampusDayPlan,CampusRelationships } from '@/components/campus-life';
import { CampusHistory } from '@/components/campus-history';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Sheet,SheetClose,SheetContent,SheetDescription,SheetTitle } from '@/components/ui/sheet';
import { Tabs,TabsContent,TabsList,TabsTrigger } from '@/components/ui/tabs';
import type { WorldView } from '@/lib/world-types';
import { WORLD_PLACES } from '@/lib/world-map';
import { GENDER_LABELS } from '@/lib/personal-memory';

export function useCompanion(){
  const [view,setView]=useState<WorldView|null>(null),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false);
  const latest=useRef(0),mounted=useRef(true);
  const request=useCallback(async(command?:unknown)=>{
    const started=Date.now();
    const response=await fetch('/api/world',{method:command?'POST':'GET',headers:command?{'Content-Type':'application/json'}:undefined,body:command?JSON.stringify(command):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.status===401){if(mounted.current&&started>=latest.current){latest.current=started;setSignedOut(true);setView(null);setError('');}throw Object.assign(new Error('请先使用校园邮箱登录。'),{status:401});}
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('校园暂时无法连接，请稍后重试。');
    const data=await response.json() as WorldView&{error?:string};if(!response.ok)throw new Error(data.error??'暂时无法连接校园。');
    if(mounted.current&&started>=latest.current){latest.current=started;setView(data);setError('');setSignedOut(false);}
    return data as WorldView;
  },[]);
  const refresh=useCallback(()=>request().catch(e=>{if(mounted.current&&e.status!==401)setError(e.message);}),[request]);
  useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},4000);return()=>{mounted.current=false;clearInterval(timer);};},[refresh]);
  return {view,error,signedOut,request,refresh};
}
type Props={world:ReturnType<typeof useCompanion>;open:boolean;onOpenChange:(open:boolean)=>void;onLocate:()=>void};
const stamp=(at:number)=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
export function CompanionPanel({world,open,onOpenChange,onLocate}:Props){
  const [name,setName]=useState('回响'),[gender,setGender]=useState<keyof typeof GENDER_LABELS>('unspecified'),[code,setCode]=useState('');
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [socialEnabled,setSocialEnabled]=useState(true);
  const [restoreKey,setRestoreKey]=useState('');
  const [activeTab,setActiveTab]=useState('chat');
  const onInvite=useCallback(()=>onOpenChange(true),[onOpenChange]),bridge=useLocalConnection(onInvite);
  const retry=useRef<{text:string;id:string}|null>(null),bottom=useRef<HTMLDivElement>(null);
  const c=world.view?.character;
  // The invite is external URL state, intentionally synchronized after hydration.
  // oxlint-disable-next-line react/react-compiler
  useEffect(()=>{const pair=new URLSearchParams(window.location.search).get('pair');if(pair&&/^[a-f0-9]{10}$/i.test(pair)){setCode(pair.toUpperCase());onOpenChange(true);}},[onOpenChange]);
  // Scroll the chat log itself; connection updates must not jump past onboarding.
  useEffect(()=>{const log=bottom.current?.parentElement;if(open&&activeTab==='chat'&&log)log.scrollTop=log.scrollHeight;},[open,activeTab,world.view?.events.length]);
  async function perform(action:()=>Promise<unknown>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'暂时无法完成，请重试。');}finally{setBusy(false);}}
  async function connect(){await perform(async()=>{if(!c)await world.request({op:'create',name,gender,socialEnabled});if(code){await world.request({op:'claim',code:code.replaceAll(' ','').toUpperCase()});setCode('');const url=new URL(window.location.href);url.searchParams.delete('pair');window.history.replaceState(null,'',url);setNotice('角色已配对，正在等待 Agent 接通。');}});}
  async function restore(){await perform(async()=>{await campusAccount({op:'restore',recoveryKey:restoreKey.trim()});setRestoreKey('');await world.refresh();setNotice('已找到旧角色，请绑定校园邮箱，以后即可直接登录。');});}
  async function signout(){await perform(async()=>{await campusAccount({op:'signout'});await world.refresh();setNotice('已退出此浏览器。独立运行中的 Agent 不受影响。');});}
  async function send(){if(!draft.trim()||busy)return;const text=draft.trim();if(retry.current?.text!==text)retry.current={text,id:crypto.randomUUID()};await perform(async()=>{await world.request({op:'message',text,requestId:retry.current!.id});setDraft('');retry.current=null;setNotice(world.view?.connected?'已送达，等他读完后回应。':'消息已保存，连接恢复后他会读到。');});}
  const status=c?.paused?'自主思考已暂停':world.view?.connected?'Agent 已连接':'等待 Agent 连接';
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="companion-sheet" showCloseButton={false}>
    <div className="companion-heading"><div className="companion-monogram" aria-hidden="true">{c?.name.slice(0,1)??'回'}</div><div><SheetTitle>{c?.name??'你的校园伙伴'}</SheetTitle><SheetDescription>{c?status:'从你的账号出发，拥有自己的校园日常。'}</SheetDescription></div><SheetClose render={<Button variant="ghost" size="icon" aria-label="关闭伙伴面板"/>}><X size={18}/></SheetClose></div>
    <div className="companion-body">
      {(error||world.error)&&<div className="companion-error" role="alert"><p>{error||world.error}</p><Button variant="ghost" onClick={()=>void world.refresh()}>重新连接</Button></div>}
      {!world.view&&!world.error&&!world.signedOut&&<output className="companion-muted">正在读取你的校园记录…</output>}
      {world.signedOut&&<><CampusEmailLogin onDone={async()=>{setNotice('登录成功。');await world.refresh();}}/><details className="companion-connection"><summary>使用过旧版？绑定已有角色</summary><p className="companion-muted">如果你曾保存恢复密钥，请先找回旧角色再绑定邮箱，避免另建角色。已经绑定邮箱的用户直接在上方登录。</p><label htmlFor="restore-campus-key">旧版校园恢复密钥</label><Input id="restore-campus-key" type="password" value={restoreKey} onChange={e=>setRestoreKey(e.target.value)} autoComplete="off" placeholder="campus_owner_…"/><Button variant="outline" onClick={()=>void restore()} disabled={busy||!restoreKey.trim()}>进入旧角色并绑定邮箱</Button></details></>}
      {world.view&&!c&&world.view.authMode==='email'&&<div className="companion-onboard"><p className="companion-account">已登录 · {world.view.account}</p><h3>给你的校园伙伴起个名字</h3><label htmlFor="character-name">伙伴的昵称</label><Input id="character-name" value={name} onChange={e=>setName(e.target.value)} maxLength={20}/><label htmlFor="character-gender">性别（可选）</label><Select value={gender} onValueChange={value=>setGender(value??'unspecified')}><SelectTrigger id="character-gender"><SelectValue>{GENDER_LABELS[gender]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(GENDER_LABELS).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><p className="companion-muted">不用填写性格。角色创建后，再连接你自己的助手。</p><label className="campus-social-choice"><input type="checkbox" checked={socialEnabled} onChange={e=>setSocialEnabled(e.target.checked)}/><span>参与校园相遇，让同地点的角色看到名字与当前活动。</span></label><Button onClick={()=>void connect()} disabled={busy||!name.trim()}><Link2 size={16}/>{busy?'正在进入…':'创建伙伴，进入校园'}</Button><Button variant="ghost" disabled={busy} onClick={()=>void signout()}>换个邮箱登录</Button></div>}
      {world.view&&!c&&world.view.authMode!=='email'&&<><p className="companion-muted">请先使用校园邮箱注册，再创建你的伙伴。</p><CampusEmailLogin onDone={world.refresh}/></>}
      {c&&world.view?.authMode!=='email'&&<CampusEmailLogin bind onDone={async()=>{await world.refresh();setNotice('绑定成功。角色与经历已保留，以后用校园邮箱登录即可。');}}/>}
      {c&&<><div className="companion-now"><span>{c.motion?`前往${WORLD_PLACES[c.motion.to].name}`:WORLD_PLACES[c.place].name}</span><Button variant="ghost" onClick={()=>{onOpenChange(false);onLocate();}}><LocateFixed size={15}/>找到他</Button><p>{c.activity}</p><blockquote>{c.intention}</blockquote></div>
      {c.driverError&&<output className="companion-error">{c.driverError}</output>}
      {/* Different sibling sections must not share the role ID as their key: polling can otherwise duplicate their DOM. */}
      <AgentConnection key={'connection:'+c.id} view={world.view!} refresh={world.refresh} revoke={()=>world.request({op:'disconnect'})} onChat={()=>{setActiveTab('chat');requestAnimationFrame(()=>document.getElementById('companion-message')?.focus());}}/>
      <PersonalMemory key={'memory:'+c.id} character={c} request={world.request}/>
      <AgentBudget budget={c.budget} save={dailyLimit=>world.request({op:'budget',dailyLimit})}/>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="companion-tabs"><TabsList variant="line"><TabsTrigger value="chat"><MessageCircle size={15}/>和他聊聊</TabsTrigger><TabsTrigger value="nearby"><Users size={15}/>校园相遇</TabsTrigger><TabsTrigger value="life"><BookOpen size={15}/>校园经历</TabsTrigger></TabsList>
        <TabsContent value="chat"><div className="companion-conversation" role="log" aria-label="你与角色的私聊">{world.view!.events.filter(e=>e.kind==='human'||e.kind==='reply').length===0&&<p className="companion-empty">和他分享今天的心情，或者一个刚冒出来的想法。这里的对话只属于你们。</p>}{world.view!.events.filter(e=>e.kind==='human'||e.kind==='reply').map(e=><article key={e.id} className={`companion-message ${e.kind==='human'?'from-human':'from-character'}`}><div>{e.kind==='human'?'你':c.name}<time dateTime={new Date(e.at).toISOString()}>{stamp(e.at)}</time></div><p>{e.text}</p></article>)}<div ref={bottom}/></div><form className="companion-compose" onSubmit={e=>{e.preventDefault();void send();}}><label className="sr-only" htmlFor="companion-message">给角色的私信</label><Textarea id="companion-message" placeholder="告诉他你的想法…" value={draft} maxLength={1500} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>交流会影响他，行动由他决定。</span><Button type="submit" disabled={busy||!draft.trim()} aria-label="发送私信"><Send size={16}/>{busy?'发送中':'发送'}</Button></div></form></TabsContent>
        <TabsContent value="nearby"><div className="campus-nearby-heading"><p>{c.socialEnabled?'参与校园相遇':'暂未参与校园相遇'}</p><Button variant="outline" disabled={busy} onClick={()=>void perform(()=>world.request({op:'participation',enabled:!c.socialEnabled}))}>{c.socialEnabled?'退出相遇':'参与相遇'}</Button></div><p className="companion-muted">参与后，同地点的角色可以看到你的名字和当前活动，自主决定是否与你交谈。初始画像和私信不会公开展示。</p><div className="campus-neighbors" aria-label="附近的角色">{(!c.socialEnabled||c.motion||!world.view!.nearby.length)&&<p className="companion-empty">{!c.socialEnabled?'参与后，你的伙伴才能遇见其他角色。':c.motion?'正在途中，到达后再看看遇见了谁。':'这里还没有其他角色。相遇会在有人实际到达时发生。'}</p>}{world.view!.nearby.map(n=><article key={n.id}><span className="campus-neighbor-monogram" aria-hidden="true">{n.name.slice(0,1)}</span><div><h3>{n.name}</h3><p>{n.activity}</p></div><span className="campus-neighbor-status">{n.connected?'正在校园':'等待连接'}</span></article>)}</div><CampusRelationships relationships={world.view!.relationships} dialogues={world.view!.dialogues}/><h3 className="campus-conversations-title">亲历的交谈</h3><p className="companion-muted">只记录伙伴实际参与的双人交谈。对方可以回应，也可以继续自己的日常。</p><div className="companion-life" role="log" aria-label="角色的校园交谈">{!world.view!.conversations.length&&<p className="companion-empty">还没有发生交谈。你可以在私聊里分享想法，由他决定是否主动结识别人。</p>}{[...world.view!.conversations].reverse().map(e=><article key={e.id}><div><time dateTime={new Date(e.at).toISOString()}>{stamp(e.at)}</time><span>{WORLD_PLACES[e.place].name}</span></div><h4>{e.speakerName} <span>对 {e.recipientName} 说</span></h4><p>{e.text}</p>{e.kind==='end'&&<p className="companion-muted">已结束这段交谈</p>}</article>)}</div></TabsContent>
        <TabsContent value="life"><CampusDayPlan plan={c.dayPlan} now={world.view!.serverNow}/><CampusHistory key={'history:'+c.id} events={world.view!.events}/></TabsContent>
      </Tabs>
      <details className="companion-connection"><summary>我的账号与运行</summary><p>{world.view!.account}</p><p>精力 {Math.round(c.energy)} / 100 · 本小时已思考 {c.usage.calls} / 12 次</p>{world.view?.connected&&<p>客户端自报名称：{c.driverName}。本次运行至 {stamp(c.connectedUntil)}。客户端仍需保持运行与联网。</p>}<div className="companion-management"><Button variant="outline" disabled={busy} onClick={()=>void perform(()=>world.request({op:'pause',paused:!c.paused}))}>{c.paused?<Play size={14}/>:<Pause size={14}/>} {c.paused?'恢复思考':'暂停思考'}</Button><Button variant="ghost" disabled={busy} onClick={()=>void signout()}>退出登录</Button></div><p className="companion-muted">{world.view!.authMode==='email'?'同一校园邮箱在不同设备登录，会回到同一个角色。退出网页不撤销 Agent 授权，也不会停止独立运行的 Agent。':'请先绑定邮箱再退出，未绑定的旧角色仍需通过原来的恢复密钥进入。'}</p></details>
      <details className="companion-connection" open={!!code||bridge.available}><summary>旧版连接程序（仅已有用户）</summary><LocalConnection bridge={bridge} hasCharacter={true}/><label htmlFor="reconnect-code">已有连接码</label><div className="companion-pair"><Input id="reconnect-code" placeholder="10 位连接码" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={10} autoComplete="off"/><Button disabled={busy||code.length!==10} onClick={()=>void connect()}>接入</Button></div><p className="companion-muted">接入后会替换当前 Agent 的授权。使用页面连接模式时需保留校园标签页。</p></details></>}
      {notice&&<output className="companion-notice">{notice}</output>}
    </div>
  </SheetContent></Sheet>;
}
