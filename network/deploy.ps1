param(
  [switch]$PackOnly,
  [string]$ProjectId = '6aab85aaa3a944a81c4aa45d',
  [string]$ServiceId = '6aab8647a3a944a81c4aa4ad',
  [string]$EnvironmentId = '6aab85aa5d09e6e2999161d4'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repo ('outputs/network-release-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $releaseDir | Out-Null
# Upload only public source. Never copy local state, user homes, .env, outputs or the old campus DB.
foreach ($name in @('package.json', 'package-lock.json', 'Dockerfile', '.dockerignore')) {
  Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $releaseDir
}
Copy-Item -LiteralPath (Join-Path $repo 'network') -Destination $releaseDir -Recurse
$manifest = Get-ChildItem -LiteralPath $releaseDir -File -Recurse | ForEach-Object {
  [ordered]@{ path = [IO.Path]::GetRelativePath($releaseDir, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseDir 'source-manifest.json') -Encoding utf8
Write-Output "Prepared source-only release: $releaseDir"
if ($PackOnly) { return }
Push-Location -LiteralPath $releaseDir
try {
  & npx --yes zeabur@latest deploy --project-id $ProjectId --service-id $ServiceId --environment-id $EnvironmentId --interactive=false
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check Zeabur login with npx zeabur auth status.' }
} finally { Pop-Location }
Write-Output 'Upload accepted. Deployment is not complete until Zeabur reports RUNNING and live /release.json and an end-to-end registration/MCP smoke test pass.'
