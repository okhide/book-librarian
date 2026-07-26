# デスクトップに「蔵書ターミナル」というショートカットを作成する。
# ダブルクリックすると、このプロジェクトのフォルダでPowerShellが開く
# （notebooklm login や node src/build/build.js を手動で実行したい場合用）。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\create-terminal-shortcut.ps1

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "蔵書ターミナル.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoExit -Command `"Set-Location '$ProjectRoot'`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "このプロジェクトのフォルダでPowerShellを開く"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "ショートカットを作成しました: $ShortcutPath"
