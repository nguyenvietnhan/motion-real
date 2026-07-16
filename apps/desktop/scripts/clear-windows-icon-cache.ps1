# Rebuild Windows icon cache (Explorer will restart).
# Run in PowerShell (Admin recommended if delete fails).
# Source: Windows community + Electron Forge icon troubleshooting.

Write-Host "Stopping Explorer..."
taskkill /IM explorer.exe /F 2>$null
Start-Sleep -Seconds 1

$paths = @(
  "$env:LOCALAPPDATA\IconCache.db",
  "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*"
)
foreach ($p in $paths) {
  Write-Host "Deleting $p"
  Remove-Item -Path $p -Force -ErrorAction SilentlyContinue
}

Write-Host "ie4uinit -show..."
& ie4uinit.exe -show 2>$null

Write-Host "Starting Explorer..."
Start-Process explorer.exe

Write-Host "Done. Unpin any old Electron/MotionReal taskbar pin, then:"
Write-Host "  cd V:\MotionReal"
Write-Host "  npm.cmd --prefix apps/desktop run app"
