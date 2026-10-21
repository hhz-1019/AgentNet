import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { quote, releaseJob, validateUnit, validateOrigin } from './hk.mjs';

const script = fileURLToPath(new URL('./hk.mjs', import.meta.url));
const revision = 'a'.repeat(40);

function fixture(action, settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-hk-test-'));
  const calls = join(dir, 'calls.jsonl');
  const stub = String.raw`#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HK_TEST_CALLS, JSON.stringify({name,args}) + '\n');
const config = JSON.parse(process.env.HK_TEST_CONFIG);
if (name === 'git') {
  if (args[0] === 'branch') console.log('main');
  if (args[0] === 'status') console.log(config.dirty ? ' M file' : '');
  if (args[0] === 'rev-parse') console.log('${revision}');
} else if (name === 'gh') {
  console.log(JSON.stringify([{headSha:'${revision}',status:'completed',conclusion:config.ci || 'success'}]));
} else {
  const output = args.at(-1).includes('PUBLIC_BASE_URL') ? (config.origin || 'https://inspiralai.com') : 'SERVER_STATUS';
  console.log(JSON.stringify({output:config.output || output,stderr:'',exit_code:config.remoteExit || 0}));
}
`;
  for (const name of ['git', 'gh', 'workbench'])
    writeFileSync(join(dir, name), stub, { mode: 0o700 });
  try {
    const result = spawnSync(process.execPath, [script, action], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        HK_TEST_CALLS: calls,
        HK_TEST_CONFIG: JSON.stringify(settings),
      },
    });
    assert.ok(!result.error, result.error?.message);
    const recorded = readFileSync(calls, 'utf8').trim();
    return { ...result, calls: recorded.split('\n').map(JSON.parse) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('remote shell quoting preserves literal quotes, substitutions and newlines', () => {
  const value = "it's literal: $(exit 99) `exit 98`\n第二行";
  const result = spawnSync('bash', ['-c', `printf '%s' ${quote(value)}`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, value);
});

void test('release job accepts only complete revisions and is valid bash', () => {
  assert.throws(() => releaseJob('main; exit 0'));
  assert.throws(() => releaseJob('a'.repeat(39)));
  const result = spawnSync('bash', ['-n'], {
    input: releaseJob(revision),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => validateUnit('other.service; exit 0'));
});

void test('dirty workspace prevents any remote or GitHub access', () => {
  const result = fixture('deploy', { dirty: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /提交本地修改/);
  assert.ok(result.calls.every((call) => call.name === 'git'));
});

void test('failed CI prevents starting a remote deployment', () => {
  const result = fixture('deploy', { ci: 'failure' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI 尚未通过/);
  assert.ok(!result.calls.some((call) => call.name === 'workbench'));
});

void test('status uses the fixed production target without executing the release job', () => {
  const result = fixture('status');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 2);
  const args = result.calls[1].args;
  assert.equal(
    args[args.indexOf('--instance-id') + 1],
    'i-j6c3egnl5bzb0itdjs7d',
  );
  assert.equal(args[args.indexOf('--profile') + 1], 'elsewhere-hk');
  assert.doesNotMatch(args.at(-1), /systemd-run|git checkout|activate/);
  assert.match(args.at(-1), /https:\/\/inspiralai\.com\/release\.json/);
});

void test('domain changes follow the live configuration and malformed values fail closed', () => {
  const changed = fixture('status', {
    origin: 'https://new-production.invalid',
  });
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.calls.at(-1).args.at(-1), /new-production\.invalid/);
  assert.throws(() => validateOrigin('https://example.com; echo bad'));
  assert.throws(() => validateOrigin('http://example.com'));
  const invalid = fixture('status', { origin: 'https://example.com/extra' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.calls.length, 1);
});

void test('remote nonzero exit cannot be reported as successful', () => {
  const result = fixture('status', { remoteExit: 1, output: 'FAILED_CHECK' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAILED_CHECK/);
});
