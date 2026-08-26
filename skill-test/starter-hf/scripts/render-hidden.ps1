# Render/check HyperFrames O AN (khong pop-up window) + ghi log ra file.
# Dung cach nay thay cho goi truc tiep `npx hyperframes render/check`.
#
# Cach dung (tu GOC TOOLBOX hoac bat ky dau):
#   powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb review
#   powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb delivery
#   powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb check
# Log: starter-hf\<slug>\render.log — poll file nay de xem tien do.
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [ValidateSet("review", "delivery", "render", "check")][string]$Verb = "review"
)
$ErrorActionPreference = "Stop"

$starterDir = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $starterDir $Slug
$jobDir = Join-Path $starterDir "..\jobs\$Slug"
if (-not (Test-Path (Join-Path $proj "index.html"))) {
  Write-Error "Khong tim thay $proj\index.html"
  exit 1
}

# Creative QA is mandatory for new schemaVersion 2 experimental jobs. Older
# artifacts remain renderable as legacy evidence, but are not the documented workflow.
$planPath = Join-Path $jobDir "video-plan.json"
if (($Verb -eq "review" -or $Verb -eq "delivery") -and (Test-Path $planPath)) {
  $plan = Get-Content -Raw $planPath | ConvertFrom-Json
  if ($plan.schemaVersion -ge 2 -and $plan.visual_language) {
    $phase = if ($Verb -eq "review") { "pre-review" } else { "handoff" }
    & python (Join-Path $starterDir "..\tools\video_pipeline.py") qa-gate --job $Slug --phase $phase
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Creative QA gate chua dat ($phase); khong render $Verb."
      exit $LASTEXITCODE
    }
  }
}

$log = Join-Path $proj "$Verb.log"
if (Test-Path $log) { Remove-Item $log -Force }

if ($Verb -eq "check") {
  $argString = "/c cd /d `"$proj`" && npx --no-install hyperframes check --timeout 60000 > `"$log`" 2>&1"
} else {
  $outputDir = Join-Path $starterDir "..\jobs\$Slug\output"
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
  if ($Verb -eq "review") {
    $outPath = "..\..\jobs\$slug\output\review.mp4"
    $quality = "standard"
  } elseif ($Verb -eq "delivery") {
    $outPath = "..\..\jobs\$slug\output\video.mp4"
    $quality = "high"
  } else {
    # Legacy alias: preserve prior behavior for existing jobs.
    $outPath = "..\..\jobs\$slug\output\video.mp4"
    $quality = "standard"
  }
  $argString = "/c cd /d `"$proj`" && npx --no-install hyperframes render --browser-timeout 120 --player-ready-timeout 90000 --quality $quality --output `"$outPath`" > `"$log`" 2>&1"
}

$p = Start-Process -FilePath $env:ComSpec -ArgumentList $argString -WindowStyle Hidden -PassThru
Write-Host "DA CHAY AN: hyperframes $Verb (PID $($p.Id)) | log: $log"
Write-Host "Poll: Get-Content `"$log`" -Tail 5 -Wait"
$p.WaitForExit()
Write-Host "EXIT CODE = $($p.ExitCode)"
Write-Host "--- 15 dong cuoi log ---"
Get-Content $log -Tail 15
exit $p.ExitCode
