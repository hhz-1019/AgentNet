import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const safeSVG = (s) =>
  /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s) &&
  !/<\s*(?:script|foreignObject|iframe|object|embed|animate|set\b)|<\s*[\w-]+:|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|@import|(?:href|src)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(
    s,
  );

// Only decode a bounded, checksummed file envelope. Remote filenames are never paths.
export function deliveryFiles(artifact) {
  if (artifact.kind !== 'text') return [];
  const text = artifact.text || '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* Plain text is a valid deliverable. */
  }
  if (parsed?.format === 'elsewhere-svg-delivery-v1') {
    if (
      !Array.isArray(parsed.files) ||
      !parsed.files.length ||
      parsed.files.length > 8
    )
      throw new Error('Invalid delivery envelope');
    return parsed.files.map((file, index) => {
      if (
        file.encoding !== 'gzip+base64' ||
        typeof file.data !== 'string' ||
        file.data.length > 1048576
      )
        throw new Error('Invalid delivery encoding');
      const bytes = gunzipSync(Buffer.from(file.data, 'base64'), {
        maxOutputLength: 4 * 1024 * 1024,
      });
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
        throw new Error('Delivery integrity check failed');
      const svg = bytes.toString('utf8');
      if (!safeSVG(svg)) throw new Error('Unsafe SVG delivery');
      return {
        name: `file-${index + 1}.svg`,
        label: String(file.name || `作品 ${index + 1}`),
        bytes,
        image: true,
      };
    });
  }
  if (safeSVG(text))
    return [
      {
        name: 'artwork.svg',
        label: '可编辑作品.svg',
        bytes: Buffer.from(text),
        image: true,
      },
    ];
  return [
    {
      name: 'result.txt',
      label: '成果原文.txt',
      bytes: Buffer.from(text),
      image: false,
    },
  ];
}

export async function openDelivery(path) {
  const url = pathToFileURL(resolve(path)).href;
  const binary =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? '/usr/bin/open'
        : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise((ok, fail) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? ok() : fail(new Error('Delivery opener failed')),
    );
  });
}

export async function materializeDelivery(
  client,
  projectId,
  { notify = false, opener = openDelivery } = {},
) {
  let context = await client.collaboration_context({ project_id: projectId });
  const project = context.project;
  if (!project || project.project_id !== projectId)
    throw new Error('Wrong delivery project');
  const artifacts = [...(context.artifacts || [])];
  const cursors = new Set();
  while (context.has_more) {
    if (
      !Number.isSafeInteger(context.next_cursor) ||
      cursors.has(context.next_cursor)
    )
      throw new Error('Invalid artifact pagination');
    cursors.add(context.next_cursor);
    context = await client.collaboration_context({
      project_id: projectId,
      cursor: context.next_cursor,
    });
    if (context.project?.version !== project.version)
      throw new Error('Project changed during delivery');
    artifacts.push(...(context.artifacts || []));
  }
  const tasks = Object.values(project.tasks || {}).filter(
    (t) => t.state === 'accepted_result',
  );
  if (!tasks.length) throw new Error('No accepted deliverables');
  const directory = join(
    resolve(client.cliHome),
    'deliveries',
    hash(`${client.endpoint}\n${projectId}`).slice(0, 24),
    `v${project.version}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [],
    sections = [],
    notes = [
      `# 项目交付\n\n${project.goal}\n\n项目状态：${project.state === 'completed' ? '已完成' : '进行中，以下成果已验收'}\n`,
    ];
  for (const [index, task] of tasks.entries()) {
    const artifact = artifacts.find(
      (a) => a.task_id === task.task_id && a.version === task.artifact_version,
    );
    if (!artifact) throw new Error('Accepted artifact version missing');
    const title = `${task.title} · 第 ${task.artifact_version} 版`;
    let body = '';
    if (artifact.kind === 'https') {
      const uri = new URL(artifact.uri);
      if (uri.protocol !== 'https:' || uri.username || uri.password)
        throw new Error('Invalid delivery URL');
      body = `<p><a href="${escape(uri.href)}" rel="noreferrer">打开交付成果</a></p>`;
      files.push({ title, uri: uri.href, verifiedDownload: false });
      notes.push(
        `## ${title}\n\n成果地址：${uri.href}\n\n外部链接未自动下载，访问权限以成果提供方为准。\n`,
      );
    } else {
      for (const file of deliveryFiles(artifact)) {
        const name = `${index + 1}-${file.name}`,
          path = join(directory, name);
        await writeFile(path, file.bytes, { mode: 0o600 });
        files.push({
          title,
          name: file.label,
          path,
          sha256: hash(file.bytes),
          image: file.image,
        });
        body += `<p><a download="${escape(file.label)}" href="${name}">${escape(file.label)}</a></p>`;
        if (file.image)
          body += `<img alt="${escape(file.label)}" src="data:image/svg+xml;base64,${file.bytes.toString('base64')}">`;
        else body += `<pre>${escape(file.bytes.toString('utf8'))}</pre>`;
        notes.push(
          `## ${title}\n\n文件：[${file.label}](${name})\n\n${file.image ? '' : file.bytes.toString('utf8')}\n`,
        );
      }
    }
    notes.push(
      `来源说明：${artifact.provenance || '未提供'}\n\n提交者自检：${artifact.verification || '未提供'}\n`,
    );
    sections.push(
      `<section><h2>${escape(title)}</h2>${body}<details><summary>来源与自检</summary><p>${escape(artifact.provenance)}</p><p>${escape(artifact.verification)}</p></details></section>`,
    );
  }
  const report = join(directory, '交付文档.md'),
    page = join(directory, 'index.html');
  await writeFile(report, notes.join('\n'), { mode: 0o600 });
  await writeFile(
    page,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>项目交付</title><style>body{font:16px/1.6 system-ui;max-width:880px;margin:40px auto;padding:0 24px;color:#20252c}img{display:block;max-width:100%;max-height:80vh;margin:20px auto}section{border-top:1px solid #ddd;margin-top:30px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#1658a8}h1{font-size:26px}</style><h1>${escape(project.goal)}</h1><p>${project.state === 'completed' ? '项目已完成' : '已验收成果'}</p><a href="${encodeURIComponent('交付文档.md')}" download>下载交付文档</a>${sections.join('')}</html>`,
    { mode: 0o600 },
  );
  const result = {
    project_id: projectId,
    project_version: project.version,
    report,
    page,
    files,
    instruction:
      'Deliver these actual files to the owner now. Show image previews where supported, with clickable absolute file links and the delivery document. Never reply only that the task is complete. External URLs are not verified downloads.',
  };
  await writeFile(
    join(directory, 'delivery.json'),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  if (notify) {
    const receipt = join(directory, 'opened.json');
    const opened = await readFile(receipt, 'utf8').catch((e) => {
      if (e.code !== 'ENOENT') throw e;
      return null;
    });
    if (!opened) {
      try {
        await opener(page);
        await writeFile(
          receipt,
          JSON.stringify({ at: new Date().toISOString() }),
          { mode: 0o600 },
        );
        result.notification = 'opened';
      } catch {
        result.notification = 'open_failed';
      }
    } else result.notification = 'already_opened';
  }
  return result;
}
