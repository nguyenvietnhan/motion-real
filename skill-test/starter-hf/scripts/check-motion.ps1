# Diagnostic only: freezedetect can identify a render failure, not story quality.
# Exit 0 = completed diagnostic (ok/findings); exit 2 = inconclusive.
param(
  [Parameter(Mandatory = $true)][string]$VideoPath,
  [double]$MaxFreeze = 4.0,
  [string]$Crop = "1080:1300:0:200",
  [string]$ReportPath
)

$ErrorActionPreference = "Stop"

function Write-Report([hashtable]$Report, [int]$ExitCode) {
  if ($ReportPath) {
    $parent = Split-Path -Parent $ReportPath
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $Report | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $ReportPath
  }
  $Report | ConvertTo-Json -Depth 6
  exit $ExitCode
}

try {
  if (-not (Test-Path -LiteralPath $VideoPath -PathType Leaf)) {
    Write-Report @{ status = "inconclusive"; reason = "video_missing"; video_path = $VideoPath } 2
  }
  $ffmpeg = Get-Command ffmpeg -ErrorAction Stop
  # FFmpeg writes normal filter diagnostics to stderr; capture it without
  # turning those lines into terminating PowerShell errors.
  $nativePreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $raw = & $ffmpeg.Source -hide_banner -i $VideoPath -vf "crop=$Crop,freezedetect=n=0.003:d=1" -an -f null - 2>&1
  $nativeExitCode = $LASTEXITCODE
  $ErrorActionPreference = $nativePreference
  if ($nativeExitCode -ne 0) {
    Write-Report @{ status = "inconclusive"; reason = "ffmpeg_failed"; exit_code = $nativeExitCode; video_path = $VideoPath } 2
  }

  $starts = @($raw | Select-String "freeze_start: ([\d.]+)" | ForEach-Object { [double]$_.Matches[0].Groups[1].Value })
  $durations = @($raw | Select-String "freeze_duration: ([\d.]+)" | ForEach-Object { [double]$_.Matches[0].Groups[1].Value })
  $findings = @()
  for ($index = 0; $index -lt $starts.Count; $index++) {
    $duration = if ($index -lt $durations.Count) { $durations[$index] } else { 0 }
    if ($duration -ge $MaxFreeze) {
      $findings += @{ start = $starts[$index]; duration = $duration }
    }
  }
  $status = if ($findings.Count -gt 0) { "findings" } else { "ok" }
  Write-Report @{ status = $status; video_path = $VideoPath; max_freeze = $MaxFreeze; crop = $Crop; findings = $findings } 0
} catch {
  Write-Report @{ status = "inconclusive"; reason = "diagnostic_exception"; detail = $_.Exception.Message; video_path = $VideoPath } 2
}
