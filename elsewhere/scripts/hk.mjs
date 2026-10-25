#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { signedArtifacts } from './ci-release-artifacts.mjs';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const instance = 'i-j6c3egnl5bzb0itdjs7d';
const region = 'cn-hongkong';
const profile = 'elsewhere-hk';
export const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function local(command, args) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
}

function remote(command) {
  const result = spawnSync(
    'workbench',
    [
      'exec',
      '--profile',
      profile,
      '--region',
      region,
      '--instance-id',
      instance,
      '--timeout',
      '40',
      '--output',
      'json',
      '--command',
      command,
    ],
    { encoding: 'utf8', timeout: 55_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      result.stderr || result.stdout || 'Workbench 未返回执行结果。',
    );
  }
  if (result.status !== 0 || response.exit_code !== 0) {
    throw new Error(
      response.stderr ||
        response.output ||
        result.stderr ||
        '远程命令执行失败。',
    );
  }
  return response.output.trim();
}

export function validateOrigin(origin) {
  if (!/^https:\/\/[a-zA-Z0-9.-]+$/.test(origin))
    throw new Error('服务器正式入口无效，停止操作。');
  return origin;
}
function productionOrigin() {
  return validateOrigin(
    remote(
      "docker inspect elsewhere-core --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PUBLIC_BASE_URL=//p'",
    ),
  );
}

export function releaseJob(revision, artifacts = []) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('需要完整的 40 位 Git 提交。');
  return `set -Eeuo pipefail
umask 077
exec 9>/srv/elsewhere/deploy.lock
flock -n 9 || { echo '已有发布正在运行。' >&2; exit 1; }
mountpoint -q /srv/elsewhere
revision=${quote(revision)}
root="/srv/elsewhere/releases/hk-code-$revision"
if [[ "$(readlink -f /srv/elsewhere/current)" == "$root" ]]; then
  echo "ALREADY_LIVE $revision"
  exit 0
fi
mkdir -p "$root/evidence" "$root/artifacts"
command -v unzip >/dev/null
available=$(df --output=avail -B1 /srv/elsewhere | tail -1)
(( available >= 8589934592 )) || { echo '发布前磁盘检查失败：至少需要 8 GiB 可用空间。' >&2; exit 1; }
printf %s ${quote(Buffer.from(JSON.stringify(artifacts)).toString('base64'))} | base64 -d > "$root/artifacts/manifest.json"
# Start all signed downloads together before GitHub's short-lived URLs expire.
pids=()
for service in core web gorse sync; do
  (
    url=$(jq -er --arg service "$service" '.[] | select(.service==$service) | .url' "$root/artifacts/manifest.json")
    digest=$(jq -er --arg service "$service" '.[] | select(.service==$service) | .digest' "$root/artifacts/manifest.json")
    curl --fail --silent --show-error --retry 2 --connect-timeout 15 --max-time 600 "$url" -o "$root/artifacts/$service.zip"
    printf '%s  %s\n' "$digest" "$root/artifacts/$service.zip" | sha256sum --check --status
    echo "DOWNLOADED $service"
  ) &
  pids+=("$!")
done
failed=0
for pid in "\${pids[@]}"; do wait "$pid" || failed=1; done
rm -f "$root/artifacts/manifest.json"
(( failed == 0 )) || { echo 'CI 镜像下载失败；未切换线上服务，可重新运行发布。' >&2; exit 1; }
cd /srv/elsewhere/builds/release-20261018
test -z "$(git status --porcelain --untracked-files=no)"
git fetch origin main
test "$(git rev-parse FETCH_HEAD)" = "$revision"
git checkout --detach "$revision"
test ! -e "$root/ACTIVATED"
if [[ ! -f "$root/BUILT" ]]; then
  bash elsewhere/scripts/aliyun-hk-code-release.sh import "$revision"
fi
bash elsewhere/scripts/aliyun-hk-code-release.sh activate "$revision"
`;
}

async function verify(revision) {
  const origin = productionOrigin();
  const response = await fetch(`${origin}/release.json?verify=${Date.now()}`, {
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`公网版本检查失败：HTTP ${response.status}`);
  const release = await response.json();
  if (release.revision !== revision)
    throw new Error('公网版本与目标提交不一致。');
  console.log(`已核验公网版本：${revision}\n${origin}/`);
}

export function validateUnit(unit) {
  if (!/^elsewhere-release-[a-f0-9]{12}-[0-9]{13}$/.test(unit)) {
    throw new Error('发布任务名称无效。');
  }
  return unit;
}

// systemd expands ${...} in ExecStart arguments before Bash sees them.
// Execute a private file instead; also keep signed URLs out of unit descriptions.
export function backgroundJob(unit, script) {
  validateUnit(unit);
  const path = `/srv/elsewhere/staging/${unit}.sh`;
  const payload = Buffer.from(`trap 'rm -f -- "$0"' EXIT\n${script}`).toString('base64');
  return `set -e; umask 077; mkdir -p /srv/elsewhere/staging; printf %s ${quote(payload)} | base64 -d > ${quote(path)}; systemd-run --unit=${quote(unit)} --description=${quote(`Elsewhere release ${unit}`)} --property=Type=exec --property=RemainAfterExit=yes /bin/bash ${quote(path)}`;
}

async function watch(unit, revision) {
  validateUnit(unit);
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('需要完整的 40 位 Git 提交。');
  let previous = '';
  let failures = 0;
  for (;;) {
    let output;
    try {
      output = remote(
      `systemctl show ${quote(unit)} -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus; journalctl -u ${quote(unit)} -n 12 --no-pager -o cat`,
      );
      failures = 0;
    } catch (error) {
      if (++failures >= 5) throw new Error(`状态连接暂不可用；服务器任务继续运行。恢复查看：npm run server:hk -- watch ${unit} ${revision}\n${error.message}`);
      if (failures === 1) console.log('状态连接暂时中断，正在自动重连；不会重复发布。');
      await new Promise(resolve => setTimeout(resolve, 10000));
      continue;
    }
    if (output !== previous) console.log(output);
    previous = output;
    if (output.includes('LoadState=not-found'))
      throw new Error('服务器上没有找到这个发布任务。');
    if (
      /^ActiveState=(failed|inactive)$/m.test(output) ||
      /^SubState=exited$/m.test(output)
    ) {
      if (
        !/^Result=success$/m.test(output) ||
        !/^ExecMainStatus=0$/m.test(output)
      ) {
        throw new Error(
          `发布失败。查看日志：npm run server:hk -- logs ${unit}`,
        );
      }
      await verify(revision);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function main(args) {
  const [action = 'help', ...rest] = args;
  if (action === 'plan') {
    console.log(releaseJob(rest[0] || local('git', ['rev-parse', 'HEAD'])));
    return;
  }
  if (action === 'status') {
    const origin = productionOrigin();
    const host = new URL(origin).hostname;
    console.log(
      remote(
        `set -e; readlink -f /srv/elsewhere/current; docker compose -f /srv/elsewhere/current/compose.json ps; curl -fsS --max-time 15 --resolve ${quote(`${host}:443:127.0.0.1`)} ${quote(`${origin}/release.json`)}`,
      ),
    );
    return;
  }
  if (action === 'shell') {
    const result = spawnSync(
      'workbench',
      [
        'connect',
        '--profile',
        profile,
        '--region',
        region,
        '--instance-id',
        instance,
      ],
      { stdio: 'inherit' },
    );
    if (result.error || result.status !== 0)
      throw result.error || new Error('连接失败。');
    return;
  }
  if (action === 'logs') {
    console.log(
      remote(
        `journalctl -u ${quote(validateUnit(rest[0] || ''))} -n 100 --no-pager -o cat`,
      ),
    );
    return;
  }
  if (action === 'watch') {
    await watch(rest[0], rest[1]);
    return;
  }
  if (action === 'deploy') {
    if (rest.length) throw new Error('发布始终使用远端 main，不接受其他参数。');
    if (local('git', ['branch', '--show-current']) !== 'main')
      throw new Error('请先切换到 main。');
    if (local('git', ['status', '--porcelain']))
      throw new Error('请先整理并提交本地修改。');
    local('git', ['fetch', 'origin', 'main']);
    const revision = local('git', ['rev-parse', 'origin/main']);
    if (local('git', ['rev-parse', 'HEAD']) !== revision)
      throw new Error('本地 main 与远端 main 不一致，请先安全整合。');
    const runs = JSON.parse(
      local('gh', [
        'run',
        'list',
        '--workflow',
        'elsewhere-core.yml',
        '--commit',
        revision,
        '--limit',
        '1',
        '--json',
        'status,conclusion,headSha,databaseId',
      ]),
    );
    if (
      !runs.length ||
      runs[0].headSha !== revision ||
      runs[0].status !== 'completed' ||
      runs[0].conclusion !== 'success'
    ) {
      throw new Error('目标提交的完整 CI 尚未通过，停止发布。');
    }
    const repository = local('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const listed = JSON.parse(local('gh', ['api', `repos/${repository}/actions/runs/${runs[0].databaseId}/artifacts?per_page=100`]));
    const artifacts = await signedArtifacts({artifacts: listed.artifacts, revision, repository, token: local('gh', ['auth', 'token'])});
    const unit = `elsewhere-release-${revision.slice(0, 12)}-${Date.now()}`;
    console.log(`发布 ${revision}\n任务 ${unit}`);
    console.log(
      `连接断开后继续查看：npm run server:hk -- watch ${unit} ${revision}`,
    );
    console.log(
      remote(
        backgroundJob(unit, releaseJob(revision, artifacts)),
      ),
    );
    await watch(unit, revision);
    return;
  }
  if (action !== 'help') throw new Error(`未知操作：${action}`);
  console.log(`npm run server:hk -- status                 查看线上版本与服务
npm run server:hk -- shell                  本机进入服务器终端
npm run server:hk -- plan                   查看发布脚本，不连接服务器
npm run server:hk -- logs <任务>            查看发布日志
npm run server:hk -- watch <任务> <提交>    恢复查看已发起的发布
npm run deploy:hk                          发布已通过 CI 的远端 main`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
