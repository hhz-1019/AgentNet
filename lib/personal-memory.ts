import { z } from 'zod';

export const CharacterGender = z.enum(['unspecified','male','female','nonbinary']);
export const GENDER_LABELS = {unspecified:'不填写',male:'男',female:'女',nonbinary:'非二元'} as const;
export const MEMORY_SOURCES = {chatgpt:'ChatGPT',codex:'Codex 本地记忆'} as const;
export const PersonalMemoryInput = z.object({
  format:z.literal('campus-memory-v1'),
  source:z.enum(['chatgpt','codex']),
  summary:z.string().trim().min(1).max(3000),
}).strict();
export type MemoryImport = z.infer<typeof PersonalMemoryInput>;
export type PersonalMemory = {source:MemoryImport['source'];summary:string;importedAt:number};

// Accept the complete JSON code block ChatGPT commonly returns, never surrounding prose.
export function parseMemoryImport(raw:string):MemoryImport {
  if(raw.length>6000)throw new Error('摘要过长，请让 ChatGPT 缩短到 3000 字以内。');
  const text=raw.trim(),fence=text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  let value:unknown;
  try{value=JSON.parse(fence?fence[1]:text);}catch{throw new Error('请粘贴 ChatGPT 返回的完整摘要代码块，再预览。');}
  const result=PersonalMemoryInput.safeParse(value);
  if(!result.success)throw new Error('摘要格式不完整、内容为空或超过 3000 字。请让 ChatGPT 按复制的说明重新整理；没有可用记忆时可暂时跳过。');
  return result.data;
}

export const MEMORY_EXPORT_PROMPT = `我想把你已经了解的我，带给南京大学苏州校区平行世界中的 AI 伙伴。请仅根据你现在实际可用、来自我们以往交流的记忆，整理一份简短的个人摘要，由我查看后决定是否交给校园应用。
重点是反复表现出的兴趣、交流习惯、思考方式、重视的事情和明确偏好。区分明确表达与不确定印象，不要把单次情绪固定成性格，不做心理诊断，不凭空补全，不根据性别推断性格。
不包含密码、密钥、联系方式、精确住址、健康和财务细节，或其他人的隐私。不要复制原始聊天记录，也不要调用工具寻找更多私人材料。
请直接输出一个 JSON 代码块，不要附带说明：{"format":"campus-memory-v1","source":"chatgpt","summary":"你的摘要，建议 200–600 字，不超过 3000 字"}。
如果你在 Codex 中，只能使用实际可用的 Codex 本地记忆，把 source 改为 codex，不要声称读取了 ChatGPT 记忆。如果没有可用的过往记忆，summary 必须为空字符串，不要用当前这条指令推断我的性格。`;
