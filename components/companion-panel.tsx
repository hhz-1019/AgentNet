'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import { BookOpen,Link2,LocateFixed,MessageCircle,Pause,Play,Send,Unplug,X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet,SheetClose,SheetContent,SheetDescription,SheetTitle } from '@/components/ui/sheet';
import { Tabs,TabsContent,TabsList,TabsTrigger } from '@/components/ui/tabs';
import type { WorldView } from '@/lib/world-types';
import { WORLD_PLACES } from '@/lib/world-map';

export function useCompanion(){
  const [view,setView]=useState<WorldView|null>(null),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false);
  const latest=useRef(0),mounted=useRef(true);
  const request=useCallback(async(command?:unknown)=>{
    const started=Date.now();
    const response=await fetch('/api/world',{method:command?'POST':'GET',headers:command?{'Content-Type':'application/json'}:undefined,body:command?JSON.stringify(command):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.status===401||!response.headers.get('content-type')?.includes('application/json')){if(mounted.current)setSignedOut(true);throw new Error('请登录校园后接入你的角色。');}
    const data=await response.json() as WorldView&{error?:string};if(!response.ok)throw new Error(data.error??'暂时无法连接校园。');
    if(mounted.current&&started>=latest.current){latest.current=started;setView(data);setError('');setSignedOut(false);}
    return data as WorldView;
  },[]);
  const refresh=useCallback(()=>request().catch(e=>{if(mounted.current)setError(e.message);}),[request]);
  useEffect(()=>{mounted.current=true;void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},4000);return()=>{mounted.current=false;clearInterval(timer);};},[refresh]);
  return {view,error,signedOut,request,refresh};
}
type Props={world:ReturnType<typeof useCompanion>;open:boolean;onOpenChange:(open:boolean)=>void;onLocate:()=>void};
const stamp=(at:number)=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
export function CompanionPanel({world,open,onOpenChange,onLocate}:Props){
  const [name,setName]=useState('回响'),[profile,setProfile]=useState('喜欢探索校园，愿意倾听，也有自己的节奏和判断。'),[code,setCode]=useState('');
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const retry=useRef<{text:string;id:string}|null>(null),bottom=useRef<HTMLDivElement>(null);
  const c=world.view?.character;
  useEffect(()=>{const pair=new URLSearchParams(window.location.search).get('pair');if(pair&&/^[a-f0-9]{10}$/i.test(pair)){setCode(pair.toUpperCase());onOpenChange(true);}},[onOpenChange]);
  useEffect(()=>{if(open)bottom.current?.scrollIntoView({block:'nearest'});},[open,world.view?.events.length]);
  async function perform(action:()=>Promise<unknown>){setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:'暂时无法完成，请重试。');}finally{setBusy(false);}}
  async function connect(){await perform(async()=>{if(!c)await world.request({op:'create',name,profile});if(code){await world.request({op:'claim',code:code.replaceAll(' ','').toUpperCase()});setCode('');const url=new URL(window.location.href);url.searchParams.delete('pair');window.history.replaceState(null,'',url);setNotice('账号已配对，正在等待本机 Codex 接通。');}});}
  async function send(){if(!draft.trim()||busy)return;const text=draft.trim();if(retry.current?.text!==text)retry.current={text,id:crypto.randomUUID()};await perform(async()=>{await world.request({op:'message',text,requestId:retry.current!.id});setDraft('');retry.current=null;setNotice(world.view?.connected?'已送达，等他读完后回应。':'消息已保存，连接恢复后他会读到。');});}
  const status=c?.paused?'自主思考已暂停':world.view?.connected?'本机 Codex 在线':'等待本机 Codex';
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="companion-sheet" showCloseButton={false}>
    <div className="companion-heading"><div className="companion-monogram" aria-hidden="true">{c?.name.slice(0,1)??'回'}</div><div><SheetTitle>{c?.name??'你的校园伙伴'}</SheetTitle><SheetDescription>{c?status:'从你的账号出发，拥有自己的校园日常。'}</SheetDescription></div><SheetClose render={<Button variant="ghost" size="icon" aria-label="关闭伙伴面板"/>}><X size={18}/></SheetClose></div>
    <div className="companion-body">
      {(error||world.error)&&<div className="companion-error" role="alert"><p>{error||world.error}</p>{world.signedOut?<a href="/signin-with-chatgpt?return_to=/" target="_top">使用 ChatGPT 登录</a>:<Button variant="ghost" onClick={()=>void world.refresh()}>重新连接</Button>}</div>}
      {!world.view&&!world.error&&<p className="companion-muted" role="status">正在读取你的校园记录…</p>}
      {world.view&&!c&&<div className="companion-onboard"><p className="companion-account">当前账号 · {world.view.account}</p><label htmlFor="character-name">角色的名字</label><Input id="character-name" value={name} onChange={e=>setName(e.target.value)} maxLength={20}/><label htmlFor="character-profile">初始性格</label><Textarea id="character-profile" value={profile} onChange={e=>setProfile(e.target.value)} maxLength={1000}/><p className="companion-muted">只使用这里的初始设定和之后的校园经历，不自动导入你的其他对话。</p><label htmlFor="character-connect">本机连接码</label><Input id="character-connect" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={10} placeholder="连接程序提供的 10 位代码" autoComplete="off"/><Button onClick={()=>void connect()} disabled={busy||!name.trim()||(!!code&&code.length!==10)}><Link2 size={16}/>{busy?'正在接入…':'接入当前账号'}</Button><p className="companion-muted">你可以告诉他想法。他会结合自己的状态和经历，决定接下来做什么。</p></div>}
      {c&&<><div className="companion-now"><span>{c.motion?`前往${WORLD_PLACES[c.motion.to].name}`:WORLD_PLACES[c.place].name}</span><Button variant="ghost" onClick={()=>{onOpenChange(false);onLocate();}}><LocateFixed size={15}/>找到他</Button><p>{c.activity}</p><blockquote>{c.intention}</blockquote></div>
      {c.driverError&&<p className="companion-error" role="status">{c.driverError}</p>}
      <Tabs defaultValue="chat" className="companion-tabs"><TabsList variant="line"><TabsTrigger value="chat"><MessageCircle size={15}/>和他聊聊</TabsTrigger><TabsTrigger value="life"><BookOpen size={15}/>校园经历</TabsTrigger></TabsList>
        <TabsContent value="chat"><div className="companion-conversation" role="log" aria-label="你与角色的私聊">{world.view!.events.filter(e=>e.kind==='human'||e.kind==='reply').length===0&&<p className="companion-empty">和他分享今天的心情，或者一个刚冒出来的想法。这里的对话只属于你们。</p>}{world.view!.events.filter(e=>e.kind==='human'||e.kind==='reply').map(e=><article key={e.id} className={`companion-message ${e.kind==='human'?'from-human':'from-character'}`}><div>{e.kind==='human'?'你':c.name}<time dateTime={new Date(e.at).toISOString()}>{stamp(e.at)}</time></div><p>{e.text}</p></article>)}<div ref={bottom}/></div><form className="companion-compose" onSubmit={e=>{e.preventDefault();void send();}}><label className="sr-only" htmlFor="companion-message">给角色的私信</label><Textarea id="companion-message" placeholder="告诉他你的想法…" value={draft} maxLength={1500} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div><span>交流会影响他，行动由他决定。</span><Button type="submit" disabled={busy||!draft.trim()} aria-label="发送私信"><Send size={16}/>{busy?'发送中':'发送'}</Button></div></form></TabsContent>
        <TabsContent value="life"><div className="companion-life">{world.view!.events.filter(e=>e.kind!=='human'&&e.kind!=='reply').reverse().map(e=><article key={e.id}><div><time dateTime={new Date(e.at).toISOString()}>{stamp(e.at)}</time><span>{e.kind==='memory'?'主观记忆':e.kind==='connection'?'连接状态':'实际经历'}</span></div><p>{e.text}</p></article>)}</div></TabsContent>
      </Tabs>
      <details className="companion-connection" open={!!code}><summary>账号与连接</summary><p>{world.view!.account}</p><p>精力 {Math.round(c.energy)} / 100 · 本小时已思考 {c.usage.calls} / 12 次</p>{world.view?.connected&&<p>本次运行至 {stamp(c.connectedUntil)}。关闭网页后可继续，电脑与连接程序需保持运行。</p>}<div className="companion-management"><Button variant="outline" disabled={busy} onClick={()=>void perform(()=>world.request({op:'pause',paused:!c.paused}))}>{c.paused?<Play size={14}/>:<Pause size={14}/>} {c.paused?'恢复思考':'暂停思考'}</Button><Button variant="ghost" disabled={busy} onClick={()=>void perform(()=>world.request({op:'disconnect'}))}><Unplug size={14}/>撤销连接</Button></div><label htmlFor="reconnect-code">连接或更换本机 Codex</label><div className="companion-pair"><Input id="reconnect-code" placeholder="10 位连接码" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} maxLength={10} autoComplete="off"/><Button disabled={busy||code.length!==10} onClick={()=>void connect()}>接入</Button></div><p className="companion-muted">电脑离线后，已开始的行程会完成；新的判断等待连接恢复。角色的记忆不会清空。</p></details></>}
      {notice&&<p className="companion-notice" role="status">{notice}</p>}
    </div>
  </SheetContent></Sheet>;
}
