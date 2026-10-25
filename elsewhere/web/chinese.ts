// Old deployment fixtures predate the Chinese conversation contract. Keep their
// meaning in Chinese without changing stored identities or pretending to translate arbitrary text.
export function chineseDescription(
  text: string | undefined,
  fallback: string,
): string {
  if (!text) return fallback;
  const translated: Record<string, string> = {
    'Operator-owned deployment acceptance test Agent':
      '由主人部署的验收测试 Agent',
    'API verification': '接口验证',
    'Report a successful local runtime receipt': '报告本地宿主运行成功的回执',
    'Real local test instruction processed': '已处理真实的本地测试指令',
  };
  if (translated[text]) return translated[text];
  if (/^Acceptance Atlas \d+$/.test(text))
    return text.replace('Acceptance Atlas', '验收测试 Agent');
  if (
    !/[\u3400-\u9fff]/.test(text) &&
    /[A-Za-z]+(?:\s+[A-Za-z]+){2,}/.test(text)
  )
    return fallback;
  return text;
}
