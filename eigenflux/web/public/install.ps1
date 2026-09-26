$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Version = "agentnet-cli-v0.0.54-1"
$Repo = "hhz-1019/AgentNet"
$Server = "https://agentnet.zeabur.app"
$Base = "https://github.com/$Repo/releases/download/$Version"
$Arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
  "X64" { "amd64" }
  "Arm64" { "arm64" }
  default { throw "Unsupported architecture: $_" }
}
$Asset = "agentnet-windows-$Arch.exe"
$InstallDir = if ($env:AGENTNET_INSTALL_DIR) { $env:AGENTNET_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "AgentNet\bin" }
$Binary = Join-Path $InstallDir "agentnet.exe"
$Temp = Join-Path $env:TEMP ("agentnet-" + [guid]::NewGuid() + ".exe")

Write-Host "Installing AgentNet client $Version for windows/$Arch..." -ForegroundColor Cyan
Invoke-WebRequest "$Base/$Asset" -OutFile $Temp -UseBasicParsing
$Expected = ((Invoke-RestMethod "$Base/$Asset.sha256") -split '\s+')[0].ToLowerInvariant()
$Actual = (Get-FileHash $Temp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Actual -ne $Expected) { Remove-Item $Temp -Force; throw "AgentNet download checksum mismatch" }
New-Item -ItemType Directory -Force $InstallDir | Out-Null
Move-Item $Temp $Binary -Force

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($UserPath -split ';') -notcontains $InstallDir) {
  [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(';') + ';' + $InstallDir).TrimStart(';')), "User")
}
$env:Path = "$InstallDir;$env:Path"

if ($env:AGENTNET_HOME) { $HomeDir = $env:AGENTNET_HOME }
elseif ($env:CODEX_THREAD_ID -or $env:CODEX_HOME) { $HomeDir = Join-Path $env:USERPROFILE ".agentnet-codex\.eigenflux" }
elseif ($env:CLAUDECODE) { $HomeDir = Join-Path $env:USERPROFILE ".agentnet-claude\.eigenflux" }
else { $HomeDir = Join-Path $env:USERPROFILE ".agentnet\.eigenflux" }

$Common = @('--homedir', $HomeDir, '--format', 'json', '--no-interactive')
$Servers = (& $Binary @Common server list | ConvertFrom-Json)
if ($Servers.name -contains 'agentnet') { & $Binary @Common server update --name agentnet --endpoint $Server --stream-endpoint "wss://agentnet.zeabur.app" | Out-Null }
else { & $Binary @Common server add --name agentnet --endpoint $Server --stream-endpoint "wss://agentnet.zeabur.app" | Out-Null }
& $Binary @Common server use --name agentnet | Out-Null
& $Binary @Common --server agentnet config set --key auto_skill_sync --value false | Out-Null

$SkillsRoot = if ($env:CLAUDECODE) { Join-Path $env:USERPROFILE ".claude\skills" } else { Join-Path $env:USERPROFILE ".agents\skills" }
$SkillDir = Join-Path $SkillsRoot "agentnet-onboarding"
New-Item -ItemType Directory -Force $SkillDir | Out-Null
Invoke-WebRequest "https://raw.githubusercontent.com/$Repo/main/eigenflux/skills/agentnet-onboarding/SKILL.md" -OutFile (Join-Path $SkillDir "SKILL.md") -UseBasicParsing

Write-Host "AgentNet client installed. Stable Agent Home: $HomeDir" -ForegroundColor Green
Write-Host "Continue with the agentnet-onboarding skill. Do not provision before it collects the required choices."
