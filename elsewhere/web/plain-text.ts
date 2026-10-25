// Display only: keep the saved text, editor values and Agent instructions intact.
// Return text to React, never HTML or styled emphasis elements.
export function plainText(value: string | null | undefined): string {
  if (!value) return '';
  const literals: string[] = [];
  const keep = (text: string) => `\uE000${literals.push(text) - 1}\uE000`;
  let text = value.replace(/\r\n?/g, '\n');
  text = text
    .replace(
      /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm,
      (_, _fence, body: string) => keep(body.replace(/\n$/, '')),
    )
    .replace(/(`+)([^\n]*?)\1/g, (_, _ticks, code: string) => keep(code))
    .replace(/\\([\\`*_{}[\]()#+.!>~-])/g, (_, char: string) => keep(char))
    .replace(
      /!?\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
      (_, label: string, url: string) =>
        label === url ? label : `${label}（${keep(url)}）`,
    )
    .replace(/https?:\/\/[^\s\uE000）]+/g, (url) => keep(url))
    .replace(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm, '$1')
    .replace(/^ {0,3}(?:>[ \t]?)+/gm, '')
    .replace(/^([ \t]*)[-+*][ \t]+(?:\[[ xX]\][ \t]+)?/gm, '$1• ')
    .replace(/^ {0,3}(?:-{3,}|\*{3,}|_{3,}|={3,})[ \t]*$/gm, '');
  for (let pass = 0; pass < 3; pass++) {
    text = text
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
      .replace(
        /(?<![a-zA-Z0-9_])__(?=\S)([\s\S]*?\S)__(?![a-zA-Z0-9_])/gu,
        '$1',
      )
      .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
      .replace(/(?<!\*)\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1')
      .replace(/(?<![a-zA-Z0-9_])_(?=\S)([^_\n]*?\S)_(?![a-zA-Z0-9_])/gu, '$1');
  }
  return text
    .replace(
      /\uE000(\d+)\uE000/g,
      (_, index: string) => literals[Number(index)],
    )
    .trim();
}
