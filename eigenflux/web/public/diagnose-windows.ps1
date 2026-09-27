param([string]$Binary = (Join-Path $env:LOCALAPPDATA 'AgentNet\bin\agentnet.exe'))
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) { throw 'AgentNet client not found; provide -Binary with the installed client path.' }
$Resolved = (Resolve-Path -LiteralPath $Binary).Path
$Signature = Get-AuthenticodeSignature -LiteralPath $Resolved
$Report = [ordered]@{
  client = 'AgentNet'
  file_name = [IO.Path]::GetFileName($Resolved)
  sha256 = (Get-FileHash -LiteralPath $Resolved -Algorithm SHA256).Hash
  signature_status = [string]$Signature.Status
  publisher = if ($Signature.SignerCertificate) { $Signature.SignerCertificate.Subject } else { $null }
  architecture = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  language_mode = [string]$ExecutionContext.SessionState.LanguageMode
  recent_code_integrity_events = @()
  event_log_access = 'available'
}
try {
  $Events = Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';Id=3077,3033;StartTime=(Get-Date).AddDays(-7)} -ErrorAction Stop
  $Report.recent_code_integrity_events = @($Events | Where-Object { $_.Message -like '*agentnet*.exe*' } | Select-Object -First 10 | ForEach-Object {
    # No full event messages, usernames, local paths or credentials leave this script.
    [ordered]@{event_id=$_.Id; time=$_.TimeCreated.ToString('o')}
  })
} catch { $Report.event_log_access = 'unavailable_or_no_matching_events' }
$Report | ConvertTo-Json -Depth 4
Write-Host 'Read-only report. No credentials were read, no policy was changed, and no report was uploaded.'
