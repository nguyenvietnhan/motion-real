# Render/check HyperFrames O AN (khong pop-up window) + ghi log ra file.
# Dung cach nay thay cho goi truc tiep `npx hyperframes render/check`.
#
# Cach dung (tu GOC TOOLBOX hoac bat ky dau):
#   powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb render
#   powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb check
# Log: starter-hf\<slug>\render.log — poll file nay de xem tien do.
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [ValidateSet("render", "check")][string]$Verb = "render"
)
$ErrorActionPreference = "Stop"

$starterDir = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $starterDir $Slug
if (-not (Test-Path (Join-Path $proj "index.html"))) {
  Write-Error "Khong tim thay $proj\index.html"
  exit 1
}

$log = Join-Path $proj "$Verb.log"
if (Test-Path $log) { Remove-Item $log -Force }

if ($Verb -eq "render") {
  $outPath = "..\..\jobs\$slug\output\video.mp4"
  $argString = "/c cd /d `"$proj`" && npx hyperframes render --browser-timeout 120 --player-ready-timeout 90000 --output `"$outPath`" > `"$log`" 2>&1"
} else {
  $argString = "/c cd /d `"$proj`" && npx hyperframes check --timeout 60000 > `"$log`" 2>&1"
}

$p = Start-Process -FilePath $env:ComSpec -ArgumentList $argString -WindowStyle Hidden -PassThru
Write-Host "DA CHAY AN: hyperframes $Verb (PID $($p.Id)) | log: $log"
Write-Host "Poll: Get-Content `"$log`" -Tail 5 -Wait"
$p.WaitForExit()
Write-Host "EXIT CODE = $($p.ExitCode)"
Write-Host "--- 15 dong cuoi log ---"
Get-Content $log -Tail 15
exit $p.ExitCode
