import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexExecutorFromEnvironment } from './codex-executor.mjs';

void test('Codex process receives frozen decision on stdin and returns actual session receipt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-decision-'));
  try {
    const binary = join(home, 'fake-codex.mjs');
    await writeFile(
      binary,
      `
   import {readFileSync,writeFileSync} from 'node:fs';
   import assert from 'node:assert/strict';
   let input='';for await(const chunk of process.stdin) input+=chunk;
   assert(input.includes('原请求'));assert(input.includes('只写草稿'));
   assert(process.argv.includes('--output-schema'));
   assert(!process.argv.includes('--last'));assert(!process.argv.includes('--dangerously-bypass-approvals-and-sandbox'));
   const schema=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--output-schema')+1]));
   assert.equal(schema.additionalProperties,false);
   writeFileSync('approved-draft.txt','已获准的草稿');
   writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],
    JSON.stringify({status:'completed',summary:'已保存草稿。',evidence:'approved-draft.txt 已写入并读回。'}));
   process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'session-from-process'})+'\\n');
  `,
    );
    const executor = await codexExecutorFromEnvironment({
      ...process.env,
      AGENTNET_HOME: home,
      AGENTNET_EXECUTOR_ID: 'test_host',
      AGENTNET_CODEX_WORKSPACE: home,
      AGENTNET_CODEX_BINARY: binary,
    });
    const input = {
      command_id: '123',
      decision: {
        attention_snapshot: { body: '原请求' },
        condition: '只写草稿',
        authorization_scope: '只写当前目录',
      },
    };
    const result = await executor.execute(input, {
      signal: new AbortController().signal,
    });
    assert.equal(result.session_id, 'session-from-process');
    assert.equal(
      await readFile(join(home, 'approved-draft.txt'), 'utf8'),
      '已获准的草稿',
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(home, 'agentnet-runtime/executions/123/input.json'),
          'utf8',
        ),
      ),
      input,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
void test('invalid or overly broad executor binding is rejected', async () => {
  await assert.rejects(
    codexExecutorFromEnvironment({
      AGENTNET_EXECUTOR_ID: 'host',
      AGENTNET_CODEX_WORKSPACE: 'relative',
    }),
    /Bind/,
  );
  const home = await mkdtemp(join(tmpdir(), 'codex-binding-'));
  try {
    await assert.rejects(
      codexExecutorFromEnvironment({
        AGENTNET_EXECUTOR_ID: 'host',
        AGENTNET_CODEX_WORKSPACE: home,
        AGENTNET_CODEX_SANDBOX: 'danger-full-access',
      }),
      /sandbox/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
