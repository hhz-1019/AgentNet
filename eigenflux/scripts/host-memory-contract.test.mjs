import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
void test('join, both installers and generated patrol ship the same host-memory contract', () => {
  const policy = read('skills/agentnet-social/references/host-context.md');
  for (const capability of [
    '原生记忆',
    '历史',
    '只有当前对话',
    '没有持久化',
    '没有调度工具',
    'MCP',
    'HTTP',
  ])
    assert(policy.includes(capability), capability);
  for (const installer of ['web/public/install.sh', 'web/public/install.ps1']) {
    const text = read(installer);
    for (const resource of [
      'behavior.md',
      'activity.md',
      'daily-review.md',
      'host-context.md',
    ]) {
      assert(
        text.includes('references/' + resource),
        installer + ' missing ' + resource,
      );
      assert(
        existsSync(
          new URL(
            '../skills/agentnet-social/references/' + resource,
            import.meta.url,
          ),
        ),
      );
    }
  }
  for (const source of [
    'web/public/install.md',
    'skills/agentnet-onboarding/SKILL.md',
    'skills/agentnet-social/references/behavior.md',
    'skills/agentnet-social/references/daily-review.md',
    'overlay/cli/cmd/companion_plan.go',
  ]) {
    const text = read(source);
    assert(text.includes('host-context'), source);
    assert.doesNotMatch(
      text,
      /简介至少 500 字|记忆至少 20 条|每条至少 300 字|画像至少/,
    );
  }
  assert(policy.includes('不能先制作素材再倒推理由'));
  assert(policy.includes('只在本轮内组织必要材料'));
});
void test('registration has no event editor; archives have an owner-only export route', () => {
  const editor = read('web/social/portrait.tsx');
  assert(!editor.includes('记一件事'));
  assert(editor.includes('导出旧资料'));
  const routes = read('overlay/api/consolev2/portrait_handlers.go');
  assert(
    routes.includes('"/api/v2/console/portrait/export", s.consoleAuth(false)'),
  );
  assert(!routes.includes('/api/v2/agent-context/portrait/export'));
  const exportCode = read('overlay/api/consolev2/host_profile.go');
  for (const oldSource of [
    'portrait_memories',
    'twin_episodic_memory',
    'twin_semantic_memory',
    'twin_relationships',
    'twin_working_memory',
    'agent_onboarding_drafts',
  ])
    assert(exportCode.includes(oldSource));
  const migration = read('overlay/migrations/000139_host_memory_archive.sql');
  assert(!/DELETE FROM|DROP TABLE|TRUNCATE/.test(migration));
  assert(migration.includes('ON CONFLICT(user_id) DO NOTHING'));
});

void test('release, consent and host packaging advertise the current contract', () => {
  const release = JSON.parse(read('web/public/release.json'));
  assert.equal(release.portrait_prefill_version, 'host-context-2026-10-16');
  assert.equal(release.behavior_version, release.portrait_prefill_version);
  assert(read('web/twin.ts').includes("AGREEMENT_VERSION = '2026-10-16'"));
  assert(read('overlay/api/consolev2/twin_handlers.go').includes('2026-10-16'));
  assert(read('Dockerfile.host').includes('COPY eigenflux/skills/ ./skills/'));
});

void test('live Feed rules are identical across API, CLI and installed references', () => {
 for (const [name, api, cli] of [
  ['feed-contract.md','elsewhere.md','elsewhere_feed.md'],
  ['feed-baseline-contract.md','elsewhere_baseline.md','elsewhere_feed_baseline.md'],
 ]) {
  const source=read('skills/agentnet-social/references/'+name);
  assert.equal(read('overlay/pkg/feedcontract/'+api),source);
  assert.equal(read('overlay/cli/cmd/'+cli),source);
  for (const installer of ['web/public/install.sh','web/public/install.ps1']) assert(read(installer).includes('references/'+name));
 }
 const patches=read('patches/account-connection.patch');
 assert(patches.includes('feedcontract.ElsewhereForMode(mode)'));
 assert(patches.includes('feedcontract.ElsewhereForMode("intent_aligned")'));
 assert(patches.includes('normalizeElsewhereFeed(serverName, resp.Data)'));
 assert(patches.includes('normalizeElsewhereFeed(serverName, payload)'));
 assert.equal((patches.match(/return elsewhereHostReview\(cmd\)/g)||[]).length,1);
 assert(read("overlay/cli/cmd/profile_refresh_task.go").includes("return elsewhereHostReview(cmd)"));
});
