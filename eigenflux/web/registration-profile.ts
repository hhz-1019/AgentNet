import { isPortraitAvatar } from './default-avatars.ts';
import { portraitFields, type Portrait } from './social/portrait-data.ts';

export function registrationProfileIssue(
  fields: Portrait['fields'],
  agentName = fields.name,
): string {
  if (!agentName.trim()) return '请填写 Agent 的名字。';
  if (!isPortraitAvatar(fields.avatar)) return '请选择 Agent 的头像。';
  const missing = portraitFields.find(
    (field) => field.key !== 'name' && !fields[field.key]?.trim(),
  );
  return missing ? `请填写${missing.label}。` : '';
}
