# デスクトップに「蔵書ターミナル」というショートカットを作成する。
# ダブルクリックすると、このプロジェクトのフォルダでPowerShellが開く
# （notebooklm login や node src/build/build.js、npm run viewer 等を手動で実行したい場合用）。
# 起動直後によく使うコマンドの一覧（scripts\terminal-banner.ps1）を表示する。
# 使い方: powershell -ExecutionPolicy Bypass -File scripts\create-terminal-shortcut.ps1

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BannerScript = Join-Path $ProjectRoot "scripts\terminal-banner.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "蔵書ターミナル.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
# Windows Terminalを明示的に起動する（PowerShell単体のRawUIリサイズは
# Windows Terminal環境では効かないため、wt.exeの--sizeで初期ウィンドウサイズを指定する）。
$Shortcut.TargetPath = "wt.exe"
$Shortcut.Arguments = "--size 120,40 -d `"$ProjectRoot`" powershell.exe -NoExit -ExecutionPolicy Bypass -File `"$BannerScript`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "このプロジェクトのフォルダでPowerShellを開く（起動時にコマンド一覧を表示）"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "ショートカットを作成しました: $ShortcutPath"
