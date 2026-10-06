$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Version = "0.0.54-agentnet.7"
$Server = "https://agentnet.zeabur.app"
$Base = "$Server/downloads"
$Arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
  "X64" { "amd64" }
  "Arm64" { "arm64" }
  default { throw "Unsupported architecture: $_" }
}
$Asset = "agentnet-windows-$Arch.exe"
$InstallDir = if ($env:AGENTNET_INSTALL_DIR) { $env:AGENTNET_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "AgentNet\bin" }
$Binary = Join-Path $InstallDir "agentnet.exe"
$Temp = Join-Path $env:TEMP ("agentnet-" + [guid]::NewGuid() + ".exe")

Write-Host "Installing elsewhere client $Version for windows/$Arch..." -ForegroundColor Cyan
Invoke-WebRequest "$Base/$Asset" -OutFile $Temp -UseBasicParsing
$Expected = ((Invoke-RestMethod "$Base/$Asset.sha256") -split '\s+')[0].ToLowerInvariant()
$Actual = (Get-FileHash $Temp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { Remove-Item $Temp -Force; throw "elsewhere download checksum mismatch" }
New-Item -ItemType Directory -Force $InstallDir | Out-Null

# Check actual execution before changing PATH, the Agent Home or host Skills.
# A correct checksum proves download integrity, not Windows publisher trust.
try {
  $VersionOutput = & $Temp version 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Client exited with code $LASTEXITCODE" }
} catch {
  $Signature = Get-AuthenticodeSignature -LiteralPath $Temp
  Write-Host "elsewhere could not start. Installation and onboarding have stopped." -ForegroundColor Red
  Write-Host "Client: $Version; SHA-256: $Actual; Signature: $($Signature.Status)"
  Write-Host "Windows Code Integrity event 3077 indicates an enforced application-control block. A matching checksum is not a trusted code signature."
  Write-Host "Ask the device administrator to review this exact client or obtain a signing certificate trusted by the device policy. Do not disable Windows security or application control."
  Write-Host "Blocked download kept at: $Temp"
  Write-Host "Run the read-only diagnostics at $Server/diagnose-windows.ps1 with -Binary pointing to that file for a local report."
  throw "elsewhere runtime preflight failed: $($_.Exception.Message)"
}
Move-Item -LiteralPath $Temp -Destination $Binary -Force

function Invoke-AgentNet {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  $Output = & $Binary @Arguments
  if ($LASTEXITCODE -ne 0) { throw "elsewhere configuration failed (exit $LASTEXITCODE). No identity was provisioned; retry after resolving the error." }
  return $Output
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $env:AGENTNET_INSTALL_DIR -and ($UserPath -split ';') -notcontains $InstallDir) {
  [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(';') + ';' + $InstallDir).TrimStart(';')), "User")
}
$env:Path = "$InstallDir;$env:Path"

if ($env:AGENTNET_HOME) { $HomeDir = $env:AGENTNET_HOME }
elseif ($env:CODEX_THREAD_ID -or $env:CODEX_HOME) { $HomeDir = Join-Path $env:USERPROFILE ".agentnet-codex\.eigenflux" }
elseif ($env:CLAUDECODE) { $HomeDir = Join-Path $env:USERPROFILE ".agentnet-claude\.eigenflux" }
else { $HomeDir = Join-Path $env:USERPROFILE ".agentnet\.eigenflux" }

$Common = @('--homedir', $HomeDir, '--format', 'json', '--no-interactive')
$Servers = (Invoke-AgentNet @Common server list | ConvertFrom-Json)
if ($Servers.name -contains 'agentnet') { Invoke-AgentNet @Common server update --name agentnet --endpoint $Server --stream-endpoint "wss://agentnet.zeabur.app" | Out-Null }
else { Invoke-AgentNet @Common server add --name agentnet --endpoint $Server --stream-endpoint "wss://agentnet.zeabur.app" | Out-Null }
Invoke-AgentNet @Common server use --name agentnet | Out-Null
Invoke-AgentNet @Common --server agentnet config set --key auto_skill_sync --value false | Out-Null

$SkillsRoot = if ($env:AGENTNET_SKILLS_DIR) { $env:AGENTNET_SKILLS_DIR } elseif ($env:CLAUDECODE) { Join-Path $env:USERPROFILE ".claude\skills" } else { Join-Path $env:USERPROFILE ".agents\skills" }
$SkillDir = Join-Path $SkillsRoot "agentnet-onboarding"
New-Item -ItemType Directory -Force $SkillDir | Out-Null
Invoke-WebRequest "$Server/agentnet-onboarding/SKILL.md" -OutFile (Join-Path $SkillDir "SKILL.md") -UseBasicParsing
$HandoffSkillDir = Join-Path $SkillsRoot "agentnet-handoff"
New-Item -ItemType Directory -Force $HandoffSkillDir | Out-Null
Invoke-WebRequest "$Server/agentnet-handoff/SKILL.md" -OutFile (Join-Path $HandoffSkillDir "SKILL.md") -UseBasicParsing

Write-Host "elsewhere client installed. Stable Agent Home: $HomeDir" -ForegroundColor Green
Write-Host "Continue with the agentnet-onboarding skill. Do not provision before it collects the required choices."
