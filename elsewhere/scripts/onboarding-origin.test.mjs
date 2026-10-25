import { registrationOriginErrors } from './registration-origin.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const release = JSON.parse(
  readFileSync('elsewhere/web/public/release.json', 'utf8'),
);
function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? markdown(resolve(dir, e.name))
      : e.name.endsWith('.md')
        ? [resolve(dir, e.name)]
        : [],
  );
}
void test('published onboarding artifacts use the same current origin and contract', () => {
  const origin = new URL(release.public_origin);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.origin, release.public_origin);
  assert.equal(origin.hostname, release.migration_host);
  for (const installer of ['install.sh', 'install.ps1']) {
    const source = readFileSync('elsewhere/web/public/' + installer, 'utf8');
    const server = source.match(/(?:SERVER=|\$Server\s*=\s*)"([^"]+)"/)?.[1];
    assert.equal(server, release.public_origin, installer + ' origin');
    assert(source.includes(release.cli_version), installer + ' client version');
    assert(
      source.includes('wss://' + origin.host),
      installer + ' stream origin',
    );
  }
  const files = [
    'README.md',
    'docs/ONBOARDING_DESIGN.md',
    'docs/ADMIN_ANALYTICS.md',
    ...[
      'install.md',
      'install.sh',
      'install.ps1',
      'install-recruiter.md',
      'join.md',
    ].map((n) => 'elsewhere/web/public/' + n),
    ...['agentnet-onboarding', 'agentnet-social', 'agentnet-handoff'].flatMap(
      (n) => markdown('elsewhere/skills/' + n),
    ),
  ];
  for (const file of files)
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /elsewhere\.twintalk\.cn|agentnet(?:-next)?\.zeabur\.app/,
      file,
    );
  for (const file of [
    'elsewhere/web/public/install.md',
    'elsewhere/skills/agentnet-onboarding/SKILL.md',
    'core/cli/cmd/companion_plan.go',
  ])
    assert(
      readFileSync(file, 'utf8').includes(release.onboarding_version),
      file,
    );
});
void test('every installed onboarding reference exists in the distributed bundle', () => {
  for (const file of [
    'agentnet-onboarding',
    'agentnet-social',
    'agentnet-handoff',
  ].flatMap((n) => markdown('elsewhere/skills/' + n))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(https?:|#)/.test(link)) continue;
      assert(
        existsSync(resolve(dirname(file), link.split('#')[0])),
        file + ' -> ' + link,
      );
    }
  }
});

void test('registration links and browser permissions cannot drift after migration', () => {
  const valid = {
    PUBLIC_BASE_URL: 'https://inspiralai.com',
    CONSOLE_V2_PUBLIC_URL: 'https://inspiralai.com',
    CONSOLE_V2_ALLOWED_ORIGINS: 'https://inspiralai.com',
  };
  assert.deepEqual(registrationOriginErrors(valid), []);
  assert.deepEqual(
    registrationOriginErrors({ PUBLIC_BASE_URL: valid.PUBLIC_BASE_URL }),
    [],
  );
  assert(
    registrationOriginErrors({
      ...valid,
      CONSOLE_V2_PUBLIC_URL: 'https://elsewhere.twintalk.cn',
    }).some((x) => x.includes('CONSOLE_V2_PUBLIC_URL')),
  );
  assert(
    registrationOriginErrors({
      ...valid,
      CONSOLE_V2_ALLOWED_ORIGINS: 'https://elsewhere.twintalk.cn',
    }).some((x) => x.includes('CONSOLE_V2_ALLOWED_ORIGINS')),
  );
  assert(
    registrationOriginErrors({
      ...valid,
      PUBLIC_BASE_URL: 'https://inspiralai.com/path',
    }).length,
  );
});
