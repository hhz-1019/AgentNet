// Produce an offline, platform-specific pilot bundle from verified local runtimes.
// No download, publication, account provisioning or system configuration writes.
import { mkdir, cp, writeFile, readFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const options = {};
for (let i = 2; i < process.argv.length; i += 2)
  options[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
for (const key of [
  'stage',
  'cli',
  'node',
  'node-license',
  'platform',
  'endpoint',
])
  if (!options[key]) throw new Error(`Missing --${key}`);
if (
  !['windows-amd64', 'windows-arm64', 'darwin-amd64', 'darwin-arm64'].includes(
    options.platform,
  )
)
  throw new Error('Unsupported platform');
const endpoint = new URL(options.endpoint);
if (endpoint.protocol !== 'https:' || endpoint.origin + '/' !== endpoint.href)
  throw new Error('HTTPS origin required');
const out = resolve(
  'dist-collaboration-plugin',
  `pilot-${options.platform}-${Date.now()}`,
);
await mkdir(join(out, 'runtime'), { recursive: true });
const windows = options.platform.startsWith('windows');
const node = windows ? 'node.exe' : 'node',
  cli = windows ? 'elsewhere.exe' : 'elsewhere';
const arch = options.platform.split('-')[1];
for (const file of [options.node, options.cli]) {
  const bytes = await readFile(resolve(file));
  const valid = windows
    ? bytes.length > 64 &&
      bytes.toString('ascii', 0, 2) === 'MZ' &&
      bytes.readUInt32LE(60) + 6 < bytes.length &&
      bytes.toString(
        'ascii',
        bytes.readUInt32LE(60),
        bytes.readUInt32LE(60) + 4,
      ) === 'PE\0\0' &&
      bytes.readUInt16LE(bytes.readUInt32LE(60) + 4) ===
        (arch === 'amd64' ? 0x8664 : 0xaa64)
    : bytes.length > 8 &&
      bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === (arch === 'amd64' ? 0x1000007 : 0x100000c);
  if (!valid) throw new Error('Runtime architecture mismatch: ' + file);
}
const pkg = JSON.parse(
  await readFile(join(resolve(options.stage), 'package.json'), 'utf8'),
);
if (
  pkg.name !== '@elsewhere/collaboration-plugin' ||
  pkg.version !== '0.0.54-agentnet.37'
)
  throw new Error('Use the matching isolated plugin stage');
await cp(resolve(options.stage), join(out, 'plugin'), {
  recursive: true,
  errorOnExist: true,
});
await cp(
  join(resolve(options.stage), 'docs/COLLABORATION_VERIFICATION.md'),
  join(out, 'ACCEPTANCE.md'),
);
await cp(resolve(options.cli), join(out, 'runtime', cli));
await cp(resolve(options.node), join(out, 'runtime', node));
await cp(
  resolve(options['node-license']),
  join(out, 'runtime', 'NODE-LICENSE.txt'),
);
if (!windows) {
  await chmod(join(out, 'runtime', cli), 0o755);
  await chmod(join(out, 'runtime', node), 0o755);
}
const manifest = {
  version: '0.0.54-agentnet.29',
  platform: options.platform,
  endpoint: endpoint.origin,
  sha256: {},
};
for (const file of [`runtime/${node}`, `runtime/${cli}`])
  manifest.sha256[file] = createHash('sha256')
    .update(await readFile(join(out, file)))
    .digest('hex');
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(
  join(out, 'install.mjs'),
  `import {readFile,mkdir,cp} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
const source=dirname(fileURLToPath(import.meta.url));
try {
 const m=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
 const platform=(process.platform==='win32'?'windows':process.platform)+'-'+(process.arch==='x64'?'amd64':process.arch);
 if(platform!==m.platform) throw new Error('安装包与当前系统或芯片不匹配。');
 for(const [file,hash] of Object.entries(m.sha256)) if(createHash('sha256').update(await readFile(join(source,file))).digest('hex')!==hash) throw new Error('安装包校验失败，请重新获取。');
 let host=process.argv[2];
 if(!host) {const rl=createInterface({input:process.stdin,output:process.stdout});try {host=(await rl.question('安装到哪个宿主？codex / claude-code / generic [codex]: ')).trim()||'codex';}finally{rl.close();}}
 if(!['codex','claude-code','generic'].includes(host)) throw new Error('不支持该宿主名称。');
 const target=join(homedir(),'.elsewhere','plugins',m.version+'-'+randomUUID());
 await mkdir(target,{recursive:true});await cp(source,target,{recursive:true});
 const {setup}=await import(pathToFileURL(join(target,'plugin/elsewhere/client/collaboration-setup.mjs')).href);
 const result=await setup({host,endpoint:m.endpoint,cli:join(target,'runtime/${cli}'),node:join(target,'runtime/${node}')});
 console.log(result.next);
 if(host==='generic') console.log('MCP 配置文件：'+result.configuration);
} catch(e) {console.error('安装未完成：'+e.message);process.exitCode=1;}
`,
);
if (windows)
  await writeFile(
    join(out, 'Install.cmd'),
    '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0install.mjs"\r\npause\r\n',
  );
else {
  await writeFile(
    join(out, 'Install.command'),
    '#!/bin/sh\nset -eu\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n"$DIR/runtime/node" "$DIR/install.mjs"\n',
  );
  await chmod(join(out, 'Install.command'), 0o755);
}
await writeFile(
  join(out, 'README.txt'),
  'Elsewhere 双人协作内测候选包\n分发者须先发布并核验配套协作服务。本地安装通过不表示线上协作已经可用。\n解压到本地文件夹后，Windows 双击 Install.cmd；macOS 打开 Install.command。选择宿主，完成账号绑定后，在宿主中说：通过 Elsewhere 和 @对方短号一起完成任务。\n安装不会启用后台执行；后台任务需要单独授权。系统拦截未签名程序时请联系分发者，不要关闭系统安全保护。\n',
);
console.log(JSON.stringify({ directory: out, manifest }, null, 2));
