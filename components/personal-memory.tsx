'use client';
import { useState } from 'react';
import { Copy,ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MEMORY_EXPORT_PROMPT,MEMORY_SOURCES,parseMemoryImport,type MemoryImport } from '@/lib/personal-memory';
import type { WorldView } from '@/lib/world-types';

type Props={character:NonNullable<WorldView['character']>;request:(command:unknown)=>Promise<WorldView>};
export function PersonalMemory({character,request}:Props){
  const [raw,setRaw]=useState(''),[preview,setPreview]=useState<MemoryImport|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[showPrompt,setShowPrompt]=useState(false);
  const memory=character.personalMemory;
  async function copy(){
    setNotice('');setError('');
    try{await navigator.clipboard.writeText(MEMORY_EXPORT_PROMPT);setNotice('说明已复制。发给你自己的 ChatGPT，让它整理已有记忆。');}
    catch{setShowPrompt(true);setNotice('请选中下方说明并复制，发给你自己的 ChatGPT。');}
  }
  function inspect(){
    setError('');setNotice('');
    try{setPreview(parseMemoryImport(raw));}catch(e){setPreview(null);setError(e instanceof Error?e.message:'暂时无法读取这份摘要。');}
  }
  async function save(value:MemoryImport|null){
    setBusy(true);setError('');setNotice('');
    try{await request({op:'personal-memory',memory:value});setRaw('');setPreview(null);setNotice(value?'摘要已保存，将用于伙伴接下来的判断。':'已移除个人摘要。既有对话与校园经历仍保留。');}
    catch(e){setError(e instanceof Error?e.message:'保存失败，请重试。');}
    finally{setBusy(false);}
  }
  return <details className="personal-memory">
    <summary>关于你的记忆 <span>{memory?'已导入摘要':character.profile?'旧版设定 · 可更新':'尚未导入'}</span></summary>
    <p className="companion-muted">让伙伴从 ChatGPT 已经了解的你出发。登录不会自动带来历史记忆，目前需要由 ChatGPT 整理一份摘要，再由你确认导入。</p>
    {(memory||character.profile)&&<section className="personal-memory-current" aria-label="当前个人摘要">
      <h3>{memory?`你从 ${MEMORY_SOURCES[memory.source]} 导入的摘要`:'旧版手填设定'}</h3>
      {memory&&<time dateTime={new Date(memory.importedAt).toISOString()}>导入于 {new Date(memory.importedAt).toLocaleDateString('zh-CN')}</time>}
      <p>{memory?.summary??character.profile}</p>
      <Button variant="ghost" disabled={busy} onClick={()=>void save(null)}>移除个人摘要</Button>
      <p className="companion-muted">移除后不再提供给新的判断；已形成的对话与校园经历仍保留。</p>
    </section>}
    <div className="personal-memory-actions"><Button variant="outline" onClick={()=>void copy()} disabled={busy}><Copy size={15}/>复制整理说明</Button><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">打开 ChatGPT<ExternalLink size={14}/></a></div>
    <details className="personal-memory-prompt" open={showPrompt} onToggle={e=>setShowPrompt(e.currentTarget.open)}><summary>查看整理说明</summary><label htmlFor="memory-export-prompt" className="sr-only">发给 ChatGPT 的整理说明</label><Textarea id="memory-export-prompt" readOnly value={MEMORY_EXPORT_PROMPT} onFocus={e=>e.currentTarget.select()}/></details>
    <p className="companion-muted">ChatGPT 的记忆请在 ChatGPT 中整理；若使用 Codex，只能整理它实际可用的本地记忆。没有记忆时可以稍后再来。</p>
    <form onSubmit={e=>{e.preventDefault();if(preview)void save(preview);else inspect();}}>
      <label htmlFor="memory-import">粘贴它返回的摘要</label>
      <Textarea id="memory-import" value={raw} disabled={busy} onChange={e=>{setRaw(e.target.value);setPreview(null);setError('');setNotice('');}} maxLength={6000} placeholder="粘贴完整的摘要代码块，无需自己填写性格。" aria-describedby="memory-import-note"/>
      <p id="memory-import-note" className="companion-muted">只保存确认过的摘要，用于你自己的伙伴；不会向其他角色提供。摘要不会自动同步更新。</p>
      {preview&&<section className="personal-memory-preview" aria-label="待确认的记忆摘要"><h3>确认这份摘要是否准确</h3><p className="companion-muted">标注来源 · {MEMORY_SOURCES[preview.source]}（由你提供）</p><p>{preview.summary}</p><p className="companion-muted">{memory||character.profile?'确认后将替换当前个人摘要。':'确认后用于伙伴的后续判断。'} 可以修改上方内容后重新预览。</p></section>}
      <Button type="submit" disabled={busy||!raw.trim()}>{busy?'正在保存…':preview?'确认导入':'预览摘要'}</Button>
    </form>
    {error&&<p className="companion-error" role="alert">{error}</p>}
    {notice&&<output className="companion-notice">{notice}</output>}
  </details>;
}
