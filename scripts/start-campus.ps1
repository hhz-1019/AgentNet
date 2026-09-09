$ErrorActionPreference = 'Stop'
$campusRoot = Split-Path -Parent $PSScriptRoot
$campusConnection = Join-Path $campusRoot '.campus-local/connection.json'
if (-not (Test-Path -LiteralPath $campusConnection)) { throw '请先在 Codex 中完成校园账号配对。' }
$campusSettings = Get-Content -Raw -LiteralPath $campusConnection | ConvertFrom-Json
$campusLog = Join-Path $campusRoot '.campus-local/driver.log'
$campusErrorLog = Join-Path $campusRoot '.campus-local/driver-error.log'
Start-Process -FilePath $campusSettings.nodePath -ArgumentList @('"' + (Join-Path $PSScriptRoot 'campus-driver.mjs') + '"') -WorkingDirectory $campusRoot -WindowStyle Hidden -RedirectStandardOutput $campusLog -RedirectStandardError $campusErrorLog
Write-Output '校园角色连接已启动。本次最多运行 4 小时，可在网页里暂停思考或撤销连接。'
