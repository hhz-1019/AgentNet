// Actual CLI + actual installers in isolated Homes. Downloads are local fixtures;
// no production identity, credential, browser, SMS or scheduler is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  symlink,
  lstat,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(file, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(file, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });
}
const fixtureCurl = `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto');
const args=process.argv.slice(2),url=args.find(x=>x.startsWith('https://'));
if(!url||new URL(url).origin!=='https://inspiralai.com')process.exit(22);
const resource=new URL(url).pathname.slice(1);
fs.appendFileSync(process.env.INSTALL_TEST_CALLS,resource+'\\n');
if(resource===process.env.INSTALL_TEST_FAIL)process.exit(22);
let bytes;if(resource.startsWith('downloads/agentnet-')){
 const binary=fs.readFileSync(process.env.INSTALL_TEST_BINARY);
 bytes=resource.endsWith('.sha256')?Buffer.from(crypto.createHash('sha256').update(binary).digest('hex')+'  fixture\\n'):binary;
}else{
 if(!/^(agentnet-onboarding|agentnet-social|agentnet-handoff)\\//.test(resource)||resource.includes('..'))process.exit(22);
 bytes=fs.readFileSync(p.join(process.env.INSTALL_TEST_REPO,'eigenflux/skills',resource));
 if(resource===process.env.INSTALL_TEST_OUTDATED)bytes=Buffer.from('https://elsewhere.twintalk.cn');
 if(resource===process.env.INSTALL_TEST_HTML)bytes=Buffer.from('<!doctype html><html><body>SPA fallback</body></html>');
}
const index=args.indexOf('-o');if(index>=0){fs.writeFileSync(args[index+1],bytes);if(resource.startsWith('downloads/')&&!resource.endsWith('.sha256'))fs.chmodSync(args[index+1],0o700);}else process.stdout.write(bytes);
`;

export async function verifyInstallerUpgrade(
  binary,
  { powershell = process.platform === 'win32' } = {},
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'elsewhere installer ')),
  );
  const repo = resolve('.');
  const windows = process.platform === 'win32';
  const binaryName = powershell ? 'agentnet.exe' : 'agentnet';
  const cases = [
    'codex',
    'custom',
    'registered',
    'claude',
    ...(!powershell ? ['zsh-profile'] : []),
    'symlink',
    'network-failure',
    'outdated-rule',
    'html-reference',
  ];
  try {
    for (const scenario of cases) {
      const user = join(
          root,
          scenario,
          ['custom', 'zsh-profile'].includes(scenario)
            ? "user's home"
            : 'user home',
        ),
        bin =
          scenario === 'zsh-profile'
            ? join(user, '.local', 'bin')
            : join(user, 'bin'),
        mocks = join(user, 'mocks');
      const codex = join(user, 'codex custom home');
      const home =
        scenario === 'claude'
          ? join(user, '.agentnet-claude', '.eigenflux')
          : join(user, '.agentnet-codex', '.eigenflux');
      const standard = join(
        user,
        scenario === 'claude' ? '.claude' : '.agents',
        'skills',
      );
      const selected = ['custom', 'registered'].includes(scenario)
        ? join(user, 'custom skill folder')
        : standard;
      const legacy = join(codex, 'skills');
      await Promise.all([
        mkdir(bin, { recursive: true }),
        mkdir(mocks, { recursive: true }),
        mkdir(home, { recursive: true }),
      ]);
      const config = {
        default_server: 'agentnet',
        servers: [
          {
            name: 'agentnet',
            endpoint: 'https://elsewhere.twintalk.cn',
            stream_endpoint: 'wss://elsewhere.twintalk.cn',
            kv: { owner_choice: 'preserve' },
          },
          {
            name: 'another-network',
            endpoint: 'https://example.invalid',
            kv: { untouched: 'yes' },
          },
        ],
      };
      const before = JSON.stringify(config);
      await writeFile(join(home, 'config.json'), before);
      const credential = join(
        home,
        'servers',
        'agentnet',
        'agent-v2-credentials.json',
      );
      await mkdir(dirname(credential), { recursive: true });
      const identity =
        '{"agent_id":"fixture-stable-identity","access_token":"fixture-only"}';
      await writeFile(credential, identity);
      if (scenario === 'registered')
        await writeFile(
          join(home, 'skills-target.json'),
          JSON.stringify({ path: selected, host: 'codex' }),
        );
      for (const name of [
        'agentnet-onboarding',
        'agentnet-social',
        'agentnet-handoff',
      ]) {
        await mkdir(join(legacy, name, 'references'), { recursive: true });
        await writeFile(
          join(legacy, name, 'SKILL.md'),
          'old elsewhere.twintalk.cn rule',
        );
        if (scenario === 'symlink') {
          await mkdir(standard, { recursive: true });
          await symlink(
            join(legacy, name),
            join(standard, name),
            windows ? 'junction' : 'dir',
          );
        }
      }
      await mkdir(join(legacy, 'unrelated-skill'), { recursive: true });
      await writeFile(
        join(legacy, 'unrelated-skill', 'SKILL.md'),
        'do not modify',
      );
      await writeFile(join(bin, binaryName), 'old installed binary');
      const mockPath = join(mocks, 'fixture-curl.cjs');
      await writeFile(mockPath, fixtureCurl, { mode: 0o700 });
      if (!windows)
        await writeFile(join(mocks, 'curl'), fixtureCurl, { mode: 0o700 });
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (
          /^(AGENTNET_|EIGENFLUX_|CODEX_|CLAUDECODE$|INVOKING_HOST$)/.test(key)
        )
          delete env[key];
      Object.assign(env, {
        HOME: user,
        USERPROFILE: user,
        LOCALAPPDATA: join(user, 'AppData'),
        CODEX_HOME: codex,
        AGENTNET_INSTALL_DIR: bin,
        INSTALL_TEST_BINARY: resolve(binary),
        INSTALL_TEST_REPO: repo,
        INSTALL_TEST_CALLS: join(user, 'downloads.txt'),
        PATH: mocks + (windows ? ';' : ':') + process.env.PATH,
      });
      if (scenario === 'zsh-profile') {
        delete env.AGENTNET_INSTALL_DIR;
        env.SHELL = '/bin/zsh';
      }
      if (scenario === 'claude') env.INVOKING_HOST = 'claude-code/1.0';
      if (scenario === 'custom') {
        env.AGENTNET_SKILLS_DIR = selected;
        env.AGENTNET_HOME = dirname(home);
      }
      if (scenario === 'network-failure')
        env.INSTALL_TEST_FAIL =
          'agentnet-social/references/feed-baseline-contract.md';
      if (scenario === 'outdated-rule')
        env.INSTALL_TEST_OUTDATED = 'agentnet-social/references/actions.md';
      if (scenario === 'html-reference')
        env.INSTALL_TEST_HTML = 'agentnet-social/references/actions.md';
      let result;
      if (powershell) {
        const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
        const runner = join(user, 'run-installer.ps1');
        await writeFile(
          runner,
          `function Invoke-WebRequest { param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing)\n & ${psQuote(process.execPath)} ${psQuote(mockPath)} $Uri -o $OutFile\n if ($LASTEXITCODE -ne 0) { throw 'fixture download failed' }\n}\nfunction Invoke-RestMethod { param([string]$Uri)\n $Value = & ${psQuote(process.execPath)} ${psQuote(mockPath)} $Uri\n if ($LASTEXITCODE -ne 0) { throw 'fixture download failed' }\n return $Value\n}\n. ${psQuote(join(repo, 'eigenflux/web/public/install.ps1'))}\n`,
        );
        result = await run(
          process.env.AGENTNET_POWERSHELL || 'pwsh',
          ['-NoProfile', '-NonInteractive', '-File', runner],
          { env, cwd: user },
        );
      } else
        result = await run(
          'sh',
          [join(repo, 'eigenflux/web/public/install.sh')],
          { env, cwd: user },
        );
      if (
        ['network-failure', 'outdated-rule', 'html-reference'].includes(
          scenario,
        )
      ) {
        assert.notEqual(result.code, 0, scenario);
        assert.equal(
          await readFile(join(bin, binaryName), 'utf8'),
          'old installed binary',
        );
        assert.equal(await readFile(join(home, 'config.json'), 'utf8'), before);
        assert.equal(
          await readFile(join(legacy, 'agentnet-onboarding/SKILL.md'), 'utf8'),
          'old elsewhere.twintalk.cn rule',
        );
      } else {
        assert.equal(
          result.code,
          0,
          scenario + ': ' + result.stderr + ' ' + result.stdout,
        );
        const after = JSON.parse(
          await readFile(join(home, 'config.json'), 'utf8'),
        );
        const network = after.servers.find((s) => s.name === 'agentnet');
        assert.equal(network.endpoint, 'https://inspiralai.com');
        assert.equal(network.stream_endpoint, 'wss://inspiralai.com');
        assert.equal(network.kv.owner_choice, 'preserve');
        assert.equal(network.kv.auto_skill_sync, 'false');
        assert.deepEqual(
          after.servers.find((s) => s.name === 'another-network'),
          config.servers[1],
        );
        const target = JSON.parse(
          await readFile(join(home, 'skills-target.json'), 'utf8'),
        );
        assert.equal(resolve(target.path), resolve(selected));
        const pathResult = await run(
          join(bin, binaryName),
          ['--homedir', home, 'skills', 'path'],
          { env },
        );
        assert.equal(pathResult.code, 0, pathResult.stderr);
        assert.equal(resolve(pathResult.stdout.trim()), resolve(selected));
        const fresh = await readFile(
          join(selected, 'agentnet-onboarding/SKILL.md'),
          'utf8',
        );
        assert(fresh.includes('inspiralai.com'));
        assert(!fresh.includes('elsewhere.twintalk.cn'));
        const legacyRule = await readFile(
          join(legacy, 'agentnet-onboarding/SKILL.md'),
          'utf8',
        );
        assert.equal(
          legacyRule,
          ['custom', 'claude'].includes(scenario)
            ? 'old elsewhere.twintalk.cn rule'
            : fresh,
        );
        if (scenario === 'symlink')
          assert(
            (
              await lstat(join(standard, 'agentnet-onboarding'))
            ).isSymbolicLink(),
          );
        assert(result.stdout.includes(home));
        if (scenario === 'zsh-profile' && !powershell) {
          const loaded = await run(
            'sh',
            ['-c', '. "$HOME/.zprofile"; command -v agentnet'],
            { env },
          );
          assert.equal(loaded.code, 0, loaded.stderr);
          assert.equal(loaded.stdout.trim(), join(bin, binaryName));
        }
      }
      assert.equal(
        await readFile(credential, 'utf8'),
        identity,
        scenario + ' replaced identity',
      );
      assert.equal(
        await readFile(join(legacy, 'unrelated-skill/SKILL.md'), 'utf8'),
        'do not modify',
      );
      const requests = await readFile(env.INSTALL_TEST_CALLS, 'utf8');
      assert(!requests.includes('/api/'));
      console.log('PASS installer: ' + scenario);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function buildCLI() {
  const root = await mkdtemp(join(tmpdir(), 'elsewhere-installer-cli-'));
  try {
    await cp('upstream/eigenflux/cli', join(root, 'cli'), { recursive: true });
    let result = await run('git', ['init', '--quiet'], { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    for (const name of ['social-workspace', 'account-connection']) {
      result = await run(
        'git',
        [
          'apply',
          '--include=cli/*',
          '--ignore-space-change',
          resolve('eigenflux/patches/' + name + '.patch'),
        ],
        { cwd: root },
      );
      assert.equal(result.code, 0, result.stderr);
    }
    await cp('eigenflux/overlay/cli', join(root, 'cli'), { recursive: true });
    const version = JSON.parse(
      await readFile('eigenflux/web/public/release.json', 'utf8'),
    ).cli_version;
    const binary = join(
      root,
      process.platform === 'win32' ? 'agentnet.exe' : 'agentnet',
    );
    result = await run(
      process.env.AGENTNET_GO_BINARY || 'go',
      ['build', '-ldflags=-X main.Version=' + version, '-o', binary, '.'],
      { cwd: join(root, 'cli') },
    );
    assert.equal(result.code, 0, result.stderr);
    await verifyInstallerUpgrade(binary, {
      powershell:
        process.argv.includes('--powershell') || process.platform === 'win32',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.env.AGENTNET_INSTALLER_TEST_CLI)
    await verifyInstallerUpgrade(process.env.AGENTNET_INSTALLER_TEST_CLI, {
      powershell:
        process.argv.includes('--powershell') || process.platform === 'win32',
    });
  else await buildCLI();
}
