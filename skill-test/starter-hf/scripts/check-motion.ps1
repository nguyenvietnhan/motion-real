# Kiem tra "dead zone" cua video thanh pham — chong slide.
# Crop vung content (bo caption band), dung freezedetect cua ffmpeg:
# bat ky khoang dong bang >= -MaxFreeze giay => EXIT 1 (FAIL).
#
# Cach dung (tu GOC TOOLBOX):
#   powershell -File starter-hf\scripts\check-motion.ps1 -VideoPath jobs\<slug>\output\video.mp4
param(
  [Parameter(Mandatory = $true)][string]$VideoPath,
  [double]$MaxFreeze = 4.0,
  [string]$Crop = "1080:1300:0:200"
)
$ErrorActionPreference = "Continue"
if (-not (Test-Path $VideoPath)) { Write-Error "Khong tim thay $VideoPath"; exit 1 }

$raw = ffmpeg -hide_banner -i $VideoPath -vf "crop=$Crop,freezedetect=n=0.003:d=1" -an -f null - 2>&1
$starts = @($raw | Select-String "freeze_start: ([\d.]+)" | ForEach-Object { [double]$_.Matches[0].Groups[1].Value })
$durs   = @($raw | Select-String "freeze_duration: ([\d.]+)" | ForEach-Object { [double]$_.Matches[0].Groups[1].Value })

if ($starts.Count -eq 0) {
  Write-Host "PASS: khong co khoang dong bang >=1s trong vung content."
  exit 0
}

Write-Host "Phat hien $($starts.Count) khoang dong bang:"
$fail = $false
for ($i = 0; $i -lt $starts.Count; $i++) {
  $d = if ($i -lt $durs.Count) { $durs[$i] } else { 0 }
  $mark = if ($d -ge $MaxFreeze) { "FAIL" } else { "ok" }
  if ($d -ge $MaxFreeze) { $fail = $true }
  Write-Host ("  [{0}] t={1}s dong bang {2:N2}s" -f $mark, $starts[$i], $d)
}
if ($fail) {
  Write-Host "FAIL: co khoang dong bang >= $MaxFreeze giay — beat do la SLIDE."
  Write-Host "Sua: them reveal schedule + living motion + semantic tween cho beat tuong ung (xem scene-authoring)."
  exit 1
}
Write-Host "PASS: khong co freeze dai hon $MaxFreeze giay."
exit 0
