@echo off
cd /d "%~dp0"

where claude >nul 2>nul
if %errorlevel%==0 (
    set CLAUDE_CMD=claude
) else if exist "%USERPROFILE%\.local\bin\claude.exe" (
    set CLAUDE_CMD="%USERPROFILE%\.local\bin\claude.exe"
) else (
    echo claudeコマンドが見つかりません。Claude Codeがインストールされているか確認してください。
    pause
    exit /b 1
)

%CLAUDE_CMD% "この蔵書ツールで何ができるか教えてください"

if errorlevel 1 (
    echo.
    echo エラーが発生しました（終了コード: %errorlevel%）。
    pause
)
