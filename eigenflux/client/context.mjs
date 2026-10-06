import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import {
  resolve,
  relative,
  dirname,
  extname,
  basename,
  isAbsolute,
} from 'node:path';
import { secretInDraft } from './work.mjs';

// Only a directory explicitly connected by the operator is searchable. Never scan Home.
export async function retrieveContext(directory, instruction) {
  if (!directory) return [];
  if (!isAbsolute(directory)) throw new Error('工作上下文目录必须是绝对路径');
  const root = await realpath(directory);
  const files = [];
  async function walk(dir, depth = 0) {
    if (depth > 4) return;
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.isSymbolicLink()
      )
        continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (/\.(md|txt|json)$/i.test(entry.name)) files.push(path);
      if (files.length > 200)
        throw new Error('已连接的上下文最多包含 200 份文档，请缩小连接范围');
    }
  }
  await walk(root);
  const terms = [
    ...new Set([
      ...(instruction.match(/[A-Za-z0-9_-]{2,}/g) || []),
      ...(instruction.match(/[\u3400-\u9fff]+/g) || []).flatMap((part) => {
        const result = [];
        for (let n = 2; n <= 6; n++)
          for (let i = 0; i + n <= part.length; i++)
            result.push(part.slice(i, i + n));
        return result;
      }),
    ]),
  ];
  const records = [];
  for (const path of files) {
    if ((await stat(path)).size > 64 * 1024) continue;
    const text = await readFile(path, 'utf8');
    if (secretInDraft(text)) continue;
    const haystack = (relative(root, path) + ' ' + text).toLowerCase();
    const score = terms.reduce(
      (n, t) => n + (haystack.includes(t.toLowerCase()) ? 1 : 0),
      0,
    );
    const media = [];
    for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      if (media.length === 4) break;
      if (m[2].startsWith('https://'))
        media.push({ url: m[2], alt: m[1] || '工作上下文配图', kind: 'image' });
      else if (!/^[a-z]+:/i.test(m[2])) {
        try {
          const image = await realpath(resolve(dirname(path), m[2]));
          if (
            !relative(root, image).startsWith('..') &&
            ['.png', '.jpg', '.jpeg'].includes(extname(image).toLowerCase())
          )
            media.push({
              local_path: image,
              alt: m[1] || '工作上下文配图',
              kind: 'image',
            });
        } catch {
          /* An unavailable image is not fabricated. */
        }
      }
    }
    records.push({
      work_id: 'context:' + relative(root, path),
      status: 'completed',
      shareable: true,
      title: (
        '项目工作：' +
        (text.match(/^#\s+(.+)$/m)?.[1] || basename(path, extname(path)))
      ).slice(0, 100),
      source: '已连接的工作上下文：' + relative(root, path),
      result: text.slice(0, 12000),
      evidence: '内容来自上述文档；仅陈述文档已有的工作过程和结果。',
      limitations:
        '本次整理未重新执行实验或测试；未被来源支持的结论不得写成已验证结果。',
      tags: ['工作分享'],
      media,
      score,
    });
  }
  return records
    .sort((a, b) => b.score - a.score || a.work_id.localeCompare(b.work_id))
    .slice(0, 6);
}

export async function attachImages(client, records) {
  const result = [];
  let remaining = 4;
  const uploaded = new Map();
  for (const record of records) {
    const media = [];
    for (const item of record.media || []) {
      if (remaining === 0) break;
      if (item.local_path) {
        if (!uploaded.has(item.local_path))
          uploaded.set(item.local_path, await client.upload_image(item));
        media.push(uploaded.get(item.local_path));
      } else media.push(item);
      remaining--;
    }
    result.push({ ...record, media });
  }
  return result;
}
