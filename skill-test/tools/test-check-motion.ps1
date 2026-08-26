$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$diagnostic = Join-Path $root "starter-hf\scripts\check-motion.ps1"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("motion-diagnostic-" + [guid]::NewGuid())
$bin = Join-Path $temp "bin"
$video = Join-Path $temp "sample.mp4"
$oldPath = $env:PATH

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
  if ($Actual -ne $Expected) { throw "$($Label): expected '$Expected', got '$Actual'" }
}

function Invoke-Diagnostic([string]$FakeFfmpeg, [string]$ExpectedStatus, [int]$ExpectedExit) {
  Set-Content -Path (Join-Path $bin "ffmpeg.cmd") -Value $FakeFfmpeg -Encoding ASCII
  $env:PATH = "$bin;$oldPath"
  $output = & powershell -NoProfile -File $diagnostic -VideoPath $video 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne $ExpectedExit) { $output | ForEach-Object { Write-Host $_ } }
  $report = ($output | Out-String | ConvertFrom-Json)
  Assert-Equal $exitCode $ExpectedExit "exit code"
  Assert-Equal $report.status $ExpectedStatus "diagnostic status"
}

try {
  New-Item -ItemType Directory -Path $bin -Force | Out-Null
  New-Item -ItemType File -Path $video -Force | Out-Null

  $env:PATH = "$bin;$oldPath"
  $missingOutput = & powershell -NoProfile -File $diagnostic -VideoPath (Join-Path $temp "missing.mp4") 2>&1
  Assert-Equal $LASTEXITCODE 2 "missing video exit code"
  Assert-Equal (($missingOutput | Out-String | ConvertFrom-Json).status) "inconclusive" "missing video status"

  Invoke-Diagnostic "@echo off`r`nexit /b 0" "ok" 0
  Invoke-Diagnostic "@echo off`r`necho freeze_start: 1.0 1>&2`r`necho freeze_duration: 4.5 1>&2`r`nexit /b 0" "findings" 0
  Invoke-Diagnostic "@echo off`r`nexit /b 7" "inconclusive" 2
  Write-Host "check-motion tests passed"
} finally {
  $env:PATH = $oldPath
  if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
