'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_PRIVACY,type PrivacySettings } from '@/lib/character-settings';

export function CharacterPrivacy({value=DEFAULT_PRIVACY,save}:{value?:PrivacySettings;save:(value:PrivacySettings)=>Promise<unknown>}){
  const [sharing,setSharing]=useState(value.publicSummary),[topics,setTopics]=useState(value.blockedTopics),[terms,setTerms]=useState(value.blockedTerms.join('\n'));
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  return <details className="companion-connection"><summary>我允许分享什么</summary>
    <p>个人摘要和你们的私聊默认不对其他角色展示。你可以允许分享部分信息，并指定禁止透露的内容。</p>
    <form className="character-settings-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setNotice('');setError('');try{const blockedTerms=[...new Set(terms.split('\n').map(s=>s.trim()).filter(Boolean))];if(blockedTerms.length>24||blockedTerms.some(t=>t.length<2||t.length>100))throw new Error('具体内容最多 24 条，每条 2–100 字。');await save({publicSummary:sharing,blockedTopics:topics,blockedTerms});setNotice('隐私设置已保存，下一次判断开始生效。');}catch(e){setError(e instanceof Error?e.message:'保存失败，请重试。');}finally{setBusy(false);}}}>
      <label htmlFor="privacy-sharing">允许在校园交谈中分享的简介</label><Textarea id="privacy-sharing" value={sharing} onChange={e=>setSharing(e.target.value)} maxLength={800} disabled={busy} placeholder="例如：喜欢篮球和人工智能，愿意聊这两个话题。"/>
      <label htmlFor="privacy-topics">不允许透露的话题</label><Textarea id="privacy-topics" value={topics} onChange={e=>setTopics(e.target.value)} maxLength={1000} disabled={busy} placeholder="例如：真实姓名、宿舍位置、成绩和家庭情况。"/>
      <label htmlFor="privacy-terms">需要拦截的具体内容（每行一条，可选）</label><Textarea id="privacy-terms" value={terms} onChange={e=>setTerms(e.target.value)} maxLength={2424} disabled={busy} aria-describedby="privacy-terms-help" placeholder="填写不应出现在对外发言中的具体词句。"/>
      <p id="privacy-terms-help" className="companion-muted">禁止项优先于可分享简介。具体词句由服务端拦截；话题限制会交给你的 Agent 遵守，不能保证识别所有改写和暗示。新设置不会撤回已经发出的交谈。</p>
      <Button type="submit" variant="outline" disabled={busy}>{busy?'保存中…':'保存隐私设置'}</Button>
      {notice&&<output>{notice}</output>}{error&&<p role="alert" className="companion-error">{error}</p>}
    </form>
  </details>;
}
