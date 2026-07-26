# デスクトップに「蔵書ターミナル」というショートカットを作成する。
# ダブルクリックすると、このプロジェクトのフォルダでPowerShellが開く
# （notebooklm login や node src/build/build.js を手動で実行したい場合用）。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\create-terminal-shortcut.ps1

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "蔵書ターミナル.lnk"

# ウィンドウサイズの拡大はconhost以外のホスト（Windows Terminal等）では
# 例外になることがあるため、try/catchで無視できるようにする。
$InnerCommand = "try { `$Host.UI.RawUI.BufferSize = New-Object System.Management.Automation.Host.Size(120,3000); `$Host.UI.RawUI.WindowSize = New-Object System.Management.Automation.Host.Size(120,50) } catch {}; Set-Location '$ProjectRoot'"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoExit -Command `"$InnerCommand`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "このプロジェクトのフォルダでPowerShellを開く"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "ショートカットを作成しました: $ShortcutPath"
