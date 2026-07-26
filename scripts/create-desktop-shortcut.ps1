# デスクトップに「蔵書AI司書」というショートカットを作成する。
# ダブルクリックすると、このプロジェクトのフォルダでClaude Codeが起動する。
# 使い方: PowerShellでこのファイルを実行する
#   powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TargetBat = Join-Path $ProjectRoot "start-librarian.bat"

if (-not (Test-Path $TargetBat)) {
    Write-Error "start-librarian.bat が見つかりません: $TargetBat"
    exit 1
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "蔵書AI司書.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
# Windows Terminalをホストとして明示的に起動する（cmd.exe単体の`mode con:`は
# Windows Terminal環境では効かないため、wt.exeの--sizeで初期ウィンドウサイズを指定する）。
$Shortcut.TargetPath = "wt.exe"
$Shortcut.Arguments = "--size 120,65 cmd /c `"$TargetBat`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = "蔵書AI司書（Claude Code）を起動"
$Shortcut.WindowStyle = 1
$Shortcut.Save()

Write-Host "ショートカットを作成しました: $ShortcutPath"
